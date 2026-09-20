// payments-webhook Edge Function -- receives Mercado Pago's raw PIX webhook
// notification, verifies + parses it via the injected `PaymentProvider`,
// records each event in `app_private.payment_events` for dedup/audit, and
// calls the shared `confirmOrder` (`_shared/payments/confirm-order.ts`) per
// event. This function is intentionally a thin wrapper -- all refetch/CAS/
// email logic lives in `confirmOrder`, not here.
//
// DELIBERATE "ALWAYS 200" DESIGN (see prompt_course_platform.md, "Webhook
// idempotency" + "Return 200 to the webhook fast ... since gateways retry
// aggressively on slow responses", and the reconciliation-cron rationale
// under "Course catalog & enrollment"): every failure path below -- an
// invalid signature, a malformed payload, an event with no mapped order,
// `confirmOrder` throwing, or even a wholly unexpected exception -- is
// caught, captured to PostHog (and, for parsed events, reflected in
// `app_private.payment_events.status`), and the response is STILL
// `200 { received: true }`. A non-200 here would only make Mercado Pago
// hammer this public, unauthenticated endpoint with retries for problems a
// retry cannot fix (a transient DB error, a code bug) -- `payments-reconcile`
// (a separate, cron-driven function, not this one) is the actual recovery
// path for anything that fails here, precisely because webhook delivery can
// fail permanently even after a PIX payment settles. This is a deliberate,
// spec-grounded exception to this repo's usual "never silently swallow
// errors" convention: nothing here is swallowed -- every failure path still
// calls `captureExceptionAndFlush` or `captureAndFlush` so it is visible in
// PostHog, and parsed-event failures are additionally durable in
// `app_private.payment_events` (PostHog capture alone isn't enough --
// Supabase's free tier keeps logs for only 1 day) -- the only thing not
// happening is reflecting the failure in the HTTP status.
//
// The only two responses that are NOT `200 { received: true }`: the OPTIONS
// preflight response (not a real webhook delivery) and a non-POST method
// (405 -- a misconfigured route, not something a retry storm would come
// from).
//
// KNOWN, DELIBERATE SCOPE GAP -- flagged, not fixed here: Mercado Pago's
// webhook payload for the `payment` topic carries no status field at all
// (see `_shared/payments/mercadopago/webhook.ts` -- `hintedStatus` is
// hardcoded `'unknown'` for exactly this reason), so this function has no
// reliable signal to detect a *refund* event and cannot call
// `app.refund_order` from here. Nothing in this task's spec, or anywhere
// else in the built system as of this writing, assigns refund-webhook
// handling to any component -- refunds currently have no automated trigger
// anywhere. This is a real product gap for the orchestrating session to
// decide about, not something to silently work around or invent a fix for
// in this file.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymentProvider, WebhookEvent, WebhookRequest } from '../../../contracts/payments.ts';
import { type EnvSource, loadBackendConfig } from '../_shared/config.ts';
import { corsPreflightResponse, errorJsonResponse, jsonResponse } from '../_shared/http.ts';
import {
  captureAndFlush,
  captureExceptionAndFlush,
  type PostHogEnv,
} from '../_shared/observability.ts';
import { MercadoPagoProvider } from '../_shared/payments/mercadopago/provider.ts';
import { confirmOrder } from '../_shared/payments/confirm-order.ts';
import { createServiceRoleClient } from '../_shared/supabase.ts';

const APP_PRIVATE_SCHEMA = 'app_private';
const PAYMENT_EVENTS_TABLE = 'payment_events';
const UNIQUE_VIOLATION_CODE = '23505';

// Used when no per-event identifier is available yet (parse failure) or as
// the final fallback for PostHog attribution -- distinct from the
// `'anonymous'` convention used by `video-resolve` since there is no
// authenticated caller concept on this public endpoint at all.
const SYSTEM_DISTINCT_ID = 'system';
const UNKNOWN_DISTINCT_ID = 'unknown';

export interface PaymentsWebhookDeps {
  readonly postHogEnv: PostHogEnv;
  readonly paymentProvider: PaymentProvider;
  readonly supabase: SupabaseClient; // service_role -- see supabase.ts; no caller JWT exists here
  // Every collaborator below is injectable for tests, matching this repo's
  // DI-testable-handler convention (see `_shared/payments/confirm-order.ts`
  // and `video-resolve/index.ts`); each defaults to the real implementation.
  readonly captureFn?: typeof captureAndFlush;
  readonly captureExceptionFn?: typeof captureExceptionAndFlush;
  readonly confirmOrderFn?: typeof confirmOrder;
}

interface PaymentEventRow {
  readonly id: string;
}

type RecordEventResult =
  | { readonly ok: true; readonly paymentEventId: string | null }
  | { readonly ok: false };

function receivedResponse(): Response {
  return jsonResponse({ received: true });
}

function eventDistinctId(event: WebhookEvent): string {
  return event.externalReference ?? event.providerChargeId ?? UNKNOWN_DISTINCT_ID;
}

// Best-effort dedup/audit insert per A8's migration comment ("not the sole
// guarantee -- confirmOrder's own CAS is"). A conflicting (provider,
// event_id) is an EXPECTED outcome (a genuine gateway retry of an event
// already recorded), not an error -- this function never throws for that
// case, it looks up the existing row's id instead so the status update
// later in the flow still has somewhere to write. Any other insert error is
// a real, unexpected failure and short-circuits this event's processing
// (the caller does not call `confirmOrder` in that case).
async function recordPaymentEvent(
  supabase: SupabaseClient,
  postHogEnv: PostHogEnv,
  capture: typeof captureAndFlush,
  event: WebhookEvent,
): Promise<RecordEventResult> {
  const { data, error } = await supabase
    .schema(APP_PRIVATE_SCHEMA)
    .from(PAYMENT_EVENTS_TABLE)
    .insert({
      provider: event.provider,
      event_id: event.eventId,
      payload: event.raw,
      received_at: event.receivedAt,
    })
    .select('id')
    .single();

  if (!error) {
    return { ok: true, paymentEventId: (data as PaymentEventRow | null)?.id ?? null };
  }

  if (error.code === UNIQUE_VIOLATION_CODE) {
    const { data: existing } = await supabase
      .schema(APP_PRIVATE_SCHEMA)
      .from(PAYMENT_EVENTS_TABLE)
      .select('id')
      .eq('provider', event.provider)
      .eq('event_id', event.eventId)
      .maybeSingle();
    // If the existing row genuinely can't be found despite the conflict
    // (should not happen -- a conflict implies the row existed a moment
    // ago), proceed with a null id: the status update below becomes a
    // no-op, but confirmOrder still runs, which is the part that actually
    // matters for the payer.
    return { ok: true, paymentEventId: (existing as PaymentEventRow | null)?.id ?? null };
  }

  await capture(postHogEnv, {
    event: 'payment_webhook_failed',
    distinctId: eventDistinctId(event),
    properties: {
      eventId: event.eventId,
      reason: 'payment_events_insert_failed',
      detail: error.message,
    },
  });
  return { ok: false };
}

// Errors updating the audit-trail row itself are deliberately not allowed
// to affect this event's outcome or the overall response -- the actual
// work (recordPaymentEvent's insert, confirmOrder) already happened; this
// is bookkeeping on top of it. Still captured, never silently dropped.
async function updatePaymentEventStatus(
  supabase: SupabaseClient,
  postHogEnv: PostHogEnv,
  captureException: typeof captureExceptionAndFlush,
  paymentEventId: string | null,
  status: 'processed' | 'failed',
): Promise<void> {
  if (paymentEventId === null) return;
  const { error } = await supabase
    .schema(APP_PRIVATE_SCHEMA)
    .from(PAYMENT_EVENTS_TABLE)
    .update({ status, processed_at: new Date().toISOString() })
    .eq('id', paymentEventId);

  if (error) {
    await captureException(postHogEnv, {
      distinctId: SYSTEM_DISTINCT_ID,
      error: new Error(`Failed to update payment_events status: ${error.message}`),
      properties: { paymentEventId, status, reason: 'payment_event_status_update_failed' },
    });
  }
}

interface ProcessEventDeps {
  readonly supabase: SupabaseClient;
  readonly paymentProvider: PaymentProvider;
  readonly postHogEnv: PostHogEnv;
  readonly capture: typeof captureAndFlush;
  readonly captureException: typeof captureExceptionAndFlush;
  readonly confirmOrderFn: typeof confirmOrder;
}

type OrderLookupResult =
  | { readonly outcome: 'found'; readonly orderId: string }
  | { readonly outcome: 'not_found' }
  | { readonly outcome: 'error'; readonly message: string };

// Fallback path for Mercado Pago's `payment`-topic webhook, whose
// notification body never carries `external_reference` -- only the
// gateway's own charge id (see `_shared/payments/mercadopago/webhook.ts`,
// which hardcodes `externalReference: null` for exactly this reason).
// `checkout` (B9) persists that same charge id onto `orders.provider_charge_id`
// at charge-creation time (`updateOrderProviderRefs`), and A7's migration
// puts a unique index on it (`orders_provider_charge_id_key ... where
// provider_charge_id is not null`), so a single-row lookup here is a
// reliable second way to map this event back to one of our orders.
async function findOrderIdByProviderChargeId(
  supabase: SupabaseClient,
  providerChargeId: string,
): Promise<OrderLookupResult> {
  const { data, error } = await supabase
    .from('orders')
    .select('id')
    .eq('provider_charge_id', providerChargeId)
    .maybeSingle();

  if (error) {
    return { outcome: 'error', message: error.message };
  }
  if (!data) {
    return { outcome: 'not_found' };
  }
  return { outcome: 'found', orderId: (data as { id: string }).id };
}

async function processEvent(event: WebhookEvent, deps: ProcessEventDeps): Promise<void> {
  await deps.capture(deps.postHogEnv, {
    event: 'payment_webhook_received',
    distinctId: eventDistinctId(event),
    properties: {
      eventId: event.eventId,
      providerChargeId: event.providerChargeId,
      provider: event.provider,
    },
  });

  const recordResult = await recordPaymentEvent(
    deps.supabase,
    deps.postHogEnv,
    deps.capture,
    event,
  );
  if (!recordResult.ok) {
    return;
  }
  const { paymentEventId } = recordResult;

  let orderId = event.externalReference;

  if (orderId === null || orderId.trim().length === 0) {
    const lookup = await findOrderIdByProviderChargeId(deps.supabase, event.providerChargeId);

    if (lookup.outcome === 'error') {
      // A DB error looking up the fallback is a real, unexpected failure --
      // same posture as `recordPaymentEvent`'s non-23505 branch: capture and
      // mark the event failed, do not let it throw uncaught.
      await deps.capture(deps.postHogEnv, {
        event: 'payment_webhook_failed',
        distinctId: eventDistinctId(event),
        properties: {
          eventId: event.eventId,
          reason: 'order_lookup_by_provider_charge_id_failed',
          detail: lookup.message,
        },
      });
      await updatePaymentEventStatus(
        deps.supabase,
        deps.postHogEnv,
        deps.captureException,
        paymentEventId,
        'failed',
      );
      return;
    }

    orderId = lookup.outcome === 'found' ? lookup.orderId : null;
  }

  if (orderId === null || orderId.trim().length === 0) {
    // Genuinely can't be mapped to any of our orders -- neither the payload
    // nor a provider_charge_id lookup resolved it (e.g. a charge id we
    // never created). Nothing further to act on here. Reconciliation (a
    // poll over `orders WHERE status = 'pending'`) does not depend on this
    // webhook path, so a payment that settles this way is still recoverable
    // there.
    await deps.capture(deps.postHogEnv, {
      event: 'payment_webhook_failed',
      distinctId: eventDistinctId(event),
      properties: { eventId: event.eventId, reason: 'missing_external_reference' },
    });
    await updatePaymentEventStatus(
      deps.supabase,
      deps.postHogEnv,
      deps.captureException,
      paymentEventId,
      'failed',
    );
    return;
  }

  try {
    await deps.confirmOrderFn(
      {
        supabase: deps.supabase,
        paymentProvider: deps.paymentProvider,
        postHogEnv: deps.postHogEnv,
      },
      { orderId, providerChargeId: event.providerChargeId },
    );
    await updatePaymentEventStatus(
      deps.supabase,
      deps.postHogEnv,
      deps.captureException,
      paymentEventId,
      'processed',
    );
  } catch (error) {
    await deps.captureException(deps.postHogEnv, {
      distinctId: orderId,
      error,
      properties: { eventId: event.eventId, orderId },
    });
    await updatePaymentEventStatus(
      deps.supabase,
      deps.postHogEnv,
      deps.captureException,
      paymentEventId,
      'failed',
    );
  }
}

export async function handlePaymentsWebhook(
  request: Request,
  deps: PaymentsWebhookDeps,
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return corsPreflightResponse();
  }
  if (request.method !== 'POST') {
    return errorJsonResponse({
      code: 'method_not_allowed',
      message: `Method ${request.method} is not allowed`,
      status: 405,
    });
  }

  const capture = deps.captureFn ?? captureAndFlush;
  const captureException = deps.captureExceptionFn ?? captureExceptionAndFlush;
  const confirmOrderFn = deps.confirmOrderFn ?? confirmOrder;

  // Top-level safety net: per the file-level comment above, EVERY failure
  // from here down resolves to 200 -- including a genuinely unexpected
  // exception (e.g. `request.text()` itself throwing), never an unhandled
  // 500.
  try {
    const rawBody = await request.text();
    const webhookRequest: WebhookRequest = {
      headers: Object.fromEntries(request.headers),
      rawBody,
      url: request.url,
    };

    const result = await deps.paymentProvider.parseWebhook(webhookRequest);

    if (!result.ok) {
      await capture(deps.postHogEnv, {
        event: 'payment_webhook_failed',
        distinctId: SYSTEM_DISTINCT_ID,
        properties: { reason: result.reason, detail: result.detail },
      });
      return receivedResponse();
    }

    for (const event of result.events) {
      try {
        await processEvent(event, {
          supabase: deps.supabase,
          paymentProvider: deps.paymentProvider,
          postHogEnv: deps.postHogEnv,
          capture,
          captureException,
          confirmOrderFn,
        });
      } catch (error) {
        // Defensive second safety net -- `processEvent` already wraps
        // `confirmOrder` and the `payment_events` writes individually, so
        // this branch should be unreachable in practice. Kept so a bug
        // anywhere else in one event's processing can never stop the rest
        // of the batch (Mercado Pago's own docs suggest usually one event,
        // but the contract models an array because some gateways batch).
        await captureException(deps.postHogEnv, {
          distinctId: SYSTEM_DISTINCT_ID,
          error,
          properties: { eventId: event.eventId, reason: 'event_processing_unexpected_exception' },
        });
      }
    }

    return receivedResponse();
  } catch (error) {
    await captureException(deps.postHogEnv, {
      distinctId: SYSTEM_DISTINCT_ID,
      error,
      properties: { reason: 'payments_webhook_unexpected_exception' },
    });
    return receivedResponse();
  }
}

// Real wiring only runs when this module is the process entry point (i.e.
// deployed/served directly), never on import -- keeps `deno test` from
// paying `loadBackendConfig()`'s fail-fast env validation just to import
// `handlePaymentsWebhook` for testing. Same convention as
// `video-resolve/index.ts`.
if (import.meta.main) {
  const config = loadBackendConfig();
  const env: EnvSource = Deno.env.toObject();
  const paymentProvider = new MercadoPagoProvider({
    accessToken: config.mercadoPago.accessToken,
    webhookSecret: config.mercadoPago.webhookSecret,
  });
  const supabase = createServiceRoleClient(env);
  Deno.serve((request) =>
    handlePaymentsWebhook(request, { postHogEnv: config.postHog, paymentProvider, supabase })
  );
}
