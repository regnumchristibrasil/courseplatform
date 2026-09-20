import { assertEquals, assertExists, assertRejects } from '@std/assert';
import { MercadoPagoApiError, MercadoPagoProvider } from './provider.ts';
import type { CreatePixChargeInput } from '../../../../../contracts/payments.ts';

const ACCESS_TOKEN = 'mp-test-access-token';
const WEBHOOK_SECRET = 'mp-test-webhook-secret';

interface CapturedRequest {
  readonly url: string;
  readonly init: RequestInit;
}

function fakeFetch(response: Response | ((req: CapturedRequest) => Response)) {
  const calls: CapturedRequest[] = [];
  const fn = (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    const res = typeof response === 'function' ? response(call) : response;
    return Promise.resolve(res);
  };
  return { fn, calls };
}

function samplePaymentResponseBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 123456789,
    status: 'pending',
    external_reference: 'order-uuid-1',
    transaction_amount: 49.9,
    date_of_expiration: '2026-01-10T12:00:00.000-04:00',
    point_of_interaction: {
      transaction_data: {
        qr_code: '00020126...copia-e-cola',
        qr_code_base64: 'base64==',
        transaction_id: 'txid-abc',
      },
    },
    ...overrides,
  });
}

function sampleInput(overrides: Partial<CreatePixChargeInput> = {}): CreatePixChargeInput {
  return {
    orderId: 'order-uuid-1',
    amount: { amountCents: 4990, currency: 'BRL' },
    description: 'Curso de exemplo',
    expiresInSeconds: 1800,
    payer: { email: 'buyer@example.com', firstName: 'Ana', lastName: 'Silva' },
    notificationUrl: 'https://example.com/functions/v1/payments-webhook',
    idempotencyKey: 'order-uuid-1',
    ...overrides,
  };
}

Deno.test('MercadoPagoProvider.id is "mercadopago"', () => {
  const provider = new MercadoPagoProvider({
    accessToken: ACCESS_TOKEN,
    webhookSecret: WEBHOOK_SECRET,
  });
  assertEquals(provider.id, 'mercadopago');
});

Deno.test('createPixCharge POSTs to /v1/payments with Bearer auth and an idempotency key', async () => {
  const { fn, calls } = fakeFetch(new Response(samplePaymentResponseBody(), { status: 201 }));
  const provider = new MercadoPagoProvider({
    accessToken: ACCESS_TOKEN,
    webhookSecret: WEBHOOK_SECRET,
    fetchFn: fn,
  });

  await provider.createPixCharge(sampleInput());

  assertEquals(calls.length, 1);
  const call = calls[0];
  assertExists(call);
  assertEquals(call.url, 'https://api.mercadopago.com/v1/payments');
  assertEquals(call.init.method, 'POST');
  const headers = new Headers(call.init.headers);
  assertEquals(headers.get('Authorization'), `Bearer ${ACCESS_TOKEN}`);
  assertEquals(headers.get('X-Idempotency-Key'), 'order-uuid-1');
});

Deno.test('createPixCharge sends the amount as decimal reais, converted from integer cents', async () => {
  const { fn, calls } = fakeFetch(new Response(samplePaymentResponseBody(), { status: 201 }));
  const provider = new MercadoPagoProvider({
    accessToken: ACCESS_TOKEN,
    webhookSecret: WEBHOOK_SECRET,
    fetchFn: fn,
  });

  await provider.createPixCharge(sampleInput({ amount: { amountCents: 4990, currency: 'BRL' } }));

  const call = calls[0];
  assertExists(call);
  const body = JSON.parse(String(call.init.body));
  assertEquals(body.transaction_amount, 49.9);
  assertEquals(body.payment_method_id, 'pix');
  assertEquals(body.external_reference, 'order-uuid-1');
  assertEquals(body.notification_url, 'https://example.com/functions/v1/payments-webhook');
});

Deno.test('createPixCharge returns a PixCharge mapped from the Mercado Pago response', async () => {
  const { fn } = fakeFetch(new Response(samplePaymentResponseBody(), { status: 201 }));
  const provider = new MercadoPagoProvider({
    accessToken: ACCESS_TOKEN,
    webhookSecret: WEBHOOK_SECRET,
    fetchFn: fn,
  });

  const charge = await provider.createPixCharge(sampleInput());

  assertEquals(charge.providerChargeId, '123456789');
  assertEquals(charge.status, 'pending');
  assertEquals(charge.qrCodePayload, '00020126...copia-e-cola');
  assertEquals(charge.amount.amountCents, 4990);
});

Deno.test('createPixCharge throws MercadoPagoApiError on a non-2xx response', async () => {
  const { fn } = fakeFetch(
    new Response(JSON.stringify({ message: 'invalid access token' }), { status: 401 }),
  );
  const provider = new MercadoPagoProvider({
    accessToken: 'bad-token',
    webhookSecret: WEBHOOK_SECRET,
    fetchFn: fn,
  });

  const error = await assertRejects(
    () => provider.createPixCharge(sampleInput()),
    MercadoPagoApiError,
  ) as MercadoPagoApiError;
  assertEquals(error.status, 401);
});

Deno.test('getChargeStatus performs a fresh GET against the provider -- never trusts a cached value', async () => {
  const { fn, calls } = fakeFetch(
    new Response(
      samplePaymentResponseBody({
        status: 'approved',
        date_approved: '2026-01-10T12:05:00.000-04:00',
      }),
      { status: 200 },
    ),
  );
  const provider = new MercadoPagoProvider({
    accessToken: ACCESS_TOKEN,
    webhookSecret: WEBHOOK_SECRET,
    fetchFn: fn,
  });

  const snapshot = await provider.getChargeStatus('123456789');

  assertEquals(calls.length, 1);
  const call = calls[0];
  assertExists(call);
  assertEquals(call.url, 'https://api.mercadopago.com/v1/payments/123456789');
  assertEquals(call.init.method, 'GET');
  const headers = new Headers(call.init.headers);
  assertEquals(headers.get('Authorization'), `Bearer ${ACCESS_TOKEN}`);
  assertEquals(snapshot.status, 'paid');
  assertEquals(snapshot.paidAt, '2026-01-10T12:05:00.000-04:00');
});

Deno.test('getChargeStatus throws MercadoPagoApiError on a non-2xx response', async () => {
  const { fn } = fakeFetch(new Response(JSON.stringify({ message: 'not found' }), { status: 404 }));
  const provider = new MercadoPagoProvider({
    accessToken: ACCESS_TOKEN,
    webhookSecret: WEBHOOK_SECRET,
    fetchFn: fn,
  });

  const error = await assertRejects(
    () => provider.getChargeStatus('does-not-exist'),
    MercadoPagoApiError,
  ) as MercadoPagoApiError;
  assertEquals(error.status, 404);
});

Deno.test('createPixCharge/getChargeStatus throw MercadoPagoApiError when the response is not valid JSON', async () => {
  const { fn } = fakeFetch(new Response('<html>not json</html>', { status: 200 }));
  const provider = new MercadoPagoProvider({
    accessToken: ACCESS_TOKEN,
    webhookSecret: WEBHOOK_SECRET,
    fetchFn: fn,
  });

  await assertRejects(() => provider.getChargeStatus('123'), MercadoPagoApiError);
});
