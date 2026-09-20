// Money conversion, status mapping, and Mercado Pago payment-response ->
// frozen-contract mapping. Isolated in its own module so the HTTP-calling
// provider class (`provider.ts`) stays a thin orchestration layer -- per
// the spec, "the Mercado Pago adapter is the only place that converts to
// decimal, at the API boundary".

import type {
  ChargeSnapshot,
  ChargeStatus,
  Money,
  PixCharge,
} from '../../../../../contracts/payments.ts';
import type { MercadoPagoPaymentResponse } from './types.ts';

const CENTS_PER_UNIT = 100;
const BRL_CURRENCY = 'BRL' as const;

export function centsToDecimal(amountCents: number): number {
  return Math.round(amountCents) / CENTS_PER_UNIT;
}

export function decimalToCents(amount: number): number {
  return Math.round(amount * CENTS_PER_UNIT);
}

// Mercado Pago payment statuses -> the frozen `ChargeStatus` union.
// `in_process`/`authorized` are treated as still-pending (money not yet
// settled); `charged_back` is treated as `refunded` (money has left the
// merchant either way, from the platform's perspective).
const STATUS_MAP: Readonly<Record<string, ChargeStatus>> = {
  pending: 'pending',
  in_process: 'pending',
  authorized: 'pending',
  approved: 'paid',
  rejected: 'cancelled',
  cancelled: 'cancelled',
  refunded: 'refunded',
  charged_back: 'refunded',
};

export function mapMercadoPagoStatus(mpStatus: string): ChargeStatus {
  return STATUS_MAP[mpStatus] ?? 'unknown';
}

export class MissingQrCodeError extends Error {
  constructor(paymentId: string) {
    super(`Mercado Pago payment ${paymentId} response is missing the PIX QR code payload`);
    this.name = 'MissingQrCodeError';
  }
}

function toAmount(transactionAmount: number): Money {
  return { amountCents: decimalToCents(transactionAmount), currency: BRL_CURRENCY };
}

function toUtcIso(dateString: string): string {
  return new Date(dateString).toISOString();
}

export function mapPaymentToPixCharge(payment: MercadoPagoPaymentResponse): PixCharge {
  const providerChargeId = String(payment.id);
  const qrCode = payment.point_of_interaction?.transaction_data?.qr_code;
  if (!qrCode) {
    throw new MissingQrCodeError(providerChargeId);
  }
  if (!payment.date_of_expiration) {
    throw new Error(
      `Mercado Pago payment ${providerChargeId} response is missing date_of_expiration`,
    );
  }

  return {
    providerChargeId,
    providerTxid: payment.point_of_interaction?.transaction_data?.transaction_id ?? null,
    externalReference: payment.external_reference ?? '',
    status: mapMercadoPagoStatus(payment.status),
    qrCodePayload: qrCode,
    qrCodeBase64: payment.point_of_interaction?.transaction_data?.qr_code_base64 ?? null,
    amount: toAmount(payment.transaction_amount),
    expiresAt: toUtcIso(payment.date_of_expiration),
  };
}

export function mapPaymentToChargeSnapshot(payment: MercadoPagoPaymentResponse): ChargeSnapshot {
  return {
    providerChargeId: String(payment.id),
    externalReference: payment.external_reference ?? null,
    status: mapMercadoPagoStatus(payment.status),
    amount: toAmount(payment.transaction_amount),
    paidAt: payment.date_approved ?? null,
    raw: payment,
  };
}
