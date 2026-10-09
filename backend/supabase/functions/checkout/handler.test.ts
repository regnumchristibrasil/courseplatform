import { assertEquals, assertExists, assertMatch } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CreatePixChargeInput,
  PaymentProvider,
  PixCharge,
} from '../../../contracts/payments.ts';
import type { BackendConfig } from '../_shared/config.ts';
import { MissingAuthorizationError } from '../_shared/supabase.ts';
import {
  captureAndFlush,
  type CaptureEventInput,
  captureExceptionAndFlush,
  type CaptureExceptionInput,
} from '../_shared/observability.ts';
import { createFakeClient, type FakeTableConfig } from './fakes.ts';
import { handleCheckoutRequest } from './handler.ts';

function sampleConfig(overrides: Partial<BackendConfig> = {}): BackendConfig {
  return {
    paymentProvider: 'mercadopago',
    mercadoPago: {
      accessToken: 'mp-test-access-token',
      webhookSecret: 'mp-test-webhook-secret',
      notificationUrl: 'https://example.com/functions/v1/payments-webhook',
    },
    pixChargeTtlSeconds: 1800,
    videoProvider: 'youtube',
    panda: { apiKey: null, signedUrlTtlSeconds: null },
    resend: {
      apiKey: 'resend-key',
      fromEmail: 'noreply@example.com',
      replyTo: 'support@example.com',
    },
    postHog: { apiKey: 'ph-key', host: 'https://posthog.example.com' },
    cronSecret: 'cron-secret',
    appPublicUrl: 'https://app.example.com',
    companyName: 'Regnum Christi Brasil',
    supportEmail: 'support@example.com',
    ...overrides,
  };
}

function courseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'course-1',
    title: 'Curso de Exemplo',
    price_cents: 4990,
    status: 'published',
    ...overrides,
  };
}

function sampleCharge(overrides: Partial<PixCharge> = {}): PixCharge {
  return {
    providerChargeId: 'charge-123',
    providerTxid: 'txid-abc',
    externalReference: 'order-1',
    status: 'pending',
    qrCodePayload: '00020126...copia-e-cola',
    qrCodeBase64: 'base64==',
    amount: { amountCents: 4990, currency: 'BRL' },
    expiresAt: '2026-01-01T00:30:00.000Z',
    ...overrides,
  };
}

interface FakeAccess {
  readonly rows?: readonly { role: string; is_active: boolean }[];
  readonly error?: { message: string };
}

function fakeCallerClient(
  user: { id: string; email?: string } | null,
  errorMessage?: string,
  access: FakeAccess = { rows: [{ role: 'student', is_active: true }] },
): SupabaseClient {
  return {
    schema: (schemaName: string) => ({
      rpc: (fn: string) => {
        if (schemaName !== 'app' || fn !== 'current_access') {
          throw new Error(`unexpected rpc ${schemaName}.${fn}`);
        }
        return Promise.resolve({ data: access.rows ?? [], error: access.error ?? null });
      },
    }),
    auth: {
      getUser: () =>
        Promise.resolve(
          user
            ? { data: { user }, error: null }
            : { data: { user: null }, error: errorMessage ? { message: errorMessage } : null },
        ),
    },
  } as unknown as SupabaseClient;
}

function fakePaymentProvider(
  impl: (input: CreatePixChargeInput) => Promise<PixCharge>,
): { provider: PaymentProvider; calls: CreatePixChargeInput[] } {
  const calls: CreatePixChargeInput[] = [];
  const provider: PaymentProvider = {
    id: 'mercadopago',
    createPixCharge: (input: CreatePixChargeInput) => {
      calls.push(input);
      return impl(input);
    },
    getChargeStatus: () => {
      throw new Error('getChargeStatus not implemented in this fake');
    },
    parseWebhook: () => {
      throw new Error('parseWebhook not implemented in this fake');
    },
  };
  return { provider, calls };
}

function fakeCapture(): { fn: typeof captureAndFlush; calls: CaptureEventInput[] } {
  const calls: CaptureEventInput[] = [];
  const fn = ((_env: unknown, input: CaptureEventInput) => {
    calls.push(input);
    return Promise.resolve({ ok: true });
  }) as unknown as typeof captureAndFlush;
  return { fn, calls };
}

function fakeCaptureException(): {
  fn: typeof captureExceptionAndFlush;
  calls: CaptureExceptionInput[];
} {
  const calls: CaptureExceptionInput[] = [];
  const fn = ((_env: unknown, input: CaptureExceptionInput) => {
    calls.push(input);
    return Promise.resolve({ ok: true });
  }) as unknown as typeof captureExceptionAndFlush;
  return { fn, calls };
}

function serviceClientNeverCalled(): SupabaseClient {
  return {
    from: () => {
      throw new Error('service-role client should not be used on this path');
    },
  } as unknown as SupabaseClient;
}

function buildRequest(
  body: unknown,
  opts: { method?: string; withAuth?: boolean } = {},
): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.withAuth !== false) {
    headers.Authorization = 'Bearer caller-jwt';
  }
  return new Request('https://example.com/functions/v1/checkout', {
    method: opts.method ?? 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

Deno.test('handleCheckoutRequest responds to an OPTIONS preflight with 204 and no body', async () => {
  const response = await handleCheckoutRequest(buildRequest(undefined, { method: 'OPTIONS' }), {
    config: sampleConfig(),
    createCallerClient: () => fakeCallerClient({ id: 'user-1' }),
    createServiceRoleClient: serviceClientNeverCalled,
    paymentProvider: fakePaymentProvider(() => Promise.resolve(sampleCharge())).provider,
    captureAndFlush: fakeCapture().fn,
    captureExceptionAndFlush: fakeCaptureException().fn,
  });
  assertEquals(response.status, 204);
  assertEquals(await response.text(), '');
});

Deno.test('handleCheckoutRequest rejects a non-POST method with 405', async () => {
  const response = await handleCheckoutRequest(
    buildRequest(undefined, { method: 'GET' }),
    {
      config: sampleConfig(),
      createCallerClient: () => fakeCallerClient({ id: 'user-1' }),
      createServiceRoleClient: serviceClientNeverCalled,
      paymentProvider: fakePaymentProvider(() => Promise.resolve(sampleCharge())).provider,
      captureAndFlush: fakeCapture().fn,
      captureExceptionAndFlush: fakeCaptureException().fn,
    },
  );
  assertEquals(response.status, 405);
  const json = await response.json();
  assertEquals(json.error.code, 'method_not_allowed');
});

Deno.test('handleCheckoutRequest rejects a missing courseId with 400 invalid_body', async () => {
  const response = await handleCheckoutRequest(buildRequest({}), {
    config: sampleConfig(),
    createCallerClient: () => fakeCallerClient({ id: 'user-1' }),
    createServiceRoleClient: serviceClientNeverCalled,
    paymentProvider: fakePaymentProvider(() => Promise.resolve(sampleCharge())).provider,
    captureAndFlush: fakeCapture().fn,
    captureExceptionAndFlush: fakeCaptureException().fn,
  });
  assertEquals(response.status, 400);
  const json = await response.json();
  assertEquals(json.error.code, 'invalid_body');
  assertExists(json.error.requestId);
});

Deno.test('handleCheckoutRequest rejects an unparseable body with 400 invalid_body', async () => {
  const request = new Request('https://example.com/functions/v1/checkout', {
    method: 'POST',
    headers: { Authorization: 'Bearer caller-jwt', 'Content-Type': 'application/json' },
    body: '{not-json',
  });
  const response = await handleCheckoutRequest(request, {
    config: sampleConfig(),
    createCallerClient: () => fakeCallerClient({ id: 'user-1' }),
    createServiceRoleClient: serviceClientNeverCalled,
    paymentProvider: fakePaymentProvider(() => Promise.resolve(sampleCharge())).provider,
    captureAndFlush: fakeCapture().fn,
    captureExceptionAndFlush: fakeCaptureException().fn,
  });
  assertEquals(response.status, 400);
  const json = await response.json();
  assertEquals(json.error.code, 'invalid_body');
});

Deno.test('handleCheckoutRequest returns 401 unauthorized when there is no Authorization header', async () => {
  const response = await handleCheckoutRequest(
    buildRequest({ courseId: 'course-1' }, { withAuth: false }),
    {
      config: sampleConfig(),
      createCallerClient: () => {
        throw new MissingAuthorizationError();
      },
      createServiceRoleClient: serviceClientNeverCalled,
      paymentProvider: fakePaymentProvider(() => Promise.resolve(sampleCharge())).provider,
      captureAndFlush: fakeCapture().fn,
      captureExceptionAndFlush: fakeCaptureException().fn,
    },
  );
  assertEquals(response.status, 401);
  const json = await response.json();
  assertEquals(json.error.code, 'unauthorized');
});

Deno.test('handleCheckoutRequest returns 401 unauthorized when the session is invalid/expired', async () => {
  const response = await handleCheckoutRequest(buildRequest({ courseId: 'course-1' }), {
    config: sampleConfig(),
    createCallerClient: () => fakeCallerClient(null, 'invalid JWT'),
    createServiceRoleClient: serviceClientNeverCalled,
    paymentProvider: fakePaymentProvider(() => Promise.resolve(sampleCharge())).provider,
    captureAndFlush: fakeCapture().fn,
    captureExceptionAndFlush: fakeCaptureException().fn,
  });
  assertEquals(response.status, 401);
  const json = await response.json();
  assertEquals(json.error.code, 'unauthorized');
});

Deno.test('handleCheckoutRequest returns 404 course_not_found when the course does not exist', async () => {
  const { client: serviceClient } = createFakeClient({
    courses: { select: { data: null, error: null } },
  });
  const response = await handleCheckoutRequest(buildRequest({ courseId: 'missing-course' }), {
    config: sampleConfig(),
    createCallerClient: () => fakeCallerClient({ id: 'user-1', email: 'buyer@example.com' }),
    createServiceRoleClient: () => serviceClient as unknown as SupabaseClient,
    paymentProvider: fakePaymentProvider(() => Promise.resolve(sampleCharge())).provider,
    captureAndFlush: fakeCapture().fn,
    captureExceptionAndFlush: fakeCaptureException().fn,
  });
  assertEquals(response.status, 404);
  const json = await response.json();
  assertEquals(json.error.code, 'course_not_found');
});

Deno.test('handleCheckoutRequest returns 404 course_not_found (same code) when the course is not published', async () => {
  const { client: serviceClient } = createFakeClient({
    courses: { select: { data: courseRow({ status: 'draft' }), error: null } },
  });
  const response = await handleCheckoutRequest(buildRequest({ courseId: 'course-1' }), {
    config: sampleConfig(),
    createCallerClient: () => fakeCallerClient({ id: 'user-1', email: 'buyer@example.com' }),
    createServiceRoleClient: () => serviceClient as unknown as SupabaseClient,
    paymentProvider: fakePaymentProvider(() => Promise.resolve(sampleCharge())).provider,
    captureAndFlush: fakeCapture().fn,
    captureExceptionAndFlush: fakeCaptureException().fn,
  });
  assertEquals(response.status, 404);
  const json = await response.json();
  assertEquals(json.error.code, 'course_not_found');
});

Deno.test('handleCheckoutRequest new-order happy path: inserts an order, creates the charge, updates provider refs, and emits payment_charge_created', async () => {
  const tables: Record<string, FakeTableConfig> = {
    courses: { select: { data: courseRow(), error: null } },
    enrollments: { select: { data: null, error: null } },
    orders: {
      select: { data: null, error: null }, // no reusable order
      insert: { data: { id: 'order-new' }, error: null },
      update: { data: null, error: null },
    },
  };
  const { client: serviceClient, calls: serviceCalls } = createFakeClient(tables);
  const { provider, calls: providerCalls } = fakePaymentProvider(() =>
    Promise.resolve(sampleCharge({ externalReference: 'order-new' }))
  );
  const { fn: captureFn, calls: captureCalls } = fakeCapture();

  const response = await handleCheckoutRequest(buildRequest({ courseId: 'course-1' }), {
    config: sampleConfig(),
    createCallerClient: () => fakeCallerClient({ id: 'user-1', email: 'buyer@example.com' }),
    createServiceRoleClient: () => serviceClient as unknown as SupabaseClient,
    paymentProvider: provider,
    captureAndFlush: captureFn,
    captureExceptionAndFlush: fakeCaptureException().fn,
  });

  assertEquals(response.status, 200);
  const json = await response.json();
  assertEquals(json, {
    orderId: 'order-new',
    status: 'pending',
    amountCents: 4990,
    currency: 'BRL',
    pix: {
      qrCodePayload: '00020126...copia-e-cola',
      qrCodeBase64: 'base64==',
      expiresAt: '2026-01-01T00:30:00.000Z',
    },
  });

  // Insert happened with the price read server-side from courses.price_cents.
  const insertCall = serviceCalls.find((call) =>
    call.table === 'orders' && call.method === 'insert'
  );
  assertExists(insertCall);
  const insertedRow = insertCall.args[0] as Record<string, unknown>;
  assertEquals(insertedRow.user_id, 'user-1');
  assertEquals(insertedRow.course_id, 'course-1');
  assertEquals(insertedRow.amount_cents, 4990);
  assertEquals(insertedRow.currency, 'BRL');
  assertEquals(insertedRow.provider, 'mercadopago');
  assertEquals(insertedRow.status, 'pending');
  // expires_at = now + config.pixChargeTtlSeconds (1800s), computed at
  // request time -- assert it round-trips as a valid ISO timestamp roughly
  // 1800s in the future rather than an exact value, to avoid test flakes.
  const expiresAtMs = Date.parse(insertedRow.expires_at as string);
  const expectedMs = Date.now() + sampleConfig().pixChargeTtlSeconds * 1000;
  const toleranceMs = 5000;
  if (Math.abs(expiresAtMs - expectedMs) > toleranceMs) {
    throw new Error(
      `expires_at ${insertedRow.expires_at} not within tolerance of expected ${expectedMs}`,
    );
  }

  // createPixCharge called once, with the new order's id as idempotencyKey.
  assertEquals(providerCalls.length, 1);
  assertEquals(providerCalls[0]?.orderId, 'order-new');
  assertEquals(providerCalls[0]?.idempotencyKey, 'order-new');
  assertEquals(providerCalls[0]?.amount, { amountCents: 4990, currency: 'BRL' });
  assertEquals(providerCalls[0]?.payer, { email: 'buyer@example.com' });

  // The order row was updated with the provider's returned refs.
  const updateCall = serviceCalls.find((call) =>
    call.table === 'orders' && call.method === 'update'
  );
  assertExists(updateCall);
  assertEquals(updateCall.args[0], {
    provider_charge_id: 'charge-123',
    provider_txid: 'txid-abc',
    external_reference: 'order-new',
  });

  // payment_charge_created emitted exactly once, for the new charge.
  assertEquals(captureCalls.length, 1);
  assertEquals(captureCalls[0]?.event, 'payment_charge_created');
  assertEquals(captureCalls[0]?.distinctId, 'user-1');
  assertEquals(captureCalls[0]?.properties, {
    orderId: 'order-new',
    courseId: 'course-1',
    amountCents: 4990,
  });
});

Deno.test('handleCheckoutRequest reuses an existing non-expired pending order instead of inserting a new one', async () => {
  const tables: Record<string, FakeTableConfig> = {
    courses: { select: { data: courseRow(), error: null } },
    enrollments: { select: { data: null, error: null } },
    orders: {
      select: {
        data: {
          id: 'order-existing',
          amount_cents: 4990,
          currency: 'BRL',
          created_at: '2026-01-01T00:00:00Z',
        },
        error: null,
      },
      // Deliberately no `insert`/`update` config -- if the handler tried to
      // call either, `fakes.ts` throws "no ... config", failing the test.
    },
  };
  const { client: serviceClient, calls: serviceCalls } = createFakeClient(tables);
  const { provider, calls: providerCalls } = fakePaymentProvider(() =>
    Promise.resolve(sampleCharge({ externalReference: 'order-existing' }))
  );
  const { fn: captureFn, calls: captureCalls } = fakeCapture();

  const response = await handleCheckoutRequest(buildRequest({ courseId: 'course-1' }), {
    config: sampleConfig(),
    createCallerClient: () => fakeCallerClient({ id: 'user-1', email: 'buyer@example.com' }),
    createServiceRoleClient: () => serviceClient as unknown as SupabaseClient,
    paymentProvider: provider,
    captureAndFlush: captureFn,
    captureExceptionAndFlush: fakeCaptureException().fn,
  });

  assertEquals(response.status, 200);
  const json = await response.json();
  assertEquals(json.orderId, 'order-existing');

  assertEquals(
    serviceCalls.some((call) => call.table === 'orders' && call.method === 'insert'),
    false,
  );
  assertEquals(
    serviceCalls.some((call) => call.table === 'orders' && call.method === 'update'),
    false,
  );

  assertEquals(providerCalls.length, 1);
  assertEquals(providerCalls[0]?.orderId, 'order-existing');
  assertEquals(providerCalls[0]?.idempotencyKey, 'order-existing');

  // Reuse is not a new charge -- no `payment_charge_created` event.
  assertEquals(captureCalls.length, 0);
});

Deno.test('handleCheckoutRequest returns 502 payment_provider_error when the provider throws, without leaking response body PII', async () => {
  const tables: Record<string, FakeTableConfig> = {
    courses: { select: { data: courseRow(), error: null } },
    enrollments: { select: { data: null, error: null } },
    orders: {
      select: { data: null, error: null },
      insert: { data: { id: 'order-new' }, error: null },
    },
  };
  const { client: serviceClient } = createFakeClient(tables);

  class FakeProviderError extends Error {
    constructor(public readonly body: unknown) {
      super('Mercado Pago rejected the request');
    }
  }
  const providerError = new FakeProviderError({
    payer: { email: 'buyer@example.com', cpf: '000.000.000-00' },
  });
  const { provider } = fakePaymentProvider(() => Promise.reject(providerError));
  const { fn: captureExceptionFn, calls: captureExceptionCalls } = fakeCaptureException();

  const response = await handleCheckoutRequest(buildRequest({ courseId: 'course-1' }), {
    config: sampleConfig(),
    createCallerClient: () => fakeCallerClient({ id: 'user-1', email: 'buyer@example.com' }),
    createServiceRoleClient: () => serviceClient as unknown as SupabaseClient,
    paymentProvider: provider,
    captureAndFlush: fakeCapture().fn,
    captureExceptionAndFlush: captureExceptionFn,
  });

  assertEquals(response.status, 502);
  const json = await response.json();
  assertEquals(json.error.code, 'payment_provider_error');
  assertExists(json.error.requestId);
  assertMatch(json.error.requestId, REQUEST_ID_PATTERN);

  assertEquals(captureExceptionCalls.length, 1);
  const captured = captureExceptionCalls[0];
  assertExists(captured);
  assertEquals(captured.distinctId, 'user-1');
  assertEquals(captured.error, providerError);
  assertEquals(captured.properties, { orderId: 'order-new', courseId: 'course-1' });
  // The raw provider response body (possible PII) must never be forwarded.
  assertEquals(JSON.stringify(captured.properties).includes('cpf'), false);
  assertEquals(JSON.stringify(captured.properties).includes('000.000.000-00'), false);
});

Deno.test('handleCheckoutRequest returns 502 payment_provider_error on the reuse-existing-order path too', async () => {
  const tables: Record<string, FakeTableConfig> = {
    courses: { select: { data: courseRow(), error: null } },
    enrollments: { select: { data: null, error: null } },
    orders: {
      select: {
        data: {
          id: 'order-existing',
          amount_cents: 4990,
          currency: 'BRL',
          created_at: '2026-01-01T00:00:00Z',
        },
        error: null,
      },
    },
  };
  const { client: serviceClient } = createFakeClient(tables);
  const providerError = new Error('Mercado Pago rejected the request');
  const { provider, calls: providerCalls } = fakePaymentProvider(() =>
    Promise.reject(providerError)
  );
  const { fn: captureExceptionFn, calls: captureExceptionCalls } = fakeCaptureException();

  const response = await handleCheckoutRequest(buildRequest({ courseId: 'course-1' }), {
    config: sampleConfig(),
    createCallerClient: () => fakeCallerClient({ id: 'user-1', email: 'buyer@example.com' }),
    createServiceRoleClient: () => serviceClient as unknown as SupabaseClient,
    paymentProvider: provider,
    captureAndFlush: fakeCapture().fn,
    captureExceptionAndFlush: captureExceptionFn,
  });

  assertEquals(response.status, 502);
  const json = await response.json();
  assertEquals(json.error.code, 'payment_provider_error');
  assertEquals(providerCalls[0]?.orderId, 'order-existing');
  assertEquals(captureExceptionCalls[0]?.properties, {
    orderId: 'order-existing',
    courseId: 'course-1',
  });
});

Deno.test('handleCheckoutRequest returns 500 internal_error and captures the exception on an unexpected DB error', async () => {
  const { client: serviceClient } = createFakeClient({
    courses: { select: { data: null, error: { message: 'connection reset by peer' } } },
  });
  const { fn: captureExceptionFn, calls: captureExceptionCalls } = fakeCaptureException();

  const response = await handleCheckoutRequest(buildRequest({ courseId: 'course-1' }), {
    config: sampleConfig(),
    createCallerClient: () => fakeCallerClient({ id: 'user-1', email: 'buyer@example.com' }),
    createServiceRoleClient: () => serviceClient as unknown as SupabaseClient,
    paymentProvider: fakePaymentProvider(() => Promise.resolve(sampleCharge())).provider,
    captureAndFlush: fakeCapture().fn,
    captureExceptionAndFlush: captureExceptionFn,
  });

  assertEquals(response.status, 500);
  const json = await response.json();
  assertEquals(json.error.code, 'internal_error');
  assertExists(json.error.requestId);

  assertEquals(captureExceptionCalls.length, 1);
  assertEquals(captureExceptionCalls[0]?.distinctId, 'user-1');
  assertEquals(captureExceptionCalls[0]?.properties, { courseId: 'course-1' });
});

Deno.test('handleCheckoutRequest rethrows an unexpected error from createCallerClient (not MissingAuthorizationError)', async () => {
  const boomError = new Error('boom -- some other client construction failure');
  let rejected = false;
  try {
    await handleCheckoutRequest(buildRequest({ courseId: 'course-1' }), {
      config: sampleConfig(),
      createCallerClient: () => {
        throw boomError;
      },
      createServiceRoleClient: serviceClientNeverCalled,
      paymentProvider: fakePaymentProvider(() => Promise.resolve(sampleCharge())).provider,
      captureAndFlush: fakeCapture().fn,
      captureExceptionAndFlush: fakeCaptureException().fn,
    });
  } catch (error) {
    rejected = true;
    assertEquals(error, boomError);
  }
  assertEquals(rejected, true);
});

Deno.test('handleCheckoutRequest rejects a deactivated user with 403 forbidden before touching the service-role client', async () => {
  const provider = fakePaymentProvider(() => Promise.resolve(sampleCharge()));
  const response = await handleCheckoutRequest(buildRequest({ courseId: 'course-1' }), {
    config: sampleConfig(),
    createCallerClient: () =>
      fakeCallerClient({ id: 'user-1', email: 'buyer@example.com' }, undefined, {
        rows: [{ role: 'student', is_active: false }],
      }),
    createServiceRoleClient: serviceClientNeverCalled,
    paymentProvider: provider.provider,
    captureAndFlush: fakeCapture().fn,
    captureExceptionAndFlush: fakeCaptureException().fn,
  });
  assertEquals(response.status, 403);
  const json = await response.json();
  assertEquals(json.error.code, 'forbidden');
  assertMatch(json.error.requestId, REQUEST_ID_PATTERN);
  assertEquals(provider.calls.length, 0);
});

Deno.test('handleCheckoutRequest fails closed with 500 internal_error when the access lookup errors', async () => {
  const exceptions = fakeCaptureException();
  const response = await handleCheckoutRequest(buildRequest({ courseId: 'course-1' }), {
    config: sampleConfig(),
    createCallerClient: () =>
      fakeCallerClient({ id: 'user-1', email: 'buyer@example.com' }, undefined, {
        error: { message: 'boom' },
      }),
    createServiceRoleClient: serviceClientNeverCalled,
    paymentProvider: fakePaymentProvider(() => Promise.resolve(sampleCharge())).provider,
    captureAndFlush: fakeCapture().fn,
    captureExceptionAndFlush: exceptions.fn,
  });
  assertEquals(response.status, 500);
  const json = await response.json();
  assertEquals(json.error.code, 'internal_error');
  assertEquals(exceptions.calls.length, 1);
});

Deno.test('handleCheckoutRequest treats a user without a user_access row as active (unchanged behaviour)', async () => {
  const { client: serviceClient } = createFakeClient({
    courses: { select: { data: null, error: null } },
  });
  const response = await handleCheckoutRequest(buildRequest({ courseId: 'missing-course' }), {
    config: sampleConfig(),
    createCallerClient: () =>
      fakeCallerClient({ id: 'user-1', email: 'buyer@example.com' }, undefined, { rows: [] }),
    createServiceRoleClient: () => serviceClient as unknown as SupabaseClient,
    paymentProvider: fakePaymentProvider(() => Promise.resolve(sampleCharge())).provider,
    captureAndFlush: fakeCapture().fn,
    captureExceptionAndFlush: fakeCaptureException().fn,
  });
  assertEquals(response.status, 404);
});

Deno.test('handleCheckoutRequest rejects a student with valid access with 409 already_enrolled before creating any order or charge', async () => {
  const tables: Record<string, FakeTableConfig> = {
    courses: { select: { data: courseRow(), error: null } },
    enrollments: { select: { data: { id: 'enrollment-1' }, error: null } },
  };
  const { client: serviceClient, calls: serviceCalls } = createFakeClient(tables);
  const { provider, calls: providerCalls } = fakePaymentProvider(() =>
    Promise.reject(new Error('provider must not be called'))
  );

  const response = await handleCheckoutRequest(buildRequest({ courseId: 'course-1' }), {
    config: sampleConfig(),
    createCallerClient: () => fakeCallerClient({ id: 'user-1', email: 'buyer@example.com' }),
    createServiceRoleClient: () => serviceClient as unknown as SupabaseClient,
    paymentProvider: provider,
    captureAndFlush: fakeCapture().fn,
    captureExceptionAndFlush: fakeCaptureException().fn,
  });

  assertEquals(response.status, 409);
  const json = await response.json();
  assertEquals(json.error.code, 'already_enrolled');
  assertEquals(providerCalls.length, 0);
  assertEquals(serviceCalls.some((c) => c.table === 'orders'), false);
});

Deno.test('handleCheckoutRequest only counts non-expired active enrollments as valid access (repurchase after expiry proceeds)', async () => {
  const tables: Record<string, FakeTableConfig> = {
    courses: { select: { data: courseRow(), error: null } },
    enrollments: { select: { data: null, error: null } },
    orders: {
      select: { data: null, error: null },
      insert: { data: { id: 'order-new' }, error: null },
      update: { data: null, error: null },
    },
  };
  const { client: serviceClient, calls: serviceCalls } = createFakeClient(tables);
  const { provider } = fakePaymentProvider(() =>
    Promise.resolve(sampleCharge({ externalReference: 'order-new' }))
  );

  const response = await handleCheckoutRequest(buildRequest({ courseId: 'course-1' }), {
    config: sampleConfig(),
    createCallerClient: () => fakeCallerClient({ id: 'user-1', email: 'buyer@example.com' }),
    createServiceRoleClient: () => serviceClient as unknown as SupabaseClient,
    paymentProvider: provider,
    captureAndFlush: fakeCapture().fn,
    captureExceptionAndFlush: fakeCaptureException().fn,
  });

  assertEquals(response.status, 200);
  const filters = serviceCalls.filter((c) => c.table === 'enrollments');
  assertEquals(
    filters.some((c) => c.method === 'eq' && c.args[0] === 'status' && c.args[1] === 'active'),
    true,
  );
  const orFilter = filters.find((c) => c.method === 'or');
  assertExists(orFilter);
  assertMatch(String(orFilter.args[0]), /^expires_at\.is\.null,expires_at\.gt\./);
});
