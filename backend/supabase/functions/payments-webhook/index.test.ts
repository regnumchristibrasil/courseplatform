import { assertEquals, assertExists } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { handlePaymentsWebhook, type PaymentsWebhookDeps } from './index.ts';
import type {
  PaymentProvider,
  WebhookEvent,
  WebhookParseResult,
  WebhookRequest,
} from '../../../contracts/payments.ts';
import type {
  confirmOrder,
  ConfirmOrderDeps,
  ConfirmOrderInput,
  ConfirmOrderResult,
} from '../_shared/payments/confirm-order.ts';
import type {
  CaptureEventInput,
  CaptureExceptionInput,
  CaptureResult,
  PostHogEnv,
} from '../_shared/observability.ts';

const POSTHOG_ENV: PostHogEnv = { apiKey: 'phc_test', host: 'https://us.i.posthog.com' };
const FUNCTION_URL = 'https://example.com/functions/v1/payments-webhook';
const ORDER_ID = 'order-uuid-1';
const PAYMENT_EVENT_ID = 'payment-event-uuid-1';

interface DbLikeError {
  readonly message: string;
  readonly code?: string;
}
interface DbResponse<T> {
  readonly data: T;
  readonly error: DbLikeError | null;
}

interface FakeSupabaseOptions {
  readonly insertResponses?: readonly DbResponse<{ id: string } | null>[];
  readonly lookupResponse?: DbResponse<{ id: string } | null>;
  readonly updateResponse?: DbResponse<null>;
  // `public.orders` lookup by `provider_charge_id` -- the fallback path when
  // `event.externalReference` is null (Mercado Pago's real-world case, see
  // `_shared/payments/mercadopago/webhook.ts`).
  readonly ordersLookupResponse?: DbResponse<{ id: string } | null>;
}

interface UpdateCall {
  readonly id: string;
  readonly patch: Record<string, unknown>;
}

// Fakes the `app_private.payment_events` surface this handler touches
// (insert/select/update, reached via `.schema(...)`) plus the
// `public.orders` fallback lookup by `provider_charge_id` (reached via
// `.from('orders')` directly, no `.schema(...)` call -- `orders` is in the
// default `public` schema). `confirmOrder` itself is always injected as a
// fake in these tests (it has its own full test suite in
// `_shared/payments/confirm-order.test.ts`), so this handler test never
// needs to fake `app.confirm_payment`/`app.enqueue_email`.
function createFakeSupabase(options: FakeSupabaseOptions = {}) {
  const insertCalls: Record<string, unknown>[] = [];
  const lookupCalls: { provider: string; eventId: string }[] = [];
  const updateCalls: UpdateCall[] = [];
  const ordersLookupCalls: { providerChargeId: string }[] = [];
  let insertCallIndex = 0;

  const client = {
    schema(_schemaName: string) {
      return {
        from(_table: string) {
          return {
            insert(payload: Record<string, unknown>) {
              insertCalls.push(payload);
              const response = options.insertResponses?.[insertCallIndex] ??
                { data: { id: PAYMENT_EVENT_ID }, error: null };
              insertCallIndex += 1;
              return {
                select(_columns: string) {
                  return { single: () => Promise.resolve(response) };
                },
              };
            },
            select(_columns: string) {
              return {
                eq(_col1: string, provider: unknown) {
                  return {
                    eq(_col2: string, eventId: unknown) {
                      lookupCalls.push({
                        provider: provider as string,
                        eventId: eventId as string,
                      });
                      return {
                        maybeSingle: () =>
                          Promise.resolve(options.lookupResponse ?? { data: null, error: null }),
                      };
                    },
                  };
                },
              };
            },
            update(patch: Record<string, unknown>) {
              return {
                eq(_col: string, id: unknown) {
                  updateCalls.push({ id: id as string, patch });
                  return Promise.resolve(options.updateResponse ?? { data: null, error: null });
                },
              };
            },
          };
        },
      };
    },
    from(table: string) {
      if (table !== 'orders') {
        throw new Error(`fake supabase: unexpected .from("${table}") outside .schema(...)`);
      }
      return {
        select(_columns: string) {
          return {
            eq(_col: string, providerChargeId: unknown) {
              ordersLookupCalls.push({ providerChargeId: providerChargeId as string });
              return {
                maybeSingle: () =>
                  Promise.resolve(options.ordersLookupResponse ?? { data: null, error: null }),
              };
            },
          };
        },
      };
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    insertCalls,
    lookupCalls,
    updateCalls,
    ordersLookupCalls,
  };
}

function buildEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    provider: 'mercadopago',
    eventId: 'evt-1',
    providerChargeId: 'charge-1',
    externalReference: ORDER_ID,
    hintedStatus: 'unknown',
    receivedAt: '2026-01-10T12:00:00.000Z',
    raw: { id: 'evt-1', raw: true },
    ...overrides,
  };
}

function fakePaymentProvider(
  parseWebhookImpl: (req: WebhookRequest) => Promise<WebhookParseResult>,
): { provider: PaymentProvider; calls: WebhookRequest[] } {
  const calls: WebhookRequest[] = [];
  const provider: PaymentProvider = {
    id: 'mercadopago',
    createPixCharge: () => {
      throw new Error('createPixCharge not implemented in fake');
    },
    getChargeStatus: () => {
      throw new Error('getChargeStatus not implemented in fake');
    },
    parseWebhook: (req: WebhookRequest) => {
      calls.push(req);
      return parseWebhookImpl(req);
    },
  };
  return { provider, calls };
}

function okParseResult(events: readonly WebhookEvent[]): WebhookParseResult {
  return { ok: true, events };
}

function fakeConfirmOrder(
  resultOrError:
    | ConfirmOrderResult
    | Error
    | ((input: ConfirmOrderInput) => Promise<ConfirmOrderResult>),
): { fn: typeof confirmOrder; calls: ConfirmOrderInput[] } {
  const calls: ConfirmOrderInput[] = [];
  const fn = ((_deps: ConfirmOrderDeps, input: ConfirmOrderInput) => {
    calls.push(input);
    if (typeof resultOrError === 'function') {
      return resultOrError(input);
    }
    if (resultOrError instanceof Error) {
      return Promise.reject(resultOrError);
    }
    return Promise.resolve(resultOrError);
  }) as typeof confirmOrder;
  return { fn, calls };
}

function confirmedResult(overrides: Partial<ConfirmOrderResult> = {}): ConfirmOrderResult {
  return {
    outcome: 'confirmed',
    orderId: ORDER_ID,
    enrollmentId: 'enrollment-uuid-1',
    userId: 'user-uuid-1',
    courseId: 'course-uuid-1',
    ...overrides,
  } as ConfirmOrderResult;
}

function fakeCapture(): {
  fn: (env: PostHogEnv, input: CaptureEventInput) => Promise<CaptureResult>;
  calls: CaptureEventInput[];
} {
  const calls: CaptureEventInput[] = [];
  return {
    calls,
    fn: (_env, input) => {
      calls.push(input);
      return Promise.resolve({ ok: true });
    },
  };
}

function fakeCaptureException(): {
  fn: (env: PostHogEnv, input: CaptureExceptionInput) => Promise<CaptureResult>;
  calls: CaptureExceptionInput[];
} {
  const calls: CaptureExceptionInput[] = [];
  return {
    calls,
    fn: (_env, input) => {
      calls.push(input);
      return Promise.resolve({ ok: true });
    },
  };
}

function postRequest(rawBody = '{"type":"payment","data":{"id":"charge-1"}}'): Request {
  return new Request(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-request-id': 'req-1' },
    body: rawBody,
  });
}

function baseDeps(overrides: Partial<PaymentsWebhookDeps> = {}): PaymentsWebhookDeps {
  const { provider } = fakePaymentProvider(() =>
    Promise.reject(new Error('parseWebhook not configured for this test'))
  );
  const { client } = createFakeSupabase();
  return {
    postHogEnv: POSTHOG_ENV,
    paymentProvider: provider,
    supabase: client,
    ...overrides,
  };
}

Deno.test('handlePaymentsWebhook returns the CORS preflight response for OPTIONS', async () => {
  const request = new Request(FUNCTION_URL, { method: 'OPTIONS' });
  const response = await handlePaymentsWebhook(request, baseDeps());
  assertEquals(response.status, 204);
});

Deno.test('handlePaymentsWebhook rejects non-POST methods with 405 (the one non-200 case)', async () => {
  const request = new Request(FUNCTION_URL, { method: 'GET' });
  const response = await handlePaymentsWebhook(request, baseDeps());
  assertEquals(response.status, 405);
  const body = await response.json();
  assertEquals(body.error.code, 'method_not_allowed');
  assertExists(body.error.requestId);
});

for (const reason of ['invalid_signature', 'malformed', 'unsupported_event'] as const) {
  Deno.test(
    `handlePaymentsWebhook still returns 200 { received: true } and captures payment_webhook_failed for parseWebhook reason "${reason}"`,
    async () => {
      const { provider } = fakePaymentProvider(() =>
        Promise.resolve({ ok: false, reason, detail: `detail for ${reason}` })
      );
      const capture = fakeCapture();

      const response = await handlePaymentsWebhook(
        postRequest(),
        baseDeps({ paymentProvider: provider, captureFn: capture.fn }),
      );

      assertEquals(response.status, 200);
      assertEquals(await response.json(), { received: true });
      assertEquals(capture.calls.length, 1);
      assertEquals(capture.calls[0]?.event, 'payment_webhook_failed');
      assertEquals(capture.calls[0]?.distinctId, 'system');
      assertEquals(capture.calls[0]?.properties?.reason, reason);
      assertEquals(capture.calls[0]?.properties?.detail, `detail for ${reason}`);
    },
  );
}

Deno.test('handlePaymentsWebhook happy path: one event confirms, inserts + marks the payment_events row processed', async () => {
  const event = buildEvent();
  const { provider } = fakePaymentProvider(() => Promise.resolve(okParseResult([event])));
  const { client, insertCalls, updateCalls } = createFakeSupabase();
  const capture = fakeCapture();
  const { fn: confirmOrderFn, calls: confirmCalls } = fakeConfirmOrder(confirmedResult());

  const response = await handlePaymentsWebhook(
    postRequest(),
    baseDeps({
      paymentProvider: provider,
      supabase: client,
      captureFn: capture.fn,
      confirmOrderFn,
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { received: true });

  assertEquals(insertCalls.length, 1);
  assertEquals(insertCalls[0]?.provider, 'mercadopago');
  assertEquals(insertCalls[0]?.event_id, 'evt-1');

  assertEquals(confirmCalls.length, 1);
  assertEquals(confirmCalls[0], { orderId: ORDER_ID, providerChargeId: 'charge-1' });

  assertEquals(updateCalls.length, 1);
  assertEquals(updateCalls[0]?.id, PAYMENT_EVENT_ID);
  assertEquals(updateCalls[0]?.patch.status, 'processed');
  assertExists(updateCalls[0]?.patch.processed_at);

  const receivedCapture = capture.calls.find((c) => c.event === 'payment_webhook_received');
  assertExists(receivedCapture);
  assertEquals(receivedCapture.distinctId, ORDER_ID);
  assertEquals(receivedCapture.properties?.eventId, 'evt-1');
  assertEquals(receivedCapture.properties?.providerChargeId, 'charge-1');
  assertEquals(receivedCapture.properties?.provider, 'mercadopago');
});

Deno.test('handlePaymentsWebhook processes multiple events in one payload, calling confirmOrder for each', async () => {
  const eventA = buildEvent({ eventId: 'evt-a', providerChargeId: 'charge-a' });
  const eventB = buildEvent({ eventId: 'evt-b', providerChargeId: 'charge-b' });
  const { provider } = fakePaymentProvider(() => Promise.resolve(okParseResult([eventA, eventB])));
  const { client, insertCalls, updateCalls } = createFakeSupabase();
  const capture = fakeCapture();
  const { fn: confirmOrderFn, calls: confirmCalls } = fakeConfirmOrder(confirmedResult());

  const response = await handlePaymentsWebhook(
    postRequest(),
    baseDeps({
      paymentProvider: provider,
      supabase: client,
      captureFn: capture.fn,
      confirmOrderFn,
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(insertCalls.length, 2);
  assertEquals(confirmCalls.length, 2);
  assertEquals(confirmCalls.map((c) => c.providerChargeId), ['charge-a', 'charge-b']);
  assertEquals(updateCalls.length, 2);
  assertEquals(
    capture.calls.filter((c) => c.event === 'payment_webhook_received').length,
    2,
  );
});

Deno.test('handlePaymentsWebhook still calls confirmOrder on a duplicate (provider, event_id) insert conflict (23505)', async () => {
  const event = buildEvent();
  const { provider } = fakePaymentProvider(() => Promise.resolve(okParseResult([event])));
  const { client, updateCalls } = createFakeSupabase({
    insertResponses: [{ data: null, error: { message: 'duplicate key value', code: '23505' } }],
    lookupResponse: { data: { id: 'existing-payment-event-id' }, error: null },
  });
  const { fn: confirmOrderFn, calls: confirmCalls } = fakeConfirmOrder(confirmedResult());

  const response = await handlePaymentsWebhook(
    postRequest(),
    baseDeps({ paymentProvider: provider, supabase: client, confirmOrderFn }),
  );

  assertEquals(response.status, 200);
  assertEquals(confirmCalls.length, 1, 'confirmOrder must still run on a duplicate event row');
  assertEquals(updateCalls.length, 1);
  assertEquals(updateCalls[0]?.id, 'existing-payment-event-id');
  assertEquals(updateCalls[0]?.patch.status, 'processed');
});

Deno.test('handlePaymentsWebhook skips confirmOrder and marks the row failed on a non-23505 insert error', async () => {
  const event = buildEvent();
  const { provider } = fakePaymentProvider(() => Promise.resolve(okParseResult([event])));
  const { client } = createFakeSupabase({
    insertResponses: [{ data: null, error: { message: 'connection reset', code: '08006' } }],
  });
  const capture = fakeCapture();
  const { fn: confirmOrderFn, calls: confirmCalls } = fakeConfirmOrder(confirmedResult());

  const response = await handlePaymentsWebhook(
    postRequest(),
    baseDeps({
      paymentProvider: provider,
      supabase: client,
      captureFn: capture.fn,
      confirmOrderFn,
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(confirmCalls.length, 0);
  const failedCapture = capture.calls.find((c) => c.event === 'payment_webhook_failed');
  assertExists(failedCapture);
  assertEquals(failedCapture.properties?.reason, 'payment_events_insert_failed');
});

Deno.test('handlePaymentsWebhook marks payment_events failed and skips confirmOrder when externalReference is missing', async () => {
  const event = buildEvent({ externalReference: null });
  const { provider } = fakePaymentProvider(() => Promise.resolve(okParseResult([event])));
  const { client, updateCalls } = createFakeSupabase();
  const capture = fakeCapture();
  const { fn: confirmOrderFn, calls: confirmCalls } = fakeConfirmOrder(confirmedResult());

  const response = await handlePaymentsWebhook(
    postRequest(),
    baseDeps({
      paymentProvider: provider,
      supabase: client,
      captureFn: capture.fn,
      confirmOrderFn,
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(confirmCalls.length, 0);
  const failedCapture = capture.calls.find((c) => c.event === 'payment_webhook_failed');
  assertExists(failedCapture);
  assertEquals(failedCapture.properties, {
    eventId: 'evt-1',
    reason: 'missing_external_reference',
  });
  assertEquals(updateCalls.length, 1);
  assertEquals(updateCalls[0]?.patch.status, 'failed');
});

Deno.test('handlePaymentsWebhook falls back to a provider_charge_id lookup on orders when externalReference is missing, and calls confirmOrder with the found order id', async () => {
  const event = buildEvent({ externalReference: null, providerChargeId: 'charge-1' });
  const { provider } = fakePaymentProvider(() => Promise.resolve(okParseResult([event])));
  const { client, ordersLookupCalls, updateCalls } = createFakeSupabase({
    ordersLookupResponse: { data: { id: 'order-found-via-charge-id' }, error: null },
  });
  const capture = fakeCapture();
  const { fn: confirmOrderFn, calls: confirmCalls } = fakeConfirmOrder(confirmedResult());

  const response = await handlePaymentsWebhook(
    postRequest(),
    baseDeps({
      paymentProvider: provider,
      supabase: client,
      captureFn: capture.fn,
      confirmOrderFn,
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(ordersLookupCalls, [{ providerChargeId: 'charge-1' }]);
  assertEquals(confirmCalls.length, 1);
  assertEquals(confirmCalls[0], {
    orderId: 'order-found-via-charge-id',
    providerChargeId: 'charge-1',
  });
  assertEquals(updateCalls.length, 1);
  assertEquals(updateCalls[0]?.patch.status, 'processed');
  assertEquals(
    capture.calls.some((c) => c.event === 'payment_webhook_failed'),
    false,
    'a successful fallback lookup must not be reported as a failure',
  );
});

Deno.test('handlePaymentsWebhook falls through to the missing_external_reference failure when the provider_charge_id fallback lookup also finds nothing', async () => {
  const event = buildEvent({ externalReference: null, providerChargeId: 'charge-unknown' });
  const { provider } = fakePaymentProvider(() => Promise.resolve(okParseResult([event])));
  const { client, ordersLookupCalls, updateCalls } = createFakeSupabase({
    ordersLookupResponse: { data: null, error: null },
  });
  const capture = fakeCapture();
  const { fn: confirmOrderFn, calls: confirmCalls } = fakeConfirmOrder(confirmedResult());

  const response = await handlePaymentsWebhook(
    postRequest(),
    baseDeps({
      paymentProvider: provider,
      supabase: client,
      captureFn: capture.fn,
      confirmOrderFn,
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(ordersLookupCalls, [{ providerChargeId: 'charge-unknown' }]);
  assertEquals(
    confirmCalls.length,
    0,
    'no order was found by either path -- confirmOrder must not run',
  );
  const failedCapture = capture.calls.find((c) => c.event === 'payment_webhook_failed');
  assertExists(failedCapture);
  assertEquals(failedCapture.properties, {
    eventId: 'evt-1',
    reason: 'missing_external_reference',
  });
  assertEquals(updateCalls.length, 1);
  assertEquals(updateCalls[0]?.patch.status, 'failed');
});

Deno.test('handlePaymentsWebhook captures payment_webhook_failed and marks the event failed (without throwing) when the provider_charge_id fallback lookup itself errors', async () => {
  const event = buildEvent({ externalReference: null, providerChargeId: 'charge-1' });
  const { provider } = fakePaymentProvider(() => Promise.resolve(okParseResult([event])));
  const { client, updateCalls } = createFakeSupabase({
    ordersLookupResponse: { data: null, error: { message: 'db unreachable' } },
  });
  const capture = fakeCapture();
  const { fn: confirmOrderFn, calls: confirmCalls } = fakeConfirmOrder(confirmedResult());

  const response = await handlePaymentsWebhook(
    postRequest(),
    baseDeps({
      paymentProvider: provider,
      supabase: client,
      captureFn: capture.fn,
      confirmOrderFn,
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { received: true });
  assertEquals(confirmCalls.length, 0);
  const failedCapture = capture.calls.find((c) => c.event === 'payment_webhook_failed');
  assertExists(failedCapture);
  assertEquals(failedCapture.properties?.reason, 'order_lookup_by_provider_charge_id_failed');
  assertEquals(failedCapture.properties?.detail, 'db unreachable');
  assertEquals(updateCalls.length, 1);
  assertEquals(updateCalls[0]?.patch.status, 'failed');
});

Deno.test('handlePaymentsWebhook continues to the next event when confirmOrder throws for an earlier event in the same batch', async () => {
  const eventA = buildEvent({ eventId: 'evt-a', providerChargeId: 'charge-a' });
  const eventB = buildEvent({ eventId: 'evt-b', providerChargeId: 'charge-b' });
  const { provider } = fakePaymentProvider(() => Promise.resolve(okParseResult([eventA, eventB])));
  const { client, updateCalls } = createFakeSupabase();
  const captureException = fakeCaptureException();
  const { fn: confirmOrderFn, calls: confirmCalls } = fakeConfirmOrder((input) => {
    if (input.providerChargeId === 'charge-a') {
      return Promise.reject(new Error('gateway unreachable'));
    }
    return Promise.resolve(confirmedResult());
  });

  const response = await handlePaymentsWebhook(
    postRequest(),
    baseDeps({
      paymentProvider: provider,
      supabase: client,
      captureExceptionFn: captureException.fn,
      confirmOrderFn,
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { received: true });
  assertEquals(confirmCalls.length, 2, 'both events must be attempted');
  assertEquals(captureException.calls.length, 1);
  assertEquals(captureException.calls[0]?.distinctId, ORDER_ID);
  assertEquals(captureException.calls[0]?.properties?.eventId, 'evt-a');
  assertEquals(updateCalls.length, 2);
  assertEquals(updateCalls[0]?.patch.status, 'failed');
  assertEquals(updateCalls[1]?.patch.status, 'processed');
});

Deno.test('handlePaymentsWebhook resolves 200 { received: true } even when request.text() itself throws', async () => {
  const throwingRequest = {
    method: 'POST',
    headers: new Headers(),
    url: FUNCTION_URL,
    text: () => {
      throw new Error('body stream errored');
    },
  } as unknown as Request;
  const captureException = fakeCaptureException();

  const response = await handlePaymentsWebhook(
    throwingRequest,
    baseDeps({ captureExceptionFn: captureException.fn }),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { received: true });
  assertEquals(captureException.calls.length, 1);
  assertEquals(captureException.calls[0]?.distinctId, 'system');
  assertEquals(
    captureException.calls[0]?.properties?.reason,
    'payments_webhook_unexpected_exception',
  );
});

Deno.test('handlePaymentsWebhook resolves 200 { received: true } even when parseWebhook itself rejects', async () => {
  const { provider } = fakePaymentProvider(() => Promise.reject(new Error('provider exploded')));
  const captureException = fakeCaptureException();

  const response = await handlePaymentsWebhook(
    postRequest(),
    baseDeps({ paymentProvider: provider, captureExceptionFn: captureException.fn }),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { received: true });
  assertEquals(captureException.calls.length, 1);
});

Deno.test('handlePaymentsWebhook still calls confirmOrder but skips the status update when a duplicate-event lookup finds no row', async () => {
  const event = buildEvent();
  const { provider } = fakePaymentProvider(() => Promise.resolve(okParseResult([event])));
  const { client, updateCalls } = createFakeSupabase({
    insertResponses: [{ data: null, error: { message: 'duplicate key value', code: '23505' } }],
    lookupResponse: { data: null, error: null },
  });
  const { fn: confirmOrderFn, calls: confirmCalls } = fakeConfirmOrder(confirmedResult());

  const response = await handlePaymentsWebhook(
    postRequest(),
    baseDeps({ paymentProvider: provider, supabase: client, confirmOrderFn }),
  );

  assertEquals(response.status, 200);
  assertEquals(
    confirmCalls.length,
    1,
    'confirmOrder must still run even without a resolvable row id',
  );
  assertEquals(updateCalls.length, 0, 'no id to update the audit row with');
});

Deno.test('handlePaymentsWebhook captures (but does not fail the request over) a payment_events status-update error', async () => {
  const event = buildEvent();
  const { provider } = fakePaymentProvider(() => Promise.resolve(okParseResult([event])));
  const { client } = createFakeSupabase({
    updateResponse: { data: null, error: { message: 'db unreachable' } },
  });
  const captureException = fakeCaptureException();
  const { fn: confirmOrderFn } = fakeConfirmOrder(confirmedResult());

  const response = await handlePaymentsWebhook(
    postRequest(),
    baseDeps({
      paymentProvider: provider,
      supabase: client,
      captureExceptionFn: captureException.fn,
      confirmOrderFn,
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { received: true });
  assertEquals(captureException.calls.length, 1);
  assertEquals(
    captureException.calls[0]?.properties?.reason,
    'payment_event_status_update_failed',
  );
});

Deno.test('handlePaymentsWebhook: the per-event defensive safety net still returns 200 when capture() itself throws mid-event', async () => {
  const event = buildEvent();
  const { provider } = fakePaymentProvider(() => Promise.resolve(okParseResult([event])));
  const { client } = createFakeSupabase();
  const throwingCapture = () => {
    throw new Error('posthog client misconfigured');
  };
  const captureException = fakeCaptureException();
  const { fn: confirmOrderFn, calls: confirmCalls } = fakeConfirmOrder(confirmedResult());

  const response = await handlePaymentsWebhook(
    postRequest(),
    baseDeps({
      paymentProvider: provider,
      supabase: client,
      captureFn: throwingCapture as unknown as PaymentsWebhookDeps['captureFn'],
      captureExceptionFn: captureException.fn,
      confirmOrderFn,
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { received: true });
  assertEquals(confirmCalls.length, 0, 'the throw happens before confirmOrder is ever reached');
  assertEquals(captureException.calls.length, 1);
  assertEquals(
    captureException.calls[0]?.properties?.reason,
    'event_processing_unexpected_exception',
  );
});

Deno.test('handlePaymentsWebhook builds the WebhookRequest from the raw, unparsed body plus headers and url', async () => {
  const rawBody = '{"type":"payment","data":{"id":"charge-1"}}';
  const { provider, calls } = fakePaymentProvider(() => Promise.resolve(okParseResult([])));

  const request = new Request(FUNCTION_URL, {
    method: 'POST',
    headers: { 'x-signature': 'ts=1,v1=abc', 'x-request-id': 'req-42' },
    body: rawBody,
  });
  const response = await handlePaymentsWebhook(request, baseDeps({ paymentProvider: provider }));

  assertEquals(response.status, 200);
  assertEquals(calls.length, 1);
  assertEquals(calls[0]?.rawBody, rawBody);
  assertEquals(calls[0]?.url, FUNCTION_URL);
  assertEquals(calls[0]?.headers['x-signature'], 'ts=1,v1=abc');
  assertEquals(calls[0]?.headers['x-request-id'], 'req-42');
});

// ADR 0001, decision 5: a deactivated user's pending PIX order must still be
// confirmed. The webhook must never consult user_access/is_active; access
// stays blocked downstream by app.has_active_enrollment.
Deno.test('handlePaymentsWebhook confirms the order without ever consulting user access (deactivated payer still gets confirmed)', async () => {
  const event = buildEvent();
  const { provider } = fakePaymentProvider(() => Promise.resolve(okParseResult([event])));
  const { client: inner } = createFakeSupabase();
  const touched: string[] = [];
  const innerClient = inner as unknown as {
    schema: (s: string) => { from: (t: string) => unknown };
    from: (t: string) => unknown;
  };
  const spy = {
    schema: (schemaName: string) => {
      const scoped = innerClient.schema(schemaName);
      return {
        from: (table: string) => {
          touched.push(`${schemaName}.${table}`);
          return scoped.from(table);
        },
      };
    },
    from: (table: string) => {
      touched.push(`public.${table}`);
      return innerClient.from(table);
    },
    rpc: (fn: string) => {
      touched.push(`rpc:${fn}`);
      throw new Error('webhook must not call rpc directly in this test');
    },
  } as unknown as SupabaseClient;
  const { fn: confirmOrderFn, calls: confirmCalls } = fakeConfirmOrder(confirmedResult());

  const response = await handlePaymentsWebhook(
    postRequest(),
    baseDeps({
      paymentProvider: provider,
      supabase: spy,
      captureFn: fakeCapture().fn,
      confirmOrderFn,
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(confirmCalls.length, 1);
  assertEquals(touched.filter((t) => t.includes('user_access') || t.startsWith('rpc:')), []);
  assertEquals(touched.length > 0, true);
});
