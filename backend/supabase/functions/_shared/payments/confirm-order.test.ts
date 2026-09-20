import { assertEquals, assertExists, assertRejects } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { confirmOrder, type ConfirmOrderDeps, type ConfirmOrderInput } from './confirm-order.ts';
import type {
  ChargeSnapshot,
  ChargeStatus,
  PaymentProvider,
} from '../../../../contracts/payments.ts';
import type { CaptureEventInput, CaptureResult, PostHogEnv } from '../observability.ts';

const POSTHOG_ENV: PostHogEnv = { apiKey: 'phc_test', host: 'https://us.i.posthog.com' };

const ORDER_ID = 'order-uuid-1';
const PROVIDER_CHARGE_ID = 'charge-123';
const USER_ID = 'user-uuid-1';
const COURSE_ID = 'course-uuid-1';

interface DbLikeError {
  readonly message: string;
}
interface DbResponse<T> {
  readonly data: T;
  readonly error: DbLikeError | null;
}

interface OrderRowFixture {
  readonly id: string;
  readonly user_id: string;
  readonly course_id: string;
  readonly amount_cents: number;
  readonly currency: string;
  readonly status: string;
}

interface ConfirmPaymentRowFixture {
  readonly did_transition: boolean;
  readonly order_status: string;
  readonly enrollment_id: string | null;
  readonly user_id: string;
  readonly course_id: string;
}

interface FakeSupabaseResponses {
  readonly order?: DbResponse<OrderRowFixture | null>;
  readonly user?: DbResponse<{ email: string } | null>;
  readonly confirmPayment?: DbResponse<ConfirmPaymentRowFixture[] | null>;
  readonly enqueueEmail?: DbResponse<string | null>;
}

interface RpcCall {
  readonly schema: string;
  readonly fn: string;
  readonly args: unknown;
}

interface EqCall {
  readonly table: string;
  readonly column: string;
  readonly value: unknown;
}

function defaultOrderRow(overrides: Partial<OrderRowFixture> = {}): OrderRowFixture {
  return {
    id: ORDER_ID,
    user_id: USER_ID,
    course_id: COURSE_ID,
    amount_cents: 4990,
    currency: 'BRL',
    status: 'pending',
    ...overrides,
  };
}

function defaultConfirmPaymentRow(
  overrides: Partial<ConfirmPaymentRowFixture> = {},
): ConfirmPaymentRowFixture {
  return {
    did_transition: true,
    order_status: 'paid',
    enrollment_id: 'enrollment-uuid-1',
    user_id: USER_ID,
    course_id: COURSE_ID,
    ...overrides,
  };
}

function createFakeSupabase(responses: FakeSupabaseResponses) {
  const rpcCalls: RpcCall[] = [];
  const eqCalls: EqCall[] = [];

  const client = {
    from(table: string) {
      return {
        select(_columns: string) {
          return {
            eq(column: string, value: unknown) {
              eqCalls.push({ table, column, value });
              return {
                maybeSingle: () =>
                  Promise.resolve(
                    table === 'orders' ? (responses.order ?? { data: null, error: null }) : {
                      data: null,
                      error: null,
                    },
                  ),
                single: () =>
                  Promise.resolve(
                    table === 'users' ? (responses.user ?? { data: null, error: null }) : {
                      data: null,
                      error: null,
                    },
                  ),
              };
            },
          };
        },
      };
    },
    schema(schemaName: string) {
      return {
        rpc(fn: string, args: unknown) {
          rpcCalls.push({ schema: schemaName, fn, args });
          if (fn === 'confirm_payment') {
            return Promise.resolve(responses.confirmPayment ?? { data: [], error: null });
          }
          if (fn === 'enqueue_email') {
            return Promise.resolve(
              responses.enqueueEmail ?? { data: 'email-uuid-1', error: null },
            );
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };

  return { client: client as unknown as SupabaseClient, rpcCalls, eqCalls };
}

function fakePaymentProvider(
  snapshot: ChargeSnapshot | Error,
): { provider: PaymentProvider; calls: string[] } {
  const calls: string[] = [];
  const provider: PaymentProvider = {
    id: 'mercadopago',
    createPixCharge: () => {
      throw new Error('createPixCharge not implemented in fake');
    },
    getChargeStatus: (providerChargeId: string) => {
      calls.push(providerChargeId);
      if (snapshot instanceof Error) {
        return Promise.reject(snapshot);
      }
      return Promise.resolve(snapshot);
    },
    parseWebhook: () => {
      throw new Error('parseWebhook not implemented in fake');
    },
  };
  return { provider, calls };
}

function defaultChargeSnapshot(overrides: Partial<ChargeSnapshot> = {}): ChargeSnapshot {
  return {
    providerChargeId: PROVIDER_CHARGE_ID,
    externalReference: ORDER_ID,
    status: 'paid',
    amount: { amountCents: 4990, currency: 'BRL' },
    paidAt: '2026-01-10T12:00:00.000Z',
    raw: {},
    ...overrides,
  };
}

function fakeCapture(result: CaptureResult = { ok: true }) {
  const calls: CaptureEventInput[] = [];
  const fn = (_env: PostHogEnv, input: CaptureEventInput) => {
    calls.push(input);
    return Promise.resolve(result);
  };
  return { fn, calls };
}

function buildInput(overrides: Partial<ConfirmOrderInput> = {}): ConfirmOrderInput {
  return { orderId: ORDER_ID, providerChargeId: PROVIDER_CHARGE_ID, ...overrides };
}

Deno.test('confirmOrder returns order_not_found and never calls the gateway when the order does not exist', async () => {
  const { client, rpcCalls } = createFakeSupabase({ order: { data: null, error: null } });
  const { provider, calls: gatewayCalls } = fakePaymentProvider(defaultChargeSnapshot());
  const deps: ConfirmOrderDeps = {
    supabase: client,
    paymentProvider: provider,
    postHogEnv: POSTHOG_ENV,
  };

  const result = await confirmOrder(deps, buildInput());

  assertEquals(result, { outcome: 'order_not_found', orderId: ORDER_ID });
  assertEquals(gatewayCalls.length, 0);
  assertEquals(rpcCalls.length, 0);
});

Deno.test('confirmOrder short-circuits on an already-paid order without calling the gateway', async () => {
  const { client, rpcCalls } = createFakeSupabase({
    order: { data: defaultOrderRow({ status: 'paid' }), error: null },
  });
  const { provider, calls: gatewayCalls } = fakePaymentProvider(defaultChargeSnapshot());
  const deps: ConfirmOrderDeps = {
    supabase: client,
    paymentProvider: provider,
    postHogEnv: POSTHOG_ENV,
  };

  const result = await confirmOrder(deps, buildInput());

  assertEquals(result, { outcome: 'already_confirmed', orderId: ORDER_ID });
  assertEquals(gatewayCalls.length, 0);
  assertEquals(rpcCalls.length, 0);
});

Deno.test('confirmOrder returns amount_mismatch when the gateway charge is under the order amount', async () => {
  const { client } = createFakeSupabase({
    order: { data: defaultOrderRow({ amount_cents: 4990 }), error: null },
  });
  const { provider } = fakePaymentProvider(
    defaultChargeSnapshot({ amount: { amountCents: 100, currency: 'BRL' } }),
  );
  const { fn: captureFn, calls: captureCalls } = fakeCapture();
  const deps: ConfirmOrderDeps = {
    supabase: client,
    paymentProvider: provider,
    postHogEnv: POSTHOG_ENV,
    captureFn,
  };

  const result = await confirmOrder(deps, buildInput());

  assertEquals(result, {
    outcome: 'amount_mismatch',
    orderId: ORDER_ID,
    expectedCents: 4990,
    actualCents: 100,
  });
  assertEquals(captureCalls.length, 1);
  const call = captureCalls[0];
  assertExists(call);
  assertEquals(call.event, 'payment_amount_mismatch');
  assertEquals(call.distinctId, USER_ID);
  assertEquals(call.properties?.expectedCents, 4990);
  assertEquals(call.properties?.actualCents, 100);
});

Deno.test('confirmOrder returns amount_mismatch when the gateway charge is over the order amount', async () => {
  const { client } = createFakeSupabase({
    order: { data: defaultOrderRow({ amount_cents: 4990 }), error: null },
  });
  const { provider } = fakePaymentProvider(
    defaultChargeSnapshot({ amount: { amountCents: 9999, currency: 'BRL' } }),
  );
  const deps: ConfirmOrderDeps = {
    supabase: client,
    paymentProvider: provider,
    postHogEnv: POSTHOG_ENV,
  };

  const result = await confirmOrder(deps, buildInput());

  assertEquals(result, {
    outcome: 'amount_mismatch',
    orderId: ORDER_ID,
    expectedCents: 4990,
    actualCents: 9999,
  });
});

Deno.test('confirmOrder treats a currency mismatch as an amount_mismatch even when cents match', async () => {
  const { client } = createFakeSupabase({
    order: { data: defaultOrderRow({ amount_cents: 4990, currency: 'USD' }), error: null },
  });
  const { provider } = fakePaymentProvider(
    defaultChargeSnapshot({ amount: { amountCents: 4990, currency: 'BRL' } }),
  );
  const deps: ConfirmOrderDeps = {
    supabase: client,
    paymentProvider: provider,
    postHogEnv: POSTHOG_ENV,
  };

  const result = await confirmOrder(deps, buildInput());

  assertEquals(result.outcome, 'amount_mismatch');
});

const NOT_PAID_STATUSES: readonly ChargeStatus[] = ['pending', 'expired', 'cancelled', 'unknown'];

for (const status of NOT_PAID_STATUSES) {
  Deno.test(`confirmOrder returns not_paid with chargeStatus "${status}" and does not mutate the order`, async () => {
    const { client, rpcCalls } = createFakeSupabase({
      order: { data: defaultOrderRow(), error: null },
    });
    const { provider } = fakePaymentProvider(defaultChargeSnapshot({ status }));
    const deps: ConfirmOrderDeps = {
      supabase: client,
      paymentProvider: provider,
      postHogEnv: POSTHOG_ENV,
    };

    const result = await confirmOrder(deps, buildInput());

    assertEquals(result, { outcome: 'not_paid', orderId: ORDER_ID, chargeStatus: status });
    assertEquals(rpcCalls.length, 0);
  });
}

Deno.test('confirmOrder happy path: confirms, enqueues the confirmation email, and captures payment_confirmed', async () => {
  const { client, rpcCalls } = createFakeSupabase({
    order: { data: defaultOrderRow(), error: null },
    confirmPayment: { data: [defaultConfirmPaymentRow()], error: null },
    user: { data: { email: 'buyer@example.com' }, error: null },
  });
  const { provider } = fakePaymentProvider(defaultChargeSnapshot());
  const { fn: captureFn, calls: captureCalls } = fakeCapture();
  const deps: ConfirmOrderDeps = {
    supabase: client,
    paymentProvider: provider,
    postHogEnv: POSTHOG_ENV,
    captureFn,
  };

  const result = await confirmOrder(deps, buildInput());

  assertEquals(result, {
    outcome: 'confirmed',
    orderId: ORDER_ID,
    enrollmentId: 'enrollment-uuid-1',
    userId: USER_ID,
    courseId: COURSE_ID,
  });

  const confirmCall = rpcCalls.find((call) => call.fn === 'confirm_payment');
  assertExists(confirmCall);
  assertEquals(confirmCall.schema, 'app');
  assertEquals(confirmCall.args, {
    p_order_id: ORDER_ID,
    p_provider_charge_id: PROVIDER_CHARGE_ID,
    p_paid_at: '2026-01-10T12:00:00.000Z',
  });

  const enqueueCall = rpcCalls.find((call) => call.fn === 'enqueue_email');
  assertExists(enqueueCall);
  assertEquals(enqueueCall.schema, 'app');
  assertEquals(enqueueCall.args, {
    p_template: 'purchase_confirmation',
    p_to_email: 'buyer@example.com',
    p_payload: { order_id: ORDER_ID, course_id: COURSE_ID, enrollment_id: 'enrollment-uuid-1' },
    p_dedup_key: `purchase_confirmation:${ORDER_ID}`,
  });

  assertEquals(captureCalls.length, 1);
  const call = captureCalls[0];
  assertExists(call);
  assertEquals(call.event, 'payment_confirmed');
  assertEquals(call.distinctId, USER_ID);
  assertEquals(call.properties?.enrollmentId, 'enrollment-uuid-1');
});

Deno.test('confirmOrder uses the current time as p_paid_at when the gateway snapshot has no paidAt', async () => {
  const { client, rpcCalls } = createFakeSupabase({
    order: { data: defaultOrderRow(), error: null },
    confirmPayment: { data: [defaultConfirmPaymentRow()], error: null },
    user: { data: { email: 'buyer@example.com' }, error: null },
  });
  const { provider } = fakePaymentProvider(defaultChargeSnapshot({ paidAt: null }));
  const deps: ConfirmOrderDeps = {
    supabase: client,
    paymentProvider: provider,
    postHogEnv: POSTHOG_ENV,
  };

  await confirmOrder(deps, buildInput());

  const confirmCall = rpcCalls.find((call) => call.fn === 'confirm_payment');
  assertExists(confirmCall);
  const args = confirmCall.args as { p_paid_at: string };
  assertExists(args.p_paid_at);
  assertEquals(Number.isNaN(new Date(args.p_paid_at).getTime()), false);
});

Deno.test('confirmOrder handles a null enrollment_id on a true did_transition without crashing', async () => {
  const { client } = createFakeSupabase({
    order: { data: defaultOrderRow(), error: null },
    confirmPayment: {
      data: [defaultConfirmPaymentRow({ enrollment_id: null })],
      error: null,
    },
    user: { data: { email: 'buyer@example.com' }, error: null },
  });
  const { provider } = fakePaymentProvider(defaultChargeSnapshot());
  const deps: ConfirmOrderDeps = {
    supabase: client,
    paymentProvider: provider,
    postHogEnv: POSTHOG_ENV,
  };

  const result = await confirmOrder(deps, buildInput());

  assertEquals(result, {
    outcome: 'confirmed',
    orderId: ORDER_ID,
    enrollmentId: null,
    userId: USER_ID,
    courseId: COURSE_ID,
  });
});

Deno.test('confirmOrder returns already_confirmed when did_transition is false (concurrent/duplicate race)', async () => {
  const { client, rpcCalls } = createFakeSupabase({
    order: { data: defaultOrderRow(), error: null },
    confirmPayment: {
      data: [defaultConfirmPaymentRow({ did_transition: false })],
      error: null,
    },
  });
  const { provider } = fakePaymentProvider(defaultChargeSnapshot());
  const deps: ConfirmOrderDeps = {
    supabase: client,
    paymentProvider: provider,
    postHogEnv: POSTHOG_ENV,
  };

  const result = await confirmOrder(deps, buildInput());

  assertEquals(result, { outcome: 'already_confirmed', orderId: ORDER_ID });
  const enqueueCall = rpcCalls.find((call) => call.fn === 'enqueue_email');
  assertEquals(enqueueCall, undefined);
});

Deno.test('confirmOrder throws (does not swallow) when confirm_payment RPC returns an error', async () => {
  const { client } = createFakeSupabase({
    order: { data: defaultOrderRow(), error: null },
    confirmPayment: { data: null, error: { message: 'connection reset' } },
  });
  const { provider } = fakePaymentProvider(defaultChargeSnapshot());
  const deps: ConfirmOrderDeps = {
    supabase: client,
    paymentProvider: provider,
    postHogEnv: POSTHOG_ENV,
  };

  await assertRejects(() => confirmOrder(deps, buildInput()), Error, 'connection reset');
});

Deno.test('confirmOrder throws when the order select itself errors', async () => {
  const { client } = createFakeSupabase({
    order: { data: null, error: { message: 'db unreachable' } },
  });
  const { provider } = fakePaymentProvider(defaultChargeSnapshot());
  const deps: ConfirmOrderDeps = {
    supabase: client,
    paymentProvider: provider,
    postHogEnv: POSTHOG_ENV,
  };

  await assertRejects(() => confirmOrder(deps, buildInput()), Error, 'db unreachable');
});

Deno.test('confirmOrder throws when the user email lookup errors after a successful transition', async () => {
  const { client } = createFakeSupabase({
    order: { data: defaultOrderRow(), error: null },
    confirmPayment: { data: [defaultConfirmPaymentRow()], error: null },
    user: { data: null, error: { message: 'user row missing' } },
  });
  const { provider } = fakePaymentProvider(defaultChargeSnapshot());
  const deps: ConfirmOrderDeps = {
    supabase: client,
    paymentProvider: provider,
    postHogEnv: POSTHOG_ENV,
  };

  await assertRejects(() => confirmOrder(deps, buildInput()), Error, 'user row missing');
});

Deno.test('confirmOrder throws when enqueue_email RPC errors', async () => {
  const { client } = createFakeSupabase({
    order: { data: defaultOrderRow(), error: null },
    confirmPayment: { data: [defaultConfirmPaymentRow()], error: null },
    user: { data: { email: 'buyer@example.com' }, error: null },
    enqueueEmail: { data: null, error: { message: 'dedup key conflict handling failed' } },
  });
  const { provider } = fakePaymentProvider(defaultChargeSnapshot());
  const deps: ConfirmOrderDeps = {
    supabase: client,
    paymentProvider: provider,
    postHogEnv: POSTHOG_ENV,
  };

  await assertRejects(
    () => confirmOrder(deps, buildInput()),
    Error,
    'dedup key conflict handling failed',
  );
});

Deno.test('confirmOrder still returns its normal result when analytics capture fails (ok:false, never throws)', async () => {
  const { client } = createFakeSupabase({
    order: { data: defaultOrderRow(), error: null },
    confirmPayment: { data: [defaultConfirmPaymentRow()], error: null },
    user: { data: { email: 'buyer@example.com' }, error: null },
  });
  const { provider } = fakePaymentProvider(defaultChargeSnapshot());
  const { fn: captureFn, calls: captureCalls } = fakeCapture({ ok: false, error: 'posthog down' });
  const deps: ConfirmOrderDeps = {
    supabase: client,
    paymentProvider: provider,
    postHogEnv: POSTHOG_ENV,
    captureFn,
  };

  const result = await confirmOrder(deps, buildInput());

  assertEquals(result.outcome, 'confirmed');
  assertEquals(captureCalls.length, 1);
});

Deno.test('confirmOrder propagates a rejected getChargeStatus call from the gateway', async () => {
  const { client } = createFakeSupabase({ order: { data: defaultOrderRow(), error: null } });
  const { provider } = fakePaymentProvider(new Error('gateway unreachable'));
  const deps: ConfirmOrderDeps = {
    supabase: client,
    paymentProvider: provider,
    postHogEnv: POSTHOG_ENV,
  };

  await assertRejects(() => confirmOrder(deps, buildInput()), Error, 'gateway unreachable');
});

Deno.test('confirmOrder throws when confirm_payment RPC returns no rows at all', async () => {
  const { client } = createFakeSupabase({
    order: { data: defaultOrderRow(), error: null },
    confirmPayment: { data: [], error: null },
  });
  const { provider } = fakePaymentProvider(defaultChargeSnapshot());
  const deps: ConfirmOrderDeps = {
    supabase: client,
    paymentProvider: provider,
    postHogEnv: POSTHOG_ENV,
  };

  await assertRejects(() => confirmOrder(deps, buildInput()), Error, 'returned no row');
});
