import { assertEquals, assertExists, assertMatch } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { handleOutboxDrainRequest, type OutboxDrainDeps } from './index.ts';
import type { CandidateEmail } from './candidates.ts';
import type { ProcessCandidateTally } from './process-candidate.ts';
import type { EmailBrandContext } from '../_shared/email/types.ts';
import type { CaptureExceptionInput, CaptureResult, PostHogEnv } from '../_shared/observability.ts';

const CRON_SECRET = 'test-cron-secret';
const POSTHOG_ENV: PostHogEnv = {
  apiKey: 'phc_test',
  host: 'https://us.i.posthog.com',
};
const FUNCTION_URL = 'https://example.com/functions/v1/outbox-drain';
const BRAND: EmailBrandContext = {
  companyName: 'Regnum Christi Brasil',
  appPublicUrl: 'https://app.example.com',
  supportEmail: 'support@example.com',
};

const FAKE_SUPABASE = {} as unknown as SupabaseClient;

function fakeCaptureException(): {
  fn: (env: PostHogEnv, input: CaptureExceptionInput) => Promise<CaptureResult>;
  calls: CaptureExceptionInput[];
} {
  const calls: CaptureExceptionInput[] = [];
  return {
    calls,
    fn: (_env, input) => (calls.push(input), Promise.resolve({ ok: true })),
  };
}

function fakeFetchCandidateEmails(
  candidates: readonly CandidateEmail[],
): {
  fn: (
    client: SupabaseClient,
    limit: number,
  ) => Promise<readonly CandidateEmail[]>;
  calls: number[];
} {
  const calls: number[] = [];
  return {
    calls,
    fn: (_client, limit) => {
      calls.push(limit);
      return Promise.resolve(candidates);
    },
  };
}

function baseDeps(overrides: Partial<OutboxDrainDeps> = {}): OutboxDrainDeps {
  return {
    cronSecret: CRON_SECRET,
    postHogEnv: POSTHOG_ENV,
    supabase: FAKE_SUPABASE,
    resendDeps: {
      apiKey: 'key',
      fromEmail: 'from@example.com',
      replyTo: 'reply@example.com',
    },
    brand: BRAND,
    fetchCandidateEmailsFn: fakeFetchCandidateEmails([]).fn,
    ...overrides,
  };
}

function cronRequest(
  body: unknown = {},
  headers: Record<string, string> = { 'X-Cron-Secret': CRON_SECRET },
): Request {
  return new Request(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function emptyBodyCronRequest(
  headers: Record<string, string> = { 'X-Cron-Secret': CRON_SECRET },
): Request {
  return new Request(FUNCTION_URL, { method: 'POST', headers, body: '' });
}

Deno.test('handleOutboxDrainRequest returns the CORS preflight response for OPTIONS', async () => {
  const response = await handleOutboxDrainRequest(
    new Request(FUNCTION_URL, { method: 'OPTIONS' }),
    baseDeps(),
  );
  assertEquals(response.status, 204);
});

Deno.test('handleOutboxDrainRequest rejects non-POST methods with 405', async () => {
  const response = await handleOutboxDrainRequest(
    new Request(FUNCTION_URL, { method: 'GET' }),
    baseDeps(),
  );
  assertEquals(response.status, 405);
  const body = await response.json();
  assertEquals(body.error.code, 'method_not_allowed');
  assertExists(body.error.requestId);
});

Deno.test('handleOutboxDrainRequest returns 401 when X-Cron-Secret is missing, without touching the DB', async () => {
  const fetchCandidates = fakeFetchCandidateEmails([]);
  const response = await handleOutboxDrainRequest(
    cronRequest({}, {}),
    baseDeps({ fetchCandidateEmailsFn: fetchCandidates.fn }),
  );
  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error.code, 'unauthorized');
  assertEquals(fetchCandidates.calls.length, 0);
});

Deno.test('handleOutboxDrainRequest returns 401 when X-Cron-Secret is wrong, without touching the DB', async () => {
  const fetchCandidates = fakeFetchCandidateEmails([]);
  const response = await handleOutboxDrainRequest(
    cronRequest({}, { 'X-Cron-Secret': 'wrong-secret' }),
    baseDeps({ fetchCandidateEmailsFn: fetchCandidates.fn }),
  );
  assertEquals(response.status, 401);
  assertEquals(fetchCandidates.calls.length, 0);
});

Deno.test('handleOutboxDrainRequest defaults to limit 50 on an empty body', async () => {
  const fetchCandidates = fakeFetchCandidateEmails([]);
  const response = await handleOutboxDrainRequest(
    emptyBodyCronRequest(),
    baseDeps({ fetchCandidateEmailsFn: fetchCandidates.fn }),
  );
  assertEquals(response.status, 200);
  assertEquals(fetchCandidates.calls, [50]);
});

Deno.test('handleOutboxDrainRequest defaults to limit 50 on malformed JSON (BodyParseError defaults to {})', async () => {
  const fetchCandidates = fakeFetchCandidateEmails([]);
  const request = new Request(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'X-Cron-Secret': CRON_SECRET,
      'Content-Type': 'application/json',
    },
    body: '{not-json',
  });
  const response = await handleOutboxDrainRequest(
    request,
    baseDeps({ fetchCandidateEmailsFn: fetchCandidates.fn }),
  );
  assertEquals(response.status, 200);
  assertEquals(fetchCandidates.calls, [50]);
});

Deno.test('handleOutboxDrainRequest passes an explicit valid limit through', async () => {
  const fetchCandidates = fakeFetchCandidateEmails([]);
  const response = await handleOutboxDrainRequest(
    cronRequest({ limit: 17 }),
    baseDeps({ fetchCandidateEmailsFn: fetchCandidates.fn }),
  );
  assertEquals(response.status, 200);
  assertEquals(fetchCandidates.calls, [17]);
});

Deno.test('handleOutboxDrainRequest clamps a limit above 50 down to 50', async () => {
  const fetchCandidates = fakeFetchCandidateEmails([]);
  const response = await handleOutboxDrainRequest(
    cronRequest({ limit: 5000 }),
    baseDeps({ fetchCandidateEmailsFn: fetchCandidates.fn }),
  );
  assertEquals(response.status, 200);
  assertEquals(fetchCandidates.calls, [50]);
});

Deno.test('handleOutboxDrainRequest returns 400 invalid_body for a non-positive-integer limit', async () => {
  const response = await handleOutboxDrainRequest(
    cronRequest({ limit: 0 }),
    baseDeps(),
  );
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, 'invalid_body');
});

Deno.test('handleOutboxDrainRequest returns 400 invalid_body for a non-numeric limit', async () => {
  const response = await handleOutboxDrainRequest(
    cronRequest({ limit: 'lots' }),
    baseDeps(),
  );
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, 'invalid_body');
});

Deno.test('handleOutboxDrainRequest returns 500 internal_error and captures the exception when the candidate lookup throws', async () => {
  const captureException = fakeCaptureException();
  const response = await handleOutboxDrainRequest(
    cronRequest({}),
    baseDeps({
      fetchCandidateEmailsFn: () => Promise.reject(new Error('db exploded')),
      captureExceptionFn: captureException.fn,
    }),
  );
  assertEquals(response.status, 500);
  const body = await response.json();
  assertEquals(body.error.code, 'internal_error');
  assertEquals(captureException.calls.length, 1);
});

Deno.test('handleOutboxDrainRequest returns zeros for an empty batch of candidates', async () => {
  const response = await handleOutboxDrainRequest(cronRequest({}), baseDeps());
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body, { picked: 0, sent: 0, failed: 0, deadLettered: 0 });
});

function candidate(
  id: string,
  overrides: Partial<CandidateEmail> = {},
): CandidateEmail {
  return {
    id,
    template: 'welcome',
    toEmail: `${id}@example.com`,
    payload: { user_id: 'user-1' },
    attempts: 0,
    ...overrides,
  };
}

function outcomeProcessCandidateFn(
  outcomesById: Readonly<
    Record<string, 'sent' | 'failed' | 'deadLettered' | 'throw'>
  >,
): {
  fn: (
    deps: unknown,
    candidate: CandidateEmail,
    tally: ProcessCandidateTally,
  ) => Promise<void>;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    // deno-lint-ignore require-await
    fn: async (_deps, candidateArg, tally) => {
      calls.push(candidateArg.id);
      const outcome = outcomesById[candidateArg.id];
      if (outcome === 'throw') {
        throw new Error(`processCandidate blew up for ${candidateArg.id}`);
      }
      if (outcome === 'sent') tally.sent += 1;
      else if (outcome === 'failed') tally.failed += 1;
      else if (outcome === 'deadLettered') tally.deadLettered += 1;
    },
  };
}

Deno.test('handleOutboxDrainRequest picks candidates and tallies picked = sent + failed + deadLettered', async () => {
  const candidates = [
    candidate('sent-1'),
    candidate('failed-1'),
    candidate('dead-1'),
  ];
  const processCandidate = outcomeProcessCandidateFn({
    'sent-1': 'sent',
    'failed-1': 'failed',
    'dead-1': 'deadLettered',
  });

  const response = await handleOutboxDrainRequest(
    cronRequest({}),
    baseDeps({
      fetchCandidateEmailsFn: fakeFetchCandidateEmails(candidates).fn,
      // deno-lint-ignore no-explicit-any
      processCandidateFn: processCandidate.fn as any,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body, { picked: 3, sent: 1, failed: 1, deadLettered: 1 });
  assertEquals(processCandidate.calls, ['sent-1', 'failed-1', 'dead-1']);
});

Deno.test('handleOutboxDrainRequest keeps processing the rest of the batch when processCandidate throws for one row, counting it as failed (defensive outer safety net)', async () => {
  const candidates = [
    candidate('ok-1'),
    candidate('boom-1'),
    candidate('ok-2'),
  ];
  const processCandidate = outcomeProcessCandidateFn({
    'ok-1': 'sent',
    'boom-1': 'throw',
    'ok-2': 'sent',
  });
  const captureException = fakeCaptureException();

  const response = await handleOutboxDrainRequest(
    cronRequest({}),
    baseDeps({
      fetchCandidateEmailsFn: fakeFetchCandidateEmails(candidates).fn,
      // deno-lint-ignore no-explicit-any
      processCandidateFn: processCandidate.fn as any,
      captureExceptionFn: captureException.fn,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body, { picked: 3, sent: 2, failed: 1, deadLettered: 0 });
  assertEquals(processCandidate.calls, ['ok-1', 'boom-1', 'ok-2']);
  assertEquals(captureException.calls.length, 1);
  assertEquals(captureException.calls[0]?.properties?.emailOutboxId, 'boom-1');
});

Deno.test('handleOutboxDrainRequest error envelopes always include a requestId', async () => {
  const response = await handleOutboxDrainRequest(
    cronRequest({}, {}),
    baseDeps(),
  );
  const body = await response.json();
  assertMatch(
    body.error.requestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
});
