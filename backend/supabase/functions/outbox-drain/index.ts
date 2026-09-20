// outbox-drain Edge Function -- cron-invoked (every 5 min, see
// prompt_course_platform.md's NFR table), not something a browser calls.
// `verify_jwt: false` + a shared `X-Cron-Secret` header is the auth boundary
// (there is no caller JWT to check; this is a service_role-only job), so
// this file uses `createServiceRoleClient()`, never `createCallerClient`.
//
// Drains `app_private.email_outbox`: for every candidate row (never
// attempted, or previously failed with attempts remaining), resolve it into
// renderable email data (`resolve-template.ts`), render + send it via
// Resend, then update the row's status (`process-candidate.ts`). Each row is
// isolated in its own try/catch so one bad row never aborts the batch, same
// isolation pattern as `payments-reconcile`'s `reconcileCandidate`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadBackendConfig } from '../_shared/config.ts';
import type { EmailBrandContext } from '../_shared/email/types.ts';
import type { ResendClientDeps } from '../_shared/email/resend-client.ts';
import {
  BodyParseError,
  corsPreflightResponse,
  errorJsonResponse,
  jsonResponse,
  parseJsonBody,
} from '../_shared/http.ts';
import {
  captureAndFlush,
  captureExceptionAndFlush,
  type PostHogEnv,
} from '../_shared/observability.ts';
import { createServiceRoleClient } from '../_shared/supabase.ts';
import { type CandidateEmail, fetchCandidateEmails } from './candidates.ts';
import { type DrainRequestBody, InvalidLimitError, resolveEffectiveLimit } from './body.ts';
import {
  processCandidate,
  type ProcessCandidateDeps,
  type ProcessCandidateTally,
} from './process-candidate.ts';

const CRON_SECRET_HEADER = 'X-Cron-Secret';

// A cron caller has no meaningful per-user identity -- used for the
// candidate-lookup failure capture below, matching `payments-reconcile`'s
// `CRON_DISTINCT_ID` convention. Per-row captures inside `processCandidate`
// use the recipient's email instead (the closest thing to a subject this
// function has for an individual outcome).
const CRON_DISTINCT_ID = 'cron';

export interface DrainTally {
  readonly picked: number;
  readonly sent: number;
  readonly failed: number;
  readonly deadLettered: number;
}

export interface OutboxDrainDeps {
  readonly cronSecret: string;
  readonly postHogEnv: PostHogEnv;
  readonly supabase: SupabaseClient; // service_role, injected by the caller
  readonly resendDeps: ResendClientDeps;
  readonly brand: EmailBrandContext;
  // Every collaborator below is injectable for tests; each defaults to the
  // real implementation, matching this repo's DI-testable-handler
  // convention (see `_shared/payments/confirm-order.ts`).
  readonly fetchCandidateEmailsFn?: typeof fetchCandidateEmails;
  readonly processCandidateFn?: typeof processCandidate;
  readonly captureFn?: typeof captureAndFlush;
  readonly captureExceptionFn?: typeof captureExceptionAndFlush;
}

function invalidBodyResponse(message: string): Response {
  return errorJsonResponse({ code: 'invalid_body', message, status: 400 });
}

function internalErrorResponse(): Response {
  return errorJsonResponse({
    code: 'internal_error',
    message: 'Failed to scan outbox drain candidate emails',
    status: 500,
  });
}

export async function handleOutboxDrainRequest(
  request: Request,
  deps: OutboxDrainDeps,
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return corsPreflightResponse();
  }
  if (request.method !== 'POST') {
    return errorJsonResponse({
      code: 'method_not_allowed',
      message: `Method ${request.method} is not allowed`,
      status: 405,
    });
  }

  if (request.headers.get(CRON_SECRET_HEADER) !== deps.cronSecret) {
    return errorJsonResponse({
      code: 'unauthorized',
      message: `Missing or invalid ${CRON_SECRET_HEADER} header`,
      status: 401,
    });
  }

  // `{ limit? }` has no required fields -- an empty or malformed body is not
  // a client error here, just "use the defaults". Only a present-but-invalid
  // `limit` (wrong type / not a positive integer) is a genuine 400.
  let body: DrainRequestBody;
  try {
    body = await parseJsonBody<DrainRequestBody>(request);
  } catch (error) {
    if (error instanceof BodyParseError) {
      body = {};
    } else {
      throw error;
    }
  }

  let effectiveLimit: number;
  try {
    effectiveLimit = resolveEffectiveLimit(body);
  } catch (error) {
    if (error instanceof InvalidLimitError) {
      return invalidBodyResponse(error.message);
    }
    throw error;
  }

  const fetchCandidateEmailsFn = deps.fetchCandidateEmailsFn ??
    fetchCandidateEmails;
  const processCandidateFn = deps.processCandidateFn ?? processCandidate;
  const captureException = deps.captureExceptionFn ?? captureExceptionAndFlush;

  let candidates: readonly CandidateEmail[];
  try {
    candidates = await fetchCandidateEmailsFn(deps.supabase, effectiveLimit);
  } catch (error) {
    await captureException(deps.postHogEnv, {
      distinctId: CRON_DISTINCT_ID,
      error,
      properties: { reason: 'outbox_drain_candidate_lookup_failed' },
    });
    return internalErrorResponse();
  }

  const tally: ProcessCandidateTally = { sent: 0, failed: 0, deadLettered: 0 };

  const processDeps: ProcessCandidateDeps = {
    supabase: deps.supabase,
    resendDeps: deps.resendDeps,
    brand: deps.brand,
    postHogEnv: deps.postHogEnv,
    captureFn: deps.captureFn,
    captureExceptionFn: deps.captureExceptionFn,
  };

  // Sequential, not `Promise.all` -- same predictable-load reasoning as
  // `payments-reconcile`'s reconciliation pass. `processCandidateFn` already
  // wraps resolve/render/send in its own try/catch and never throws in
  // production, but this outer try/catch is a defensive second safety net
  // (same posture as `payments-webhook`'s outer loop around `processEvent`)
  // -- an unexpected throw from a caller-injected implementation still
  // counts as a failed attempt for that row rather than aborting the rest
  // of the batch or the whole request.
  for (const candidate of candidates) {
    try {
      await processCandidateFn(processDeps, candidate, tally);
    } catch (error) {
      await captureException(deps.postHogEnv, {
        distinctId: candidate.toEmail,
        error,
        properties: {
          emailOutboxId: candidate.id,
          template: candidate.template,
          reason: 'process_candidate_unexpected_exception',
        },
      });
      tally.failed += 1;
    }
  }

  const finalTally: DrainTally = {
    picked: candidates.length,
    sent: tally.sent,
    failed: tally.failed,
    deadLettered: tally.deadLettered,
  };

  return jsonResponse(finalTally);
}

// Real wiring only runs when this module is the process entry point (i.e.
// deployed/served directly), never on import -- keeps `deno test` from
// paying `loadBackendConfig()`'s fail-fast env validation just to import
// `handleOutboxDrainRequest` for testing (same convention as
// `payments-reconcile/index.ts`).
if (import.meta.main) {
  const config = loadBackendConfig();
  const supabase = createServiceRoleClient();
  const deps: OutboxDrainDeps = {
    cronSecret: config.cronSecret,
    postHogEnv: config.postHog,
    supabase,
    resendDeps: {
      apiKey: config.resend.apiKey,
      fromEmail: config.resend.fromEmail,
      replyTo: config.resend.replyTo,
    },
    brand: {
      companyName: config.companyName,
      appPublicUrl: config.appPublicUrl,
      supportEmail: config.supportEmail,
    },
  };
  Deno.serve((request) => handleOutboxDrainRequest(request, deps));
}
