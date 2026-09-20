import { assertEquals, assertExists, assertMatch } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymentProvider } from '../../../contracts/payments.ts';
import { handlePaymentsReconcileRequest, type ReconcileDeps } from './index.ts';
import type { CandidateOrder } from './candidates.ts';
import type { ConfirmOrderResult } from '../_shared/payments/confirm-order.ts';
import type { ExpireStaleOrdersResult } from './expire-stale.ts';
import type {
  CaptureEventInput,
  CaptureExceptionInput,
  CaptureResult,
  PostHogEnv,
} from '../_shared/observability.ts';

const CRON_SECRET = 'test-cron-secret';
const POSTHOG_ENV: PostHogEnv = { apiKey: 'phc_test', host: 'https://us.i.posthog.com' };
const FUNCTION_URL = 'https://example.com/functions/v1/payments-reconcile';

const FAKE_SUPABASE = {} as unknown as SupabaseClient;
const FAKE_PAYMENT_PROVIDER = {} as unknown as PaymentProvider;

function fakeCapture(): {
  fn: (env: PostHogEnv, input: CaptureEventInput) => Promise<CaptureResult>;
  calls: CaptureEventInput[];
} {
  const calls: CaptureEventInput[] = [];
  return { calls, fn: (_env, input) => (calls.push(input), Promise.resolve({ ok: true })) };
}

function fakeCaptureException(): {
  fn: (env: PostHogEnv, input: CaptureExceptionInput) => Promise<CaptureResult>;
  calls: CaptureExceptionInput[];
} {
  const calls: CaptureExceptionInput[] = [];
  return { calls, fn: (_env, input) => (calls.push(input), Promise.resolve({ ok: true })) };
}

function fakeFetchCandidateOrders(
  candidates: readonly CandidateOrder[],
): {
  fn: (client: SupabaseClient, limit: number) => Promise<readonly CandidateOrder[]>;
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

const DEFAULT_EXPIRE_RESULT: ExpireStaleOrdersResult = { expired: 0, error: null };

function fakeExpireStaleOrders(
  result: ExpireStaleOrdersResult = DEFAULT_EXPIRE_RESULT,
): {
  fn: (client: SupabaseClient, limit: number) => Promise<ExpireStaleOrdersResult>;
  calls: number[];
} {
  const calls: number[] = [];
  return {
    calls,
    fn: (_client, limit) => {
      calls.push(limit);
      return Promise.resolve(result);
    },
  };
}

// `captureFn`/`captureExceptionFn` MUST be defaulted here to fakes, same as
// every other collaborator -- code-review finding, 2026-09-03: without this,
// any test that doesn't explicitly override them falls through
// `deps.captureFn ?? captureAndFlush` to the REAL `captureAndFlush`, which
// performs a genuine `fetch` to PostHog's real API. These tests only ever
// "passed" because `deno task test` runs without `--allow-net`, so the
// fetch throws a permission error that `captureAndFlush`'s own try/catch
// silently swallows into an unchecked `{ ok: false }` -- not a real pass,
// just an accidentally-inert network call. Defaulting to no-op fakes here
// makes every test hermetic and deterministic regardless of the sandbox's
// permission set.
function baseDeps(overrides: Partial<ReconcileDeps> = {}): ReconcileDeps {
  return {
    cronSecret: CRON_SECRET,
    postHogEnv: POSTHOG_ENV,
    supabase: FAKE_SUPABASE,
    paymentProvider: FAKE_PAYMENT_PROVIDER,
    fetchCandidateOrdersFn: fakeFetchCandidateOrders([]).fn,
    expireStaleOrdersFn: fakeExpireStaleOrders().fn,
    captureFn: fakeCapture().fn,
    captureExceptionFn: fakeCaptureException().fn,
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

Deno.test('handlePaymentsReconcileRequest returns the CORS preflight response for OPTIONS', async () => {
  const response = await handlePaymentsReconcileRequest(
    new Request(FUNCTION_URL, { method: 'OPTIONS' }),
    baseDeps(),
  );
  assertEquals(response.status, 204);
});

Deno.test('handlePaymentsReconcileRequest rejects non-POST methods with 405', async () => {
  const response = await handlePaymentsReconcileRequest(
    new Request(FUNCTION_URL, { method: 'GET' }),
    baseDeps(),
  );
  assertEquals(response.status, 405);
  const body = await response.json();
  assertEquals(body.error.code, 'method_not_allowed');
  assertExists(body.error.requestId);
});

Deno.test('handlePaymentsReconcileRequest returns 401 when X-Cron-Secret is missing, without touching the DB', async () => {
  const fetchCandidates = fakeFetchCandidateOrders([]);
  const response = await handlePaymentsReconcileRequest(
    cronRequest({}, {}),
    baseDeps({ fetchCandidateOrdersFn: fetchCandidates.fn }),
  );
  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error.code, 'unauthorized');
  assertEquals(fetchCandidates.calls.length, 0);
});

Deno.test('handlePaymentsReconcileRequest returns 401 when X-Cron-Secret is wrong, without touching the DB', async () => {
  const fetchCandidates = fakeFetchCandidateOrders([]);
  const response = await handlePaymentsReconcileRequest(
    cronRequest({}, { 'X-Cron-Secret': 'wrong-secret' }),
    baseDeps({ fetchCandidateOrdersFn: fetchCandidates.fn }),
  );
  assertEquals(response.status, 401);
  assertEquals(fetchCandidates.calls.length, 0);
});

Deno.test('handlePaymentsReconcileRequest defaults to limit 100 on an empty body', async () => {
  const fetchCandidates = fakeFetchCandidateOrders([]);
  const response = await handlePaymentsReconcileRequest(
    emptyBodyCronRequest(),
    baseDeps({ fetchCandidateOrdersFn: fetchCandidates.fn }),
  );
  assertEquals(response.status, 200);
  assertEquals(fetchCandidates.calls, [100]);
});

Deno.test('handlePaymentsReconcileRequest defaults to limit 100 on malformed JSON (BodyParseError defaults to {})', async () => {
  const fetchCandidates = fakeFetchCandidateOrders([]);
  const request = new Request(FUNCTION_URL, {
    method: 'POST',
    headers: { 'X-Cron-Secret': CRON_SECRET, 'Content-Type': 'application/json' },
    body: '{not-json',
  });
  const response = await handlePaymentsReconcileRequest(
    request,
    baseDeps({ fetchCandidateOrdersFn: fetchCandidates.fn }),
  );
  assertEquals(response.status, 200);
  assertEquals(fetchCandidates.calls, [100]);
});

Deno.test('handlePaymentsReconcileRequest passes an explicit valid limit through', async () => {
  const fetchCandidates = fakeFetchCandidateOrders([]);
  const response = await handlePaymentsReconcileRequest(
    cronRequest({ limit: 17 }),
    baseDeps({ fetchCandidateOrdersFn: fetchCandidates.fn }),
  );
  assertEquals(response.status, 200);
  assertEquals(fetchCandidates.calls, [17]);
});

Deno.test('handlePaymentsReconcileRequest clamps a limit above 100 down to 100', async () => {
  const fetchCandidates = fakeFetchCandidateOrders([]);
  const response = await handlePaymentsReconcileRequest(
    cronRequest({ limit: 5000 }),
    baseDeps({ fetchCandidateOrdersFn: fetchCandidates.fn }),
  );
  assertEquals(response.status, 200);
  assertEquals(fetchCandidates.calls, [100]);
});

Deno.test('handlePaymentsReconcileRequest returns 400 invalid_body for a non-positive-integer limit', async () => {
  const response = await handlePaymentsReconcileRequest(cronRequest({ limit: 0 }), baseDeps());
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, 'invalid_body');
});

Deno.test('handlePaymentsReconcileRequest returns 400 invalid_body for a non-numeric limit', async () => {
  const response = await handlePaymentsReconcileRequest(
    cronRequest({ limit: 'lots' }),
    baseDeps(),
  );
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, 'invalid_body');
});

Deno.test('handlePaymentsReconcileRequest returns 500 internal_error and captures the exception when the candidate lookup throws', async () => {
  const captureException = fakeCaptureException();
  const response = await handlePaymentsReconcileRequest(
    cronRequest({}),
    baseDeps({
      fetchCandidateOrdersFn: () => Promise.reject(new Error('db exploded')),
      captureExceptionFn: captureException.fn,
    }),
  );
  assertEquals(response.status, 500);
  const body = await response.json();
  assertEquals(body.error.code, 'internal_error');
  assertEquals(captureException.calls.length, 1);
});

Deno.test('handlePaymentsReconcileRequest returns zeros for an empty batch of candidates', async () => {
  const response = await handlePaymentsReconcileRequest(cronRequest({}), baseDeps());
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body, { scanned: 0, confirmed: 0, expired: 0, failed: 0 });
});

function candidate(id: string): CandidateOrder {
  return { id, providerChargeId: `charge-${id}` };
}

function outcomeConfirmOrderFn(
  outcomesByOrderId: Readonly<Record<string, ConfirmOrderResult['outcome'] | 'throw'>>,
): {
  fn: (
    deps: unknown,
    input: { orderId: string; providerChargeId: string },
  ) => Promise<ConfirmOrderResult>;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    // deno-lint-ignore require-await
    fn: async (_deps, input) => {
      calls.push(input.orderId);
      const outcome = outcomesByOrderId[input.orderId];
      if (outcome === 'throw') {
        throw new Error(`confirmOrder blew up for ${input.orderId}`);
      }
      switch (outcome) {
        case 'confirmed':
          return {
            outcome: 'confirmed',
            orderId: input.orderId,
            enrollmentId: 'enrollment-1',
            userId: 'user-1',
            courseId: 'course-1',
          };
        case 'already_confirmed':
          return { outcome: 'already_confirmed', orderId: input.orderId };
        case 'amount_mismatch':
          return {
            outcome: 'amount_mismatch',
            orderId: input.orderId,
            expectedCents: 1000,
            actualCents: 500,
          };
        case 'order_not_found':
          return { outcome: 'order_not_found', orderId: input.orderId };
        case 'not_paid':
        default:
          return { outcome: 'not_paid', orderId: input.orderId, chargeStatus: 'pending' };
      }
    },
  };
}

Deno.test('handlePaymentsReconcileRequest maps each confirmOrder outcome onto the right counter, in one batch', async () => {
  const candidates = [
    candidate('confirmed-1'),
    candidate('already-1'),
    candidate('mismatch-1'),
    candidate('not-found-1'),
    candidate('not-paid-1'),
  ];
  const confirmOrder = outcomeConfirmOrderFn({
    'confirmed-1': 'confirmed',
    'already-1': 'already_confirmed',
    'mismatch-1': 'amount_mismatch',
    'not-found-1': 'order_not_found',
    'not-paid-1': 'not_paid',
  });

  const response = await handlePaymentsReconcileRequest(
    cronRequest({}),
    baseDeps({
      fetchCandidateOrdersFn: fakeFetchCandidateOrders(candidates).fn,
      // deno-lint-ignore no-explicit-any
      confirmOrderFn: confirmOrder.fn as any,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body, { scanned: 5, confirmed: 2, expired: 0, failed: 2 });
  assertEquals(confirmOrder.calls.length, 5);
});

Deno.test('handlePaymentsReconcileRequest keeps processing the rest of the batch when confirmOrder throws for one order, and counts it as failed', async () => {
  const candidates = [candidate('ok-1'), candidate('boom-1'), candidate('ok-2')];
  const confirmOrder = outcomeConfirmOrderFn({
    'ok-1': 'confirmed',
    'boom-1': 'throw',
    'ok-2': 'confirmed',
  });
  const captureException = fakeCaptureException();

  const response = await handlePaymentsReconcileRequest(
    cronRequest({}),
    baseDeps({
      fetchCandidateOrdersFn: fakeFetchCandidateOrders(candidates).fn,
      // deno-lint-ignore no-explicit-any
      confirmOrderFn: confirmOrder.fn as any,
      captureExceptionFn: captureException.fn,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body, { scanned: 3, confirmed: 2, expired: 0, failed: 1 });
  assertEquals(confirmOrder.calls, ['ok-1', 'boom-1', 'ok-2']);
  assertEquals(captureException.calls.length, 1);
  assertEquals(captureException.calls[0]?.properties?.orderId, 'boom-1');
});

Deno.test('handlePaymentsReconcileRequest does not fail the whole request when expire_stale_orders errors -- reports expired:0 and captures the exception', async () => {
  const captureException = fakeCaptureException();
  const expireStale = fakeExpireStaleOrders({
    expired: 0,
    error: new Error('expire_stale_orders RPC failed: boom'),
  });

  const response = await handlePaymentsReconcileRequest(
    cronRequest({}),
    baseDeps({
      expireStaleOrdersFn: expireStale.fn,
      captureExceptionFn: captureException.fn,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body, { scanned: 0, confirmed: 0, expired: 0, failed: 0 });
  assertEquals(captureException.calls.length, 1);
});

Deno.test('handlePaymentsReconcileRequest reports the expired count from expire_stale_orders on success', async () => {
  const response = await handlePaymentsReconcileRequest(
    cronRequest({}),
    baseDeps({ expireStaleOrdersFn: fakeExpireStaleOrders({ expired: 4, error: null }).fn }),
  );
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.expired, 4);
});

Deno.test('handlePaymentsReconcileRequest captures a single reconcile_tick with the final tally', async () => {
  const candidates = [candidate('confirmed-1'), candidate('mismatch-1')];
  const confirmOrder = outcomeConfirmOrderFn({
    'confirmed-1': 'confirmed',
    'mismatch-1': 'amount_mismatch',
  });
  const capture = fakeCapture();

  const response = await handlePaymentsReconcileRequest(
    cronRequest({}),
    baseDeps({
      fetchCandidateOrdersFn: fakeFetchCandidateOrders(candidates).fn,
      // deno-lint-ignore no-explicit-any
      confirmOrderFn: confirmOrder.fn as any,
      expireStaleOrdersFn: fakeExpireStaleOrders({ expired: 3, error: null }).fn,
      captureFn: capture.fn,
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(capture.calls.length, 1);
  assertEquals(capture.calls[0]?.event, 'reconcile_tick');
  assertEquals(capture.calls[0]?.distinctId, 'cron');
  assertEquals(capture.calls[0]?.properties, { scanned: 2, confirmed: 1, expired: 3, failed: 1 });
});

Deno.test('handlePaymentsReconcileRequest error envelopes always include a requestId', async () => {
  const response = await handlePaymentsReconcileRequest(cronRequest({}, {}), baseDeps());
  const body = await response.json();
  assertMatch(
    body.error.requestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
});
