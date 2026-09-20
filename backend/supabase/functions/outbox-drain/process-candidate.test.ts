import { assertEquals, assertExists } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  processCandidate,
  type ProcessCandidateDeps,
  type ProcessCandidateTally,
} from './process-candidate.ts';
import type { CandidateEmail } from './candidates.ts';
import type { ResolvedTemplateData } from './resolve-template.ts';
import { TemplateResolutionError } from './resolve-template.ts';
import type { EmailBrandContext, RenderedEmail } from '../_shared/email/types.ts';
import type { SendEmailInput, SendEmailResult } from '../_shared/email/resend-client.ts';
import type {
  CaptureEventInput,
  CaptureExceptionInput,
  CaptureResult,
  PostHogEnv,
} from '../_shared/observability.ts';

const POSTHOG_ENV: PostHogEnv = {
  apiKey: 'phc_test',
  host: 'https://us.i.posthog.com',
};
const BRAND: EmailBrandContext = {
  companyName: 'Regnum Christi Brasil',
  appPublicUrl: 'https://app.example.com',
  supportEmail: 'support@example.com',
};
const FAKE_SUPABASE = {} as unknown as SupabaseClient;
const FIXED_NOW = () => new Date('2026-01-15T12:00:00.000Z');

function welcomeCandidate(
  overrides: Partial<CandidateEmail> = {},
): CandidateEmail {
  return {
    id: 'row-1',
    template: 'welcome',
    toEmail: 'a@example.com',
    payload: { user_id: 'user-1' },
    attempts: 0,
    ...overrides,
  };
}

function purchaseCandidate(
  overrides: Partial<CandidateEmail> = {},
): CandidateEmail {
  return {
    id: 'row-2',
    template: 'purchase_confirmation',
    toEmail: 'b@example.com',
    payload: { order_id: 'order-1', course_id: 'course-1' },
    attempts: 0,
    ...overrides,
  };
}

function emptyTally(): ProcessCandidateTally {
  return { sent: 0, failed: 0, deadLettered: 0 };
}

function fakeResolve(
  impl: (candidate: CandidateEmail) => Promise<ResolvedTemplateData>,
) {
  const calls: CandidateEmail[] = [];
  return {
    calls,
    // deno-lint-ignore require-await
    fn: async (_supabase: SupabaseClient, candidate: CandidateEmail) => {
      calls.push(candidate);
      return impl(candidate);
    },
  };
}

function fakeSend(
  impl: (input: SendEmailInput) => Promise<SendEmailResult>,
) {
  const calls: SendEmailInput[] = [];
  return {
    calls,
    fn: (_deps: unknown, input: SendEmailInput) => {
      calls.push(input);
      return impl(input);
    },
  };
}

function fakeRenderWelcome() {
  const calls: unknown[] = [];
  return {
    calls,
    fn: (data: unknown, _brand: EmailBrandContext): RenderedEmail => {
      calls.push(data);
      return { subject: 'Welcome subject', html: '<p>welcome</p>' };
    },
  };
}

function fakeRenderPurchase() {
  const calls: unknown[] = [];
  return {
    calls,
    fn: (data: unknown, _brand: EmailBrandContext): RenderedEmail => {
      calls.push(data);
      return { subject: 'Purchase subject', html: '<p>purchase</p>' };
    },
  };
}

function fakeCapture() {
  const calls: CaptureEventInput[] = [];
  return {
    calls,
    fn: (
      _env: PostHogEnv,
      input: CaptureEventInput,
    ): Promise<CaptureResult> => {
      calls.push(input);
      return Promise.resolve({ ok: true });
    },
  };
}

function fakeCaptureException() {
  const calls: CaptureExceptionInput[] = [];
  return {
    calls,
    fn: (
      _env: PostHogEnv,
      input: CaptureExceptionInput,
    ): Promise<CaptureResult> => {
      calls.push(input);
      return Promise.resolve({ ok: true });
    },
  };
}

function fakeUpdateOutbox(
  result: { error: { message: string } | null } = { error: null },
) {
  const calls: { id: string; patch: Record<string, unknown> }[] = [];
  const supabase = {
    schema(_schemaName: string) {
      return {
        from(_table: string) {
          return {
            update(patch: Record<string, unknown>) {
              return {
                eq(_col: string, id: unknown) {
                  calls.push({ id: id as string, patch });
                  return Promise.resolve(result);
                },
              };
            },
          };
        },
      };
    },
  };
  return { supabase: supabase as unknown as SupabaseClient, calls };
}

function baseDeps(
  overrides: Partial<ProcessCandidateDeps> = {},
): ProcessCandidateDeps {
  return {
    supabase: FAKE_SUPABASE,
    resendDeps: {
      apiKey: 'key',
      fromEmail: 'from@example.com',
      replyTo: 'reply@example.com',
    },
    brand: BRAND,
    postHogEnv: POSTHOG_ENV,
    now: FIXED_NOW,
    ...overrides,
  };
}

Deno.test('processCandidate sends a welcome email: looks up user data, renders with it, marks the row sent', async () => {
  const { supabase, calls: updateCalls } = fakeUpdateOutbox();
  const resolve = fakeResolve((candidate) =>
    Promise.resolve({
      template: 'welcome',
      data: { toEmail: candidate.toEmail, userFullName: 'Maria Silva' },
    })
  );
  const renderWelcome = fakeRenderWelcome();
  const send = fakeSend(() => Promise.resolve({ id: 'resend-id-1' }));
  const capture = fakeCapture();
  const tally = emptyTally();

  await processCandidate(
    baseDeps({
      supabase,
      resolveTemplateDataFn: resolve.fn,
      renderWelcomeEmailFn: renderWelcome.fn,
      sendEmailFn: send.fn,
      captureFn: capture.fn,
    }),
    welcomeCandidate(),
    tally,
  );

  assertEquals(resolve.calls.length, 1);
  assertEquals(renderWelcome.calls, [{
    toEmail: 'a@example.com',
    userFullName: 'Maria Silva',
  }]);
  assertEquals(send.calls, [{
    to: 'a@example.com',
    subject: 'Welcome subject',
    html: '<p>welcome</p>',
  }]);
  assertEquals(updateCalls, [
    {
      id: 'row-1',
      patch: { status: 'sent', sent_at: '2026-01-15T12:00:00.000Z' },
    },
  ]);
  assertEquals(capture.calls.length, 1);
  assertEquals(capture.calls[0]?.event, 'email_sent');
  assertEquals(capture.calls[0]?.distinctId, 'row-1');
  assertEquals(capture.calls[0]?.properties, {
    emailOutboxId: 'row-1',
    template: 'welcome',
  });
  assertEquals(tally, { sent: 1, failed: 0, deadLettered: 0 });
});

Deno.test('processCandidate sends a purchase_confirmation email: looks up course+order data, renders with it, marks the row sent', async () => {
  const { supabase } = fakeUpdateOutbox();
  const resolve = fakeResolve((candidate) =>
    Promise.resolve({
      template: 'purchase_confirmation',
      data: {
        toEmail: candidate.toEmail,
        courseTitle: 'Curso de TypeScript',
        amountCents: 9900,
        currency: 'BRL',
      },
    })
  );
  const renderPurchase = fakeRenderPurchase();
  const send = fakeSend(() => Promise.resolve({ id: 'resend-id-2' }));
  const tally = emptyTally();

  await processCandidate(
    baseDeps({
      supabase,
      resolveTemplateDataFn: resolve.fn,
      renderPurchaseConfirmationEmailFn: renderPurchase.fn,
      sendEmailFn: send.fn,
    }),
    purchaseCandidate(),
    tally,
  );

  assertEquals(renderPurchase.calls, [
    {
      toEmail: 'b@example.com',
      courseTitle: 'Curso de TypeScript',
      amountCents: 9900,
      currency: 'BRL',
    },
  ]);
  assertEquals(send.calls, [{
    to: 'b@example.com',
    subject: 'Purchase subject',
    html: '<p>purchase</p>',
  }]);
  assertEquals(tally, { sent: 1, failed: 0, deadLettered: 0 });
});

Deno.test('processCandidate counts an unknown/unimplemented template as a failure, never crashing, without calling sendEmail', async () => {
  const { supabase, calls: updateCalls } = fakeUpdateOutbox();
  const resolve = fakeResolve(() =>
    Promise.reject(
      new TemplateResolutionError(
        'unsupported email template "password_reset"',
      ),
    )
  );
  const send = fakeSend(() => Promise.resolve({ id: 'should-not-be-called' }));
  const captureException = fakeCaptureException();
  const tally = emptyTally();

  await processCandidate(
    baseDeps({
      supabase,
      resolveTemplateDataFn: resolve.fn,
      sendEmailFn: send.fn,
      captureExceptionFn: captureException.fn,
    }),
    welcomeCandidate({ template: 'password_reset' }),
    tally,
  );

  assertEquals(send.calls.length, 0);
  assertEquals(tally, { sent: 0, failed: 1, deadLettered: 0 });
  assertEquals(updateCalls[0]?.patch.status, 'failed');
  assertEquals(updateCalls[0]?.patch.attempts, 1);
  assertEquals(captureException.calls.length, 1);
  assertEquals(captureException.calls[0]?.properties?.attempts, 1);
});

Deno.test('processCandidate counts a resolution lookup returning no row as a failure', async () => {
  const { supabase } = fakeUpdateOutbox();
  const resolve = fakeResolve(() =>
    Promise.reject(
      new TemplateResolutionError(
        'user user-1 not found for email outbox row row-1',
      ),
    )
  );
  const tally = emptyTally();

  await processCandidate(
    baseDeps({ supabase, resolveTemplateDataFn: resolve.fn }),
    welcomeCandidate(),
    tally,
  );

  assertEquals(tally, { sent: 0, failed: 1, deadLettered: 0 });
});

Deno.test('processCandidate marks the row failed (not dead_lettered) when sendEmail throws on attempts 1 through 4', async () => {
  for (const attemptsBefore of [0, 1, 2, 3]) {
    const { supabase, calls: updateCalls } = fakeUpdateOutbox();
    const resolve = fakeResolve((candidate) =>
      Promise.resolve({
        template: 'welcome',
        data: { toEmail: candidate.toEmail, userFullName: null },
      })
    );
    const send = fakeSend(() => Promise.reject(new Error('Resend API down')));
    const tally = emptyTally();

    await processCandidate(
      baseDeps({
        supabase,
        resolveTemplateDataFn: resolve.fn,
        sendEmailFn: send.fn,
      }),
      welcomeCandidate({ attempts: attemptsBefore }),
      tally,
    );

    assertEquals(
      tally,
      { sent: 0, failed: 1, deadLettered: 0 },
      `attemptsBefore=${attemptsBefore}`,
    );
    assertEquals(updateCalls[0]?.patch.status, 'failed');
    assertEquals(updateCalls[0]?.patch.attempts, attemptsBefore + 1);
  }
});

Deno.test('processCandidate marks the row dead_lettered (not failed) when sendEmail throws on the 5th attempt', async () => {
  const { supabase, calls: updateCalls } = fakeUpdateOutbox();
  const resolve = fakeResolve((candidate) =>
    Promise.resolve({
      template: 'welcome',
      data: { toEmail: candidate.toEmail, userFullName: null },
    })
  );
  const send = fakeSend(() => Promise.reject(new Error('Resend API down')));
  const capture = fakeCapture();
  const tally = emptyTally();

  await processCandidate(
    baseDeps({
      supabase,
      resolveTemplateDataFn: resolve.fn,
      sendEmailFn: send.fn,
      captureFn: capture.fn,
    }),
    welcomeCandidate({ attempts: 4 }),
    tally,
  );

  assertEquals(tally, { sent: 0, failed: 0, deadLettered: 1 });
  assertEquals(updateCalls[0]?.patch.status, 'dead_lettered');
  assertEquals(updateCalls[0]?.patch.attempts, 5);
  assertEquals(capture.calls.length, 1);
  assertEquals(capture.calls[0]?.event, 'email_dead_lettered');
  assertEquals(capture.calls[0]?.distinctId, 'row-1');
  assertEquals(capture.calls[0]?.properties?.emailOutboxId, 'row-1');
  assertEquals(capture.calls[0]?.properties?.template, 'welcome');
  assertEquals(capture.calls[0]?.properties?.attempts, 5);
});

Deno.test('processCandidate captures but does not change the outcome when the bookkeeping UPDATE itself fails on the success path', async () => {
  const { supabase } = fakeUpdateOutbox({
    error: { message: 'db write failed' },
  });
  const resolve = fakeResolve((candidate) =>
    Promise.resolve({
      template: 'welcome',
      data: { toEmail: candidate.toEmail, userFullName: null },
    })
  );
  const send = fakeSend(() => Promise.resolve({ id: 'resend-id-3' }));
  const captureException = fakeCaptureException();
  const capture = fakeCapture();
  const tally = emptyTally();

  await processCandidate(
    baseDeps({
      supabase,
      resolveTemplateDataFn: resolve.fn,
      sendEmailFn: send.fn,
      captureExceptionFn: captureException.fn,
      captureFn: capture.fn,
    }),
    welcomeCandidate(),
    tally,
  );

  assertEquals(tally, { sent: 1, failed: 0, deadLettered: 0 });
  assertEquals(captureException.calls.length, 1);
  assertExists(captureException.calls[0]?.error);
  assertEquals(capture.calls[0]?.event, 'email_sent');
});
