import { assertEquals, assertThrows } from '@std/assert';
import {
  centsToDecimal,
  decimalToCents,
  mapMercadoPagoStatus,
  mapPaymentToChargeSnapshot,
  mapPaymentToPixCharge,
  MissingQrCodeError,
} from './mapping.ts';
import type { MercadoPagoPaymentResponse } from './types.ts';

Deno.test('centsToDecimal converts integer cents to a decimal amount', () => {
  assertEquals(centsToDecimal(1000), 10);
  assertEquals(centsToDecimal(1050), 10.5);
  assertEquals(centsToDecimal(1), 0.01);
});

Deno.test('decimalToCents converts a decimal amount back to integer cents', () => {
  assertEquals(decimalToCents(10), 1000);
  assertEquals(decimalToCents(10.5), 1050);
  assertEquals(decimalToCents(0.01), 1);
});

Deno.test('centsToDecimal and decimalToCents round-trip for typical course prices', () => {
  for (const cents of [990, 4990, 19900, 100000]) {
    assertEquals(decimalToCents(centsToDecimal(cents)), cents);
  }
});

Deno.test('mapMercadoPagoStatus maps known statuses to the frozen ChargeStatus union', () => {
  assertEquals(mapMercadoPagoStatus('pending'), 'pending');
  assertEquals(mapMercadoPagoStatus('in_process'), 'pending');
  assertEquals(mapMercadoPagoStatus('authorized'), 'pending');
  assertEquals(mapMercadoPagoStatus('approved'), 'paid');
  assertEquals(mapMercadoPagoStatus('rejected'), 'cancelled');
  assertEquals(mapMercadoPagoStatus('cancelled'), 'cancelled');
  assertEquals(mapMercadoPagoStatus('refunded'), 'refunded');
  assertEquals(mapMercadoPagoStatus('charged_back'), 'refunded');
});

Deno.test('mapMercadoPagoStatus falls back to unknown for an unrecognized status', () => {
  assertEquals(mapMercadoPagoStatus('some_future_status'), 'unknown');
});

function pendingPayment(
  overrides: Partial<MercadoPagoPaymentResponse> = {},
): MercadoPagoPaymentResponse {
  return {
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
  };
}

Deno.test('mapPaymentToPixCharge maps a full Mercado Pago payment response', () => {
  const charge = mapPaymentToPixCharge(pendingPayment());
  assertEquals(charge.providerChargeId, '123456789');
  assertEquals(charge.providerTxid, 'txid-abc');
  assertEquals(charge.externalReference, 'order-uuid-1');
  assertEquals(charge.status, 'pending');
  assertEquals(charge.qrCodePayload, '00020126...copia-e-cola');
  assertEquals(charge.qrCodeBase64, 'base64==');
  assertEquals(charge.amount, { amountCents: 4990, currency: 'BRL' });
  assertEquals(charge.expiresAt, new Date('2026-01-10T12:00:00.000-04:00').toISOString());
});

Deno.test('mapPaymentToPixCharge normalizes expiresAt to UTC (Z)', () => {
  const charge = mapPaymentToPixCharge(pendingPayment());
  assertEquals(charge.expiresAt.endsWith('Z'), true);
});

Deno.test('mapPaymentToPixCharge defaults providerTxid to null when absent', () => {
  const charge = mapPaymentToPixCharge(pendingPayment({
    point_of_interaction: { transaction_data: { qr_code: 'code-only' } },
  }));
  assertEquals(charge.providerTxid, null);
});

Deno.test('mapPaymentToPixCharge defaults qrCodeBase64 to null when absent', () => {
  const charge = mapPaymentToPixCharge(pendingPayment({
    point_of_interaction: { transaction_data: { qr_code: 'code-only' } },
  }));
  assertEquals(charge.qrCodeBase64, null);
});

Deno.test('mapPaymentToPixCharge defaults externalReference to empty string when absent', () => {
  const charge = mapPaymentToPixCharge(pendingPayment({ external_reference: null }));
  assertEquals(charge.externalReference, '');
});

Deno.test('mapPaymentToPixCharge throws MissingQrCodeError when the QR payload is absent', () => {
  assertThrows(
    () => mapPaymentToPixCharge(pendingPayment({ point_of_interaction: {} })),
    MissingQrCodeError,
  );
});

Deno.test('mapPaymentToChargeSnapshot maps status, amount, and paidAt from a payment response', () => {
  const snapshot = mapPaymentToChargeSnapshot(pendingPayment({
    status: 'approved',
    date_approved: '2026-01-10T12:05:00.000-04:00',
  }));
  assertEquals(snapshot.providerChargeId, '123456789');
  assertEquals(snapshot.externalReference, 'order-uuid-1');
  assertEquals(snapshot.status, 'paid');
  assertEquals(snapshot.amount, { amountCents: 4990, currency: 'BRL' });
  assertEquals(snapshot.paidAt, '2026-01-10T12:05:00.000-04:00');
});

Deno.test('mapPaymentToChargeSnapshot sets paidAt to null when the payment is not yet approved', () => {
  const snapshot = mapPaymentToChargeSnapshot(pendingPayment());
  assertEquals(snapshot.paidAt, null);
});

Deno.test('mapPaymentToChargeSnapshot preserves the raw payload for audit purposes', () => {
  const payment = pendingPayment();
  const snapshot = mapPaymentToChargeSnapshot(payment);
  assertEquals(snapshot.raw, payment);
});

Deno.test('mapPaymentToChargeSnapshot sets externalReference to null when absent', () => {
  const snapshot = mapPaymentToChargeSnapshot(pendingPayment({ external_reference: null }));
  assertEquals(snapshot.externalReference, null);
});
