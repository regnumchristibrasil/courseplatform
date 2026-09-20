// payments-reconcile Edge Function -- cron-invoked (every 5 min, see
// prompt_course_platform.md's NFR table), not something a browser calls.
// `verify_jwt: false` + a shared `X-Cron-Secret` header is the auth boundary
// (there is no caller JWT to check; this is a service_role-only job), so
// this file uses `createServiceRoleClient()`, never `createCallerClient`.
//
// Does two distinct things, per the plan doc's explicit split:
//  1. Reconciliation: re-runs `confirmOrder` (the SAME confirm-by-refetch
//     logic `payments-webhook` uses) over orders that have been `pending`
//     too long -- the webhook that should have flipped them may have never
//     arrived or failed to process.
//  2. Expiry sweep: orders whose gateway-issued PIX charge TTL has already
//     passed get flipped straight to `'expired'` via `app.expire_stale_orders`
//     -- no point re-checking the gateway for those.
// Reconciliation runs first, expiry sweep second (see `expire-stale.ts`'s
// header comment for why that order is the safe one).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymentProvider } from '../../../contracts/payments.ts';
import { confirmOrder, type ConfirmOrderResult } from '../_shared/payments/confirm-order.ts';
import { MercadoPagoProvider } from '../_shared/payments/mercadopago/provider.ts';
import { loadBackendConfig } from '../_shared/config.ts';
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
import { type CandidateOrder, fetchCandidateOrders } from './candidates.ts';
import { InvalidLimitError, type ReconcileRequestBody, resolveEffectiveLimit } from './body.ts';
import { expireStaleOrders } from './expire-stale.ts';

const CRON_SECRET_HEADER = 'X-Cron-Secret';

// A cron caller has no meaningful per-user identity -- used for every
// capture in this function, matching `video-resolve`'s `ANONYMOUS_DISTINCT_ID`
// convention for non-user-attributable events, except the per-order failure
// capture below, which uses the order id (the closest thing to a subject
// this function has).
const CRON_DISTINCT_ID = 'cron';

export interface ReconcileTally {
  readonly scanned: number;
  readonly confirmed: number;
  readonly expired: number;
  readonly failed: number;
}

export interface ReconcileDeps {
  readonly cronSecret: string;
  readonly postHogEnv: PostHogEnv;
  readonly supabase: SupabaseClient; // service_role, injected by the caller
  readonly paymentProvider: PaymentProvider;
  // Every collaborator below is injectable for tests; each defaults to the
  // real implementation, matching this repo's DI-testable-handler
  // convention (see `_shared/payments/confirm-order.ts`).
  readonly fetchCandidateOrdersFn?: typeof fetchCandidateOrders;
  readonly confirmOrderFn?: typeof confirmOrder;
  readonly expireStaleOrdersFn?: typeof expireStaleOrders;
  readonly captureFn?: typeof captureAndFlush;
  readonly captureExceptionFn?: typeof captureExceptionAndFlush;
}

function invalidBodyResponse(message: string): Response {
  return errorJsonResponse({ code: 'invalid_body', message, status: 400 });
}

function internalErrorResponse(): Response {
  return errorJsonResponse({
    code: 'internal_error',
    message: 'Failed to scan reconciliation candidate orders',
    status: 500,
  });
}

// Maps one `confirmOrder` outcome onto the response tally. `not_paid` is
// deliberately a no-op: the order is still legitimately pending, nothing is
// wrong with it, and it will be picked up again next tick.
function applyOutcome(
  outcome: ConfirmOrderResult['outcome'],
  tally: { confirmed: number; failed: number },
): void {
  switch (outcome) {
    case 'confirmed':
    case 'already_confirmed':
      tally.confirmed += 1;
      return;
    case 'amount_mismatch':
    case 'order_not_found':
      tally.failed += 1;
      return;
    case 'not_paid':
      return;
  }
}

async function reconcileCandidate(
  deps: ReconcileDeps,
  confirmOrderFn: typeof confirmOrder,
  captureException: typeof captureExceptionAndFlush,
  order: CandidateOrder,
  tally: { confirmed: number; failed: number },
): Promise<void> {
  try {
    const result = await confirmOrderFn(
      {
        supabase: deps.supabase,
        paymentProvider: deps.paymentProvider,
        postHogEnv: deps.postHogEnv,
        captureFn: deps.captureFn,
      },
      { orderId: order.id, providerChargeId: order.providerChargeId },
    );
    applyOutcome(result.outcome, tally);
  } catch (error) {
    // One order's failure must never abort the batch -- capture and move on.
    await captureException(deps.postHogEnv, {
      distinctId: order.id,
      error,
      properties: { orderId: order.id },
    });
    tally.failed += 1;
  }
}

export async function handlePaymentsReconcileRequest(
  request: Request,
  deps: ReconcileDeps,
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
  let body: ReconcileRequestBody;
  try {
    body = await parseJsonBody<ReconcileRequestBody>(request);
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

  const fetchCandidateOrdersFn = deps.fetchCandidateOrdersFn ?? fetchCandidateOrders;
  const confirmOrderFn = deps.confirmOrderFn ?? confirmOrder;
  const expireStaleOrdersFn = deps.expireStaleOrdersFn ?? expireStaleOrders;
  const capture = deps.captureFn ?? captureAndFlush;
  const captureException = deps.captureExceptionFn ?? captureExceptionAndFlush;

  let candidates: readonly CandidateOrder[];
  try {
    candidates = await fetchCandidateOrdersFn(deps.supabase, effectiveLimit);
  } catch (error) {
    await captureException(deps.postHogEnv, {
      distinctId: CRON_DISTINCT_ID,
      error,
      properties: { reason: 'reconcile_candidate_lookup_failed' },
    });
    return internalErrorResponse();
  }

  const tally = { confirmed: 0, failed: 0 };

  // Reconciliation pass first -- each order is isolated in its own
  // try/catch inside `reconcileCandidate`, so one bad order never aborts the
  // batch. Sequential (not `Promise.all`) is deliberate: batches are capped
  // at 100 by `resolveEffectiveLimit`, and this keeps gateway call volume to
  // the reconcile cron predictable rather than bursty.
  for (const order of candidates) {
    await reconcileCandidate(deps, confirmOrderFn, captureException, order, tally);
  }

  // Expiry sweep AFTER reconciliation -- by now, any order confirmed above
  // is no longer `status = 'pending'`, so `expire_stale_orders`'s own
  // `WHERE status = 'pending'` filter naturally excludes it.
  const expireResult = await expireStaleOrdersFn(deps.supabase, effectiveLimit);
  if (expireResult.error) {
    await captureException(deps.postHogEnv, {
      distinctId: CRON_DISTINCT_ID,
      error: expireResult.error,
      properties: { reason: 'reconcile_expire_stale_orders_failed' },
    });
  }

  const finalTally: ReconcileTally = {
    scanned: candidates.length,
    confirmed: tally.confirmed,
    expired: expireResult.expired,
    failed: tally.failed,
  };

  await capture(deps.postHogEnv, {
    event: 'reconcile_tick',
    distinctId: CRON_DISTINCT_ID,
    properties: { ...finalTally },
  });

  return jsonResponse(finalTally);
}

// Real wiring only runs when this module is the process entry point (i.e.
// deployed/served directly), never on import -- keeps `deno test` from
// paying `loadBackendConfig()`'s fail-fast env validation just to import
// `handlePaymentsReconcileRequest` for testing (same convention as
// `video-resolve/index.ts`).
if (import.meta.main) {
  const config = loadBackendConfig();
  const supabase = createServiceRoleClient();
  const paymentProvider = new MercadoPagoProvider({
    accessToken: config.mercadoPago.accessToken,
    webhookSecret: config.mercadoPago.webhookSecret,
  });
  const deps: ReconcileDeps = {
    cronSecret: config.cronSecret,
    postHogEnv: config.postHog,
    supabase,
    paymentProvider,
  };
  Deno.serve((request) => handlePaymentsReconcileRequest(request, deps));
}
