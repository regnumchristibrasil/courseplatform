// Frozen PaymentProvider contract, per prompt_course_platform.md
// "Frozen contracts and measurable NFRs (phase 2)" section. Backend-only —
// there is no frontend counterpart, so this file has no parity test (unlike
// contracts/video.ts).
//
// NOTE (2026-08-25): `RefundResult` is referenced by `refund?()` in the plan
// doc's frozen block but never defined there — a gap in the source doc, not
// an intentional omission. Defined here to mirror `ChargeSnapshot`'s shape
// since that's the doc's existing convention for provider result types.
// `refund()` is optional and not invoked by any Track A/B task in
// PROGRESS.md (refunds are webhook/reconciliation-driven, not provider-API-
// initiated, in this MVP) — low risk, but flagged here since this is
// supposed to be a frozen contract.

export type PaymentProviderId = 'mercadopago' | 'efi';
export type Money = { readonly amountCents: number; readonly currency: 'BRL' };
export type ChargeStatus = 'pending' | 'paid' | 'expired' | 'cancelled' | 'refunded' | 'unknown';

export interface CreatePixChargeInput {
  readonly orderId: string; // our uuid; sent as external_reference
  readonly amount: Money; // read server-side from courses.price_cents
  readonly description: string;
  readonly expiresInSeconds: number;
  readonly payer: {
    readonly email: string;
    readonly firstName?: string;
    readonly lastName?: string;
  };
  readonly notificationUrl: string;
  readonly idempotencyKey: string; // = orderId
}

export interface PixCharge {
  readonly providerChargeId: string;
  readonly providerTxid: string | null;
  readonly externalReference: string;
  readonly status: ChargeStatus;
  readonly qrCodePayload: string; // EMV copia-e-cola
  readonly qrCodeBase64: string | null;
  readonly amount: Money;
  readonly expiresAt: string; // ISO-8601 UTC
}

export interface ChargeSnapshot {
  readonly providerChargeId: string;
  readonly externalReference: string | null;
  readonly status: ChargeStatus;
  readonly amount: Money; // authoritative; compared against orders.amount_cents
  readonly paidAt: string | null;
  readonly raw: unknown;
}

export interface WebhookRequest {
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string; // unparsed -- signature depends on the raw bytes
  readonly url: string;
}

export interface WebhookEvent {
  readonly provider: PaymentProviderId;
  readonly eventId: string; // dedup key; deterministic fallback if the provider gives none
  readonly providerChargeId: string;
  readonly externalReference: string | null;
  readonly hintedStatus: ChargeStatus; // UNTRUSTED -- never acted on without getChargeStatus()
  readonly receivedAt: string;
  readonly raw: unknown;
}

export type WebhookParseResult =
  | { ok: true; events: readonly WebhookEvent[] } // array: some gateways batch multiple payments per POST
  | { ok: false; reason: 'invalid_signature' | 'malformed' | 'unsupported_event'; detail?: string };

// Not in the plan doc's frozen block -- see NOTE above.
export interface RefundResult {
  readonly providerChargeId: string;
  readonly status: ChargeStatus;
  readonly refundedAmount: Money;
  readonly raw: unknown;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  createPixCharge(input: CreatePixChargeInput): Promise<PixCharge>;
  getChargeStatus(providerChargeId: string): Promise<ChargeSnapshot>;
  parseWebhook(req: WebhookRequest): Promise<WebhookParseResult>;
  refund?(providerChargeId: string, amount?: Money): Promise<RefundResult>;
}
