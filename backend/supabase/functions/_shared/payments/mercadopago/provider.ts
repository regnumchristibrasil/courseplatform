// Mercado Pago `PaymentProvider` implementation. `fetch` is injected (never
// imported directly) so this class is testable without real Mercado Pago
// credentials, per the repo's convention.
//
// `getChargeStatus` always performs a fresh GET against Mercado Pago -- it
// holds no cache/memoized state, so there is nothing here that *could*
// trust a stale or passed-in status. This is deliberate: per the spec, this
// call is the actual security boundary for webhook confirmation, not the
// webhook payload itself.

import type {
  ChargeSnapshot,
  CreatePixChargeInput,
  PaymentProvider,
  PixCharge,
  WebhookParseResult,
  WebhookRequest,
} from '../../../../../contracts/payments.ts';
import { centsToDecimal, mapPaymentToChargeSnapshot, mapPaymentToPixCharge } from './mapping.ts';
import type { MercadoPagoPaymentResponse } from './types.ts';
import { parseMercadoPagoWebhook } from './webhook.ts';

const DEFAULT_BASE_URL = 'https://api.mercadopago.com';
const PIX_PAYMENT_METHOD_ID = 'pix';

export type FetchFn = typeof fetch;

export class MercadoPagoApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly body: unknown) {
    super(message);
    this.name = 'MercadoPagoApiError';
  }
}

export interface MercadoPagoProviderDeps {
  readonly accessToken: string;
  readonly webhookSecret: string;
  readonly fetchFn?: FetchFn;
  readonly baseUrl?: string;
}

async function parseJsonOrThrow(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim().length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new MercadoPagoApiError(
      'Mercado Pago returned a non-JSON response body',
      response.status,
      text,
    );
  }
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

export class MercadoPagoProvider implements PaymentProvider {
  readonly id = 'mercadopago' as const;

  private readonly accessToken: string;
  private readonly webhookSecret: string;
  private readonly fetchFn: FetchFn;
  private readonly baseUrl: string;

  constructor(deps: MercadoPagoProviderDeps) {
    this.accessToken = deps.accessToken;
    this.webhookSecret = deps.webhookSecret;
    this.fetchFn = deps.fetchFn ?? fetch;
    this.baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  async createPixCharge(input: CreatePixChargeInput): Promise<PixCharge> {
    const dateOfExpiration = addSeconds(new Date(), input.expiresInSeconds).toISOString();

    const response = await this.fetchFn(`${this.baseUrl}/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(),
        'X-Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        transaction_amount: centsToDecimal(input.amount.amountCents),
        description: input.description,
        payment_method_id: PIX_PAYMENT_METHOD_ID,
        external_reference: input.orderId,
        notification_url: input.notificationUrl,
        date_of_expiration: dateOfExpiration,
        payer: {
          email: input.payer.email,
          first_name: input.payer.firstName,
          last_name: input.payer.lastName,
        },
      }),
    });

    const body = await parseJsonOrThrow(response);
    if (!response.ok) {
      throw new MercadoPagoApiError(
        `Failed to create Mercado Pago PIX charge (status ${response.status})`,
        response.status,
        body,
      );
    }

    return mapPaymentToPixCharge(body as MercadoPagoPaymentResponse);
  }

  // Ground truth for charge status -- always a live GET, never a cached or
  // passed-in value. Callers (webhook handler, reconciliation cron) must
  // call this before acting on any webhook-hinted status.
  async getChargeStatus(providerChargeId: string): Promise<ChargeSnapshot> {
    const response = await this.fetchFn(`${this.baseUrl}/v1/payments/${providerChargeId}`, {
      method: 'GET',
      headers: this.authHeaders(),
    });

    const body = await parseJsonOrThrow(response);
    if (!response.ok) {
      throw new MercadoPagoApiError(
        `Failed to fetch Mercado Pago charge status (status ${response.status})`,
        response.status,
        body,
      );
    }

    return mapPaymentToChargeSnapshot(body as MercadoPagoPaymentResponse);
  }

  parseWebhook(req: WebhookRequest): Promise<WebhookParseResult> {
    return parseMercadoPagoWebhook(req, this.webhookSecret);
  }
}
