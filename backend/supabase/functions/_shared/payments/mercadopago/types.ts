// Internal Mercado Pago API response shapes -- NOT part of the frozen
// `PaymentProvider` contract. These mirror the subset of the `/v1/payments`
// resource this adapter actually reads.
//
// ASSUMPTION FLAGGED FOR VERIFICATION: field names below (in particular
// `point_of_interaction.transaction_data.transaction_id` as the PIX txid)
// are modeled from Mercado Pago's public payments API documentation, not
// verified against a live sandbox call -- no real MERCADOPAGO_ACCESS_TOKEN
// exists in this environment. Re-verify against a real sandbox response
// before this adapter handles real charges.

export interface MercadoPagoTransactionData {
  readonly qr_code?: string;
  readonly qr_code_base64?: string;
  readonly transaction_id?: string;
}

export interface MercadoPagoPointOfInteraction {
  readonly transaction_data?: MercadoPagoTransactionData;
}

export interface MercadoPagoPaymentResponse {
  readonly id: number | string;
  readonly status: string;
  readonly status_detail?: string;
  readonly external_reference?: string | null;
  readonly transaction_amount: number;
  readonly currency_id?: string;
  readonly date_of_expiration?: string | null;
  readonly date_approved?: string | null;
  readonly point_of_interaction?: MercadoPagoPointOfInteraction;
}

// Minimal shape of the notification body Mercado Pago POSTs to the
// configured webhook URL (the "IPN"/webhooks v2 format: topic + resource
// id only -- no charge status, hence `hintedStatus` staying 'unknown').
export interface MercadoPagoWebhookPayload {
  readonly id?: number | string;
  readonly type?: string;
  readonly action?: string;
  readonly data?: { readonly id?: string };
  readonly date_created?: string;
  readonly live_mode?: boolean;
}
