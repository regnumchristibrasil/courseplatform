// Resend transactional email API client -- `fetch` is injected (never
// imported directly) so this is testable without real Resend credentials,
// matching this repo's `MercadoPagoProvider`/`fetchFn` DI convention (see
// `_shared/payments/mercadopago/provider.ts`).
//
// Unlike `_shared/observability.ts`'s deliberately "never throws" PostHog
// capture (which exists so analytics failures can't block business logic),
// a failed send here throws. `outbox-drain` (a separate task, not built
// yet) needs a real per-row exception to drive its attempts/backoff/
// dead-letter bookkeeping -- swallowing the failure here would make that
// impossible.

const RESEND_API_URL = 'https://api.resend.com/emails';

export type FetchFn = typeof fetch;

export class ResendApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly body: unknown) {
    super(message);
    this.name = 'ResendApiError';
  }
}

export interface ResendClientDeps {
  readonly apiKey: string;
  readonly fromEmail: string;
  readonly replyTo: string;
  readonly fetchFn?: FetchFn;
}

export interface SendEmailInput {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
}

export interface SendEmailResult {
  readonly id: string;
}

// Defensive body parsing, mirroring `MercadoPagoProvider`'s
// `parseJsonOrThrow` -- a JSON-parse failure must never mask the real HTTP
// error, whether the response was OK or not.
async function parseJsonOrThrow(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim().length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new ResendApiError(
      'Resend returned a non-JSON response body',
      response.status,
      text,
    );
  }
}

export async function sendEmail(
  deps: ResendClientDeps,
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const fetchFn = deps.fetchFn ?? fetch;

  const response = await fetchFn(RESEND_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${deps.apiKey}`,
    },
    body: JSON.stringify({
      from: deps.fromEmail,
      to: input.to,
      subject: input.subject,
      html: input.html,
      reply_to: deps.replyTo,
    }),
  });

  const body = await parseJsonOrThrow(response);
  if (!response.ok) {
    throw new ResendApiError(
      `Failed to send email via Resend (status ${response.status})`,
      response.status,
      body,
    );
  }

  const parsed = body as { id?: unknown } | null;
  if (typeof parsed?.id !== 'string' || parsed.id.length === 0) {
    throw new ResendApiError(
      'Resend response is missing a string "id" field',
      response.status,
      body,
    );
  }

  return { id: parsed.id };
}
