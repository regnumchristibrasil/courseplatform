// Maps an order + provider PIX charge to the frozen 200 response shape
// (see prompt_course_platform.md, "Edge Function HTTP contracts").

import type { PixCharge } from '../../../contracts/payments.ts';

export interface CheckoutSuccessResponse {
  readonly orderId: string;
  readonly status: 'pending';
  readonly amountCents: number;
  readonly currency: 'BRL';
  readonly pix: {
    readonly qrCodePayload: string;
    readonly qrCodeBase64: string | null;
    readonly expiresAt: string;
  };
}

export function buildCheckoutResponse(
  orderId: string,
  amountCents: number,
  charge: PixCharge,
): CheckoutSuccessResponse {
  return {
    orderId,
    status: 'pending',
    amountCents,
    currency: 'BRL',
    pix: {
      qrCodePayload: charge.qrCodePayload,
      qrCodeBase64: charge.qrCodeBase64,
      expiresAt: charge.expiresAt,
    },
  };
}
