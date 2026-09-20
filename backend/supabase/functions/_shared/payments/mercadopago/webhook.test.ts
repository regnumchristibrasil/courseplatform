import { assertEquals, assertExists } from '@std/assert';
import { parseMercadoPagoWebhook } from './webhook.ts';
import { hmacSha256Hex } from './crypto.ts';
import type { WebhookRequest } from '../../../../../contracts/payments.ts';

const WEBHOOK_SECRET = 'mp-test-webhook-secret';
const DATA_ID = '123456789';
const REQUEST_ID = 'req-abc-123';
const TS = '1704908010';
const WEBHOOK_URL =
  `https://example.com/functions/v1/payments-webhook?data.id=${DATA_ID}&type=payment`;

async function validSignatureHeader(
  dataId = DATA_ID,
  requestId = REQUEST_ID,
  ts = TS,
  secret = WEBHOOK_SECRET,
): Promise<string> {
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const v1 = await hmacSha256Hex(secret, manifest);
  return `ts=${ts},v1=${v1}`;
}

function paymentNotificationBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 987654321,
    type: 'payment',
    action: 'payment.updated',
    data: { id: DATA_ID },
    date_created: '2026-01-10T12:00:00.000Z',
    live_mode: false,
    ...overrides,
  });
}

async function buildValidRequest(overrides: Partial<WebhookRequest> = {}): Promise<WebhookRequest> {
  const signature = await validSignatureHeader();
  return {
    url: WEBHOOK_URL,
    rawBody: paymentNotificationBody(),
    headers: { 'x-signature': signature, 'x-request-id': REQUEST_ID },
    ...overrides,
  };
}

Deno.test('parseMercadoPagoWebhook accepts a request with a valid signature', async () => {
  const request = await buildValidRequest();
  const result = await parseMercadoPagoWebhook(request, WEBHOOK_SECRET);
  assertEquals(result.ok, true);
});

Deno.test('parseMercadoPagoWebhook returns invalid_signature when v1 does not match', async () => {
  const request = await buildValidRequest({
    headers: { 'x-signature': `ts=${TS},v1=deadbeef`, 'x-request-id': REQUEST_ID },
  });
  const result = await parseMercadoPagoWebhook(request, WEBHOOK_SECRET);
  assertEquals(result, { ok: false, reason: 'invalid_signature' });
});

Deno.test('parseMercadoPagoWebhook returns invalid_signature when signed with the wrong secret', async () => {
  const wrongSignature = await validSignatureHeader(DATA_ID, REQUEST_ID, TS, 'a-different-secret');
  const request = await buildValidRequest({
    headers: { 'x-signature': wrongSignature, 'x-request-id': REQUEST_ID },
  });
  const result = await parseMercadoPagoWebhook(request, WEBHOOK_SECRET);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, 'invalid_signature');
});

Deno.test('parseMercadoPagoWebhook returns invalid_signature when the request-id used to sign differs from the header', async () => {
  const signature = await validSignatureHeader(DATA_ID, 'a-different-request-id', TS);
  const request = await buildValidRequest({
    headers: { 'x-signature': signature, 'x-request-id': REQUEST_ID },
  });
  const result = await parseMercadoPagoWebhook(request, WEBHOOK_SECRET);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, 'invalid_signature');
});

Deno.test('parseMercadoPagoWebhook returns malformed when x-signature header is missing', async () => {
  const request: WebhookRequest = {
    url: WEBHOOK_URL,
    rawBody: paymentNotificationBody(),
    headers: { 'x-request-id': REQUEST_ID },
  };
  const result = await parseMercadoPagoWebhook(request, WEBHOOK_SECRET);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, 'malformed');
});

Deno.test('parseMercadoPagoWebhook returns malformed when x-request-id header is missing', async () => {
  const signature = await validSignatureHeader();
  const request: WebhookRequest = {
    url: WEBHOOK_URL,
    rawBody: paymentNotificationBody(),
    headers: { 'x-signature': signature },
  };
  const result = await parseMercadoPagoWebhook(request, WEBHOOK_SECRET);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, 'malformed');
});

Deno.test('parseMercadoPagoWebhook returns malformed when x-signature header cannot be parsed', async () => {
  const request = await buildValidRequest({
    headers: { 'x-signature': 'garbage-header', 'x-request-id': REQUEST_ID },
  });
  const result = await parseMercadoPagoWebhook(request, WEBHOOK_SECRET);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, 'malformed');
});

Deno.test('parseMercadoPagoWebhook returns malformed when the url has no data.id query param', async () => {
  const signature = await validSignatureHeader();
  const request: WebhookRequest = {
    url: 'https://example.com/functions/v1/payments-webhook?type=payment',
    rawBody: paymentNotificationBody(),
    headers: { 'x-signature': signature, 'x-request-id': REQUEST_ID },
  };
  const result = await parseMercadoPagoWebhook(request, WEBHOOK_SECRET);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, 'malformed');
});

Deno.test('parseMercadoPagoWebhook returns malformed when the raw body is not valid JSON', async () => {
  const request = await buildValidRequest({ rawBody: '{not-json' });
  const result = await parseMercadoPagoWebhook(request, WEBHOOK_SECRET);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, 'malformed');
});

Deno.test('parseMercadoPagoWebhook returns unsupported_event for a non-payment topic', async () => {
  const request = await buildValidRequest({
    rawBody: paymentNotificationBody({ type: 'merchant_order' }),
  });
  const result = await parseMercadoPagoWebhook(request, WEBHOOK_SECRET);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, 'unsupported_event');
});

Deno.test('parseMercadoPagoWebhook builds a WebhookEvent with providerChargeId from data.id', async () => {
  const request = await buildValidRequest();
  const result = await parseMercadoPagoWebhook(request, WEBHOOK_SECRET);
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.events.length, 1);
  const event = result.events[0];
  assertExists(event);
  assertEquals(event.provider, 'mercadopago');
  assertEquals(event.providerChargeId, DATA_ID);
});

Deno.test('parseMercadoPagoWebhook sets hintedStatus to unknown -- the payload carries no trustworthy status', async () => {
  const request = await buildValidRequest();
  const result = await parseMercadoPagoWebhook(request, WEBHOOK_SECRET);
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const event = result.events[0];
  assertExists(event);
  assertEquals(event.hintedStatus, 'unknown');
});

Deno.test('parseMercadoPagoWebhook uses the notification id as eventId when present', async () => {
  const request = await buildValidRequest({ rawBody: paymentNotificationBody({ id: 555 }) });
  const result = await parseMercadoPagoWebhook(request, WEBHOOK_SECRET);
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const event = result.events[0];
  assertExists(event);
  assertEquals(event.eventId, '555');
});

Deno.test('parseMercadoPagoWebhook falls back to a deterministic eventId when the payload has no id', async () => {
  const request = await buildValidRequest({ rawBody: paymentNotificationBody({ id: undefined }) });
  const result = await parseMercadoPagoWebhook(request, WEBHOOK_SECRET);
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const event = result.events[0];
  assertExists(event);
  assertExists(event.eventId);
  assertEquals(event.eventId.length > 0, true);
});

Deno.test('parseMercadoPagoWebhook preserves the raw payload', async () => {
  const request = await buildValidRequest();
  const result = await parseMercadoPagoWebhook(request, WEBHOOK_SECRET);
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const event = result.events[0];
  assertExists(event);
  assertEquals((event.raw as { type: string }).type, 'payment');
});

Deno.test('parseMercadoPagoWebhook is case-insensitive on header names', async () => {
  const signature = await validSignatureHeader();
  const request: WebhookRequest = {
    url: WEBHOOK_URL,
    rawBody: paymentNotificationBody(),
    headers: { 'X-Signature': signature, 'X-Request-Id': REQUEST_ID },
  };
  const result = await parseMercadoPagoWebhook(request, WEBHOOK_SECRET);
  assertEquals(result.ok, true);
});
