import { assertEquals } from '@std/assert';
import type { PixCharge } from '../../../contracts/payments.ts';
import { buildCheckoutResponse } from './response.ts';

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

Deno.test('buildCheckoutResponse maps order + charge into the frozen 200 shape', () => {
  const response = buildCheckoutResponse('order-1', 4990, sampleCharge());
  assertEquals(response, {
    orderId: 'order-1',
    status: 'pending',
    amountCents: 4990,
    currency: 'BRL',
    pix: {
      qrCodePayload: '00020126...copia-e-cola',
      qrCodeBase64: 'base64==',
      expiresAt: '2026-01-01T00:30:00.000Z',
    },
  });
});

Deno.test('buildCheckoutResponse passes through a null qrCodeBase64', () => {
  const response = buildCheckoutResponse('order-1', 4990, sampleCharge({ qrCodeBase64: null }));
  assertEquals(response.pix.qrCodeBase64, null);
});
