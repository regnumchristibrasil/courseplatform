// Per-row processing for one `app_private.email_outbox` candidate: resolve
// -> render -> send -> update the row's status -- all isolated in a single
// try/catch so one bad row can never abort the batch (same isolation
// pattern as `payments-reconcile`'s `reconcileCandidate`).
//
// Counter semantics (deliberately spelled out, see this task's spec):
//   sent          -- the email was actually sent via Resend.
//   failed        -- this attempt failed but the row still has attempts
//                     left (`newAttempts < 5`); it is eligible for a retry
//                     on a later tick. NOT "gave up".
//   deadLettered  -- this attempt was the 5th failure; the row is now
//                     terminal and will never be picked up again.
// `picked = sent + failed + deadLettered` holds because every row falls
// into exactly one of these three buckets below.
//
// PostHog `distinctId` on every capture below is `candidate.id` (the
// `email_outbox` row's own uuid), never `candidate.toEmail` -- the
// recipient's real email address is PII and must not be exported to a
// third-party analytics system as an identifier (security-review finding,
// 2026-09-03; every other capture site in this backend uses a non-PII
// identifier -- a user/order uuid or a fixed system id -- for exactly this
// reason). The row id is sufficient to correlate attempts/events per send.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmailBrandContext, RenderedEmail } from '../_shared/email/types.ts';
import { renderWelcomeEmail } from '../_shared/email/templates/welcome.ts';
import { renderPurchaseConfirmationEmail } from '../_shared/email/templates/purchase-confirmation.ts';
import { type ResendClientDeps, sendEmail } from '../_shared/email/resend-client.ts';
import {
  captureAndFlush,
  captureExceptionAndFlush,
  type PostHogEnv,
} from '../_shared/observability.ts';
import type { CandidateEmail } from './candidates.ts';
import { type ResolvedTemplateData, resolveTemplateData } from './resolve-template.ts';

const APP_PRIVATE_SCHEMA = 'app_private';
const EMAIL_OUTBOX_TABLE = 'email_outbox';
const MAX_ATTEMPTS = 5; // NFR: 5 attempts with backoff, then dead-letter.
const SENT_STATUS = 'sent';
const FAILED_STATUS = 'failed';
const DEAD_LETTERED_STATUS = 'dead_lettered';

export interface ProcessCandidateTally {
  sent: number;
  failed: number;
  deadLettered: number;
}

export interface ProcessCandidateDeps {
  readonly supabase: SupabaseClient; // service_role, injected by the caller
  readonly resendDeps: ResendClientDeps;
  readonly brand: EmailBrandContext;
  readonly postHogEnv: PostHogEnv;
  // Every collaborator below is injectable for tests; each defaults to the
  // real implementation, matching this repo's DI-testable-handler
  // convention (see `_shared/payments/confirm-order.ts`).
  readonly resolveTemplateDataFn?: typeof resolveTemplateData;
  readonly renderWelcomeEmailFn?: typeof renderWelcomeEmail;
  readonly renderPurchaseConfirmationEmailFn?: typeof renderPurchaseConfirmationEmail;
  readonly sendEmailFn?: typeof sendEmail;
  readonly captureFn?: typeof captureAndFlush;
  readonly captureExceptionFn?: typeof captureExceptionAndFlush;
  readonly now?: () => Date;
}

interface UpdateOutcome {
  readonly error: { readonly message: string } | null;
}

function renderResolved(
  resolved: ResolvedTemplateData,
  brand: EmailBrandContext,
  renderWelcomeEmailFn: typeof renderWelcomeEmail,
  renderPurchaseConfirmationEmailFn: typeof renderPurchaseConfirmationEmail,
): RenderedEmail {
  switch (resolved.template) {
    case 'welcome':
      return renderWelcomeEmailFn(resolved.data, brand);
    case 'purchase_confirmation':
      return renderPurchaseConfirmationEmailFn(resolved.data, brand);
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

async function markSent(
  supabase: SupabaseClient,
  id: string,
  sentAtIso: string,
): Promise<UpdateOutcome> {
  return await supabase
    .schema(APP_PRIVATE_SCHEMA)
    .from(EMAIL_OUTBOX_TABLE)
    .update({ status: SENT_STATUS, sent_at: sentAtIso })
    .eq('id', id);
}

async function markRetryableFailure(
  supabase: SupabaseClient,
  id: string,
  attempts: number,
  lastAttemptedAtIso: string,
): Promise<UpdateOutcome> {
  return await supabase
    .schema(APP_PRIVATE_SCHEMA)
    .from(EMAIL_OUTBOX_TABLE)
    .update({
      status: FAILED_STATUS,
      attempts,
      last_attempted_at: lastAttemptedAtIso,
    })
    .eq('id', id);
}

async function markDeadLettered(
  supabase: SupabaseClient,
  id: string,
  attempts: number,
  lastAttemptedAtIso: string,
): Promise<UpdateOutcome> {
  return await supabase
    .schema(APP_PRIVATE_SCHEMA)
    .from(EMAIL_OUTBOX_TABLE)
    .update({
      status: DEAD_LETTERED_STATUS,
      attempts,
      last_attempted_at: lastAttemptedAtIso,
    })
    .eq('id', id);
}

// Bookkeeping-update failures are captured but never allowed to change the
// row's already-decided outcome or abort the batch -- same posture as
// `payments-webhook`'s `updatePaymentEventStatus`.
async function reportUpdateErrorIfAny(
  captureException: typeof captureExceptionAndFlush,
  postHogEnv: PostHogEnv,
  candidate: CandidateEmail,
  outcome: UpdateOutcome,
  targetStatus: string,
): Promise<void> {
  if (!outcome.error) return;
  await captureException(postHogEnv, {
    distinctId: candidate.id,
    error: new Error(
      `Failed to update email outbox row ${candidate.id} to status "${targetStatus}": ${outcome.error.message}`,
    ),
    properties: {
      emailOutboxId: candidate.id,
      template: candidate.template,
      reason: 'email_outbox_update_failed',
    },
  });
}

export async function processCandidate(
  deps: ProcessCandidateDeps,
  candidate: CandidateEmail,
  tally: ProcessCandidateTally,
): Promise<void> {
  const resolveFn = deps.resolveTemplateDataFn ?? resolveTemplateData;
  const renderWelcomeEmailFn = deps.renderWelcomeEmailFn ?? renderWelcomeEmail;
  const renderPurchaseConfirmationEmailFn = deps.renderPurchaseConfirmationEmailFn ??
    renderPurchaseConfirmationEmail;
  const sendFn = deps.sendEmailFn ?? sendEmail;
  const capture = deps.captureFn ?? captureAndFlush;
  const captureException = deps.captureExceptionFn ?? captureExceptionAndFlush;
  const now = deps.now ?? (() => new Date());

  // Resolution + render + send are all one attempt -- any failure among the
  // three counts identically as a failed SEND attempt for this row.
  let sendFailure: unknown = null;
  try {
    const resolved = await resolveFn(deps.supabase, candidate);
    const rendered = renderResolved(
      resolved,
      deps.brand,
      renderWelcomeEmailFn,
      renderPurchaseConfirmationEmailFn,
    );
    await sendFn(deps.resendDeps, {
      to: candidate.toEmail,
      subject: rendered.subject,
      html: rendered.html,
    });
  } catch (error) {
    sendFailure = error;
  }

  if (sendFailure === null) {
    const updateOutcome = await markSent(
      deps.supabase,
      candidate.id,
      now().toISOString(),
    );
    await reportUpdateErrorIfAny(
      captureException,
      deps.postHogEnv,
      candidate,
      updateOutcome,
      SENT_STATUS,
    );

    await capture(deps.postHogEnv, {
      event: 'email_sent',
      distinctId: candidate.id,
      properties: { emailOutboxId: candidate.id, template: candidate.template },
    });
    tally.sent += 1;
    return;
  }

  const newAttempts = candidate.attempts + 1;
  const lastAttemptedAtIso = now().toISOString();
  const errorForCapture = toError(sendFailure);

  if (newAttempts >= MAX_ATTEMPTS) {
    const updateOutcome = await markDeadLettered(
      deps.supabase,
      candidate.id,
      newAttempts,
      lastAttemptedAtIso,
    );
    await reportUpdateErrorIfAny(
      captureException,
      deps.postHogEnv,
      candidate,
      updateOutcome,
      DEAD_LETTERED_STATUS,
    );

    // `email_dead_lettered` is a frozen `ServerEventName` -- emitted via
    // `captureFn`/`captureAndFlush` so the event name on the wire is exactly
    // `email_dead_lettered`, not PostHog's reserved `$exception` name that
    // `captureExceptionAndFlush` always uses internally. The underlying
    // error is still visible: its message is folded into `properties`
    // below rather than dropped.
    await capture(deps.postHogEnv, {
      event: 'email_dead_lettered',
      distinctId: candidate.id,
      properties: {
        emailOutboxId: candidate.id,
        template: candidate.template,
        attempts: newAttempts,
        lastErrorMessage: errorForCapture.message,
      },
    });
    tally.deadLettered += 1;
    return;
  }

  const updateOutcome = await markRetryableFailure(
    deps.supabase,
    candidate.id,
    newAttempts,
    lastAttemptedAtIso,
  );
  await reportUpdateErrorIfAny(
    captureException,
    deps.postHogEnv,
    candidate,
    updateOutcome,
    FAILED_STATUS,
  );

  // No dedicated `ServerEventName` for "one retryable failure" -- the
  // `$exception` event from `captureExceptionAndFlush` covers it, same
  // pattern `video-resolve`/`payments-webhook` use for non-frozen-event
  // failure signals.
  await captureException(deps.postHogEnv, {
    distinctId: candidate.id,
    error: errorForCapture,
    properties: {
      emailOutboxId: candidate.id,
      template: candidate.template,
      attempts: newAttempts,
    },
  });
  tally.failed += 1;
}
