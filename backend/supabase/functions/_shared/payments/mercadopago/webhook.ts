// Mercado Pago webhook parsing + signature verification.
//
// Mercado Pago signs webhook notifications with an `x-signature` header
// (`ts=<unix-seconds>,v1=<hex-hmac-sha256>`) plus an `x-request-id` header.
// The signed manifest is `id:{data.id};request-id:{x-request-id};ts:{ts};`
// where `data.id` comes from the `data.id` query parameter on the
// notification URL (lowercased). HMAC-SHA256 the manifest with
// `MERCADOPAGO_WEBHOOK_SECRET`; the result must match `v1` exactly.
//
// ASSUMPTION FLAGGED FOR VERIFICATION: this manifest format is modeled from
// Mercado Pago's public webhook signature documentation, not verified
// against a real notification -- no real MERCADOPAGO_WEBHOOK_SECRET or live
// webhook traffic exists in this environment. Re-verify against a real
// sandbox notification before this gates production traffic.
//
// Signature verification is defense in depth, per the spec -- the actual
// security boundary is `MercadoPagoProvider.getChargeStatus`, called later
// by whoever consumes `WebhookParseResult` (not this module's job). This
// module's `hintedStatus` is therefore always `'unknown'`: Mercado Pago's
// notification payload for the `payment` topic carries no status field at
// all (just the resource id), so there is nothing here that could even be
// mistaken for a trustworthy hint.

import type {
  WebhookEvent,
  WebhookParseResult,
  WebhookRequest,
} from '../../../../../contracts/payments.ts';
import { hmacSha256Hex, parseSignatureHeader, timingSafeEqualHex } from './crypto.ts';
import type { MercadoPagoWebhookPayload } from './types.ts';

const SUPPORTED_TOPIC = 'payment';
const PROVIDER_ID = 'mercadopago' as const;

function getHeader(headers: Readonly<Record<string, string>>, name: string): string | null {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) return value;
  }
  return null;
}

function malformed(detail: string): WebhookParseResult {
  return { ok: false, reason: 'malformed', detail };
}

async function verifySignature(
  req: WebhookRequest,
  webhookSecret: string,
): Promise<{ ok: true; dataId: string } | { ok: false; result: WebhookParseResult }> {
  const signatureHeader = getHeader(req.headers, 'x-signature');
  const requestIdHeader = getHeader(req.headers, 'x-request-id');
  if (!signatureHeader || !requestIdHeader) {
    return { ok: false, result: malformed('missing x-signature or x-request-id header') };
  }

  const parsedSignature = parseSignatureHeader(signatureHeader);
  if (!parsedSignature) {
    return { ok: false, result: malformed('x-signature header could not be parsed') };
  }

  let dataId: string | null;
  try {
    dataId = new URL(req.url).searchParams.get('data.id');
  } catch {
    return { ok: false, result: malformed('webhook url is not a valid URL') };
  }
  if (!dataId) {
    return { ok: false, result: malformed('webhook url is missing the data.id query parameter') };
  }

  const manifest =
    `id:${dataId.toLowerCase()};request-id:${requestIdHeader};ts:${parsedSignature.ts};`;
  const expected = await hmacSha256Hex(webhookSecret, manifest);

  if (!timingSafeEqualHex(expected, parsedSignature.v1)) {
    return { ok: false, result: { ok: false, reason: 'invalid_signature' } };
  }

  return { ok: true, dataId };
}

function buildEventId(
  payload: MercadoPagoWebhookPayload,
  dataId: string,
  ts: string | null,
): string {
  if (payload.id !== undefined && payload.id !== null) {
    return String(payload.id);
  }
  // Deterministic fallback per the frozen contract's comment on `eventId`
  // ("deterministic fallback if the provider gives none") -- best-effort
  // dedup key, not a cryptographic guarantee.
  return `mercadopago:${dataId}:${ts ?? 'no-ts'}`;
}

export async function parseMercadoPagoWebhook(
  req: WebhookRequest,
  webhookSecret: string,
): Promise<WebhookParseResult> {
  const verification = await verifySignature(req, webhookSecret);
  if (!verification.ok) {
    return verification.result;
  }
  const { dataId } = verification;

  let payload: MercadoPagoWebhookPayload;
  try {
    payload = JSON.parse(req.rawBody) as MercadoPagoWebhookPayload;
  } catch {
    return malformed('webhook body is not valid JSON');
  }

  if (payload.type !== SUPPORTED_TOPIC) {
    return {
      ok: false,
      reason: 'unsupported_event',
      detail: `unsupported topic: ${payload.type ?? 'unknown'}`,
    };
  }

  const signatureHeader = getHeader(req.headers, 'x-signature');
  const parsedSignature = signatureHeader ? parseSignatureHeader(signatureHeader) : null;

  const event: WebhookEvent = {
    provider: PROVIDER_ID,
    eventId: buildEventId(payload, dataId, parsedSignature?.ts ?? null),
    providerChargeId: dataId,
    externalReference: null,
    // UNTRUSTED by contract -- and for this topic there is no status field
    // to even hint with. `getChargeStatus` is the only source of truth.
    hintedStatus: 'unknown',
    receivedAt: new Date().toISOString(),
    raw: payload,
  };

  return { ok: true, events: [event] };
}
