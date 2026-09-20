// Shared "confirm a PIX order and transition it to paid" logic. This is the
// security boundary described in prompt_course_platform.md's "Webhook
// idempotency" section: a webhook-hinted status is never trusted -- the
// charge is always refetched from the payment gateway (ground truth) before
// any DB mutation happens.
//
// `payments-webhook` and `payments-reconcile` (not built yet) are meant to
// become thin wrappers around this module -- they differ only in how they
// discover `{ orderId, providerChargeId }` (webhook payload vs. a poll over
// `orders WHERE status = 'pending'`), not in what "confirm" means.
//
// `SupabaseClient` and `PaymentProvider` are both injected dependencies
// (never constructed here), following the same DI convention as
// `MercadoPagoProvider`'s injectable `fetchFn` -- this module stays testable
// without a real Postgres connection or gateway credentials.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChargeStatus, PaymentProvider } from '../../../../contracts/payments.ts';
import { captureAndFlush, type PostHogEnv } from '../observability.ts';

export interface ConfirmOrderDeps {
  readonly supabase: SupabaseClient; // service_role, injected by the caller
  readonly paymentProvider: PaymentProvider; // injected by the caller
  readonly postHogEnv: PostHogEnv;
  readonly captureFn?: typeof captureAndFlush; // default captureAndFlush, injectable for tests
}

export interface ConfirmOrderInput {
  readonly orderId: string;
  readonly providerChargeId: string; // charge id to refetch status for
}

export type ConfirmOrderResult =
  | {
    readonly outcome: 'confirmed';
    readonly orderId: string;
    readonly enrollmentId: string | null;
    readonly userId: string;
    readonly courseId: string;
  }
  | { readonly outcome: 'already_confirmed'; readonly orderId: string }
  | {
    readonly outcome: 'amount_mismatch';
    readonly orderId: string;
    readonly expectedCents: number;
    readonly actualCents: number;
  }
  | { readonly outcome: 'not_paid'; readonly orderId: string; readonly chargeStatus: ChargeStatus }
  | { readonly outcome: 'order_not_found'; readonly orderId: string };

interface OrderRow {
  readonly id: string;
  readonly user_id: string;
  readonly course_id: string;
  readonly amount_cents: number;
  readonly currency: string;
  readonly status: string;
}

interface UserRow {
  readonly email: string;
}

interface ConfirmPaymentRow {
  readonly did_transition: boolean;
  readonly order_status: string;
  readonly enrollment_id: string | null;
  readonly user_id: string;
  readonly course_id: string;
}

const PAID_ORDER_STATUS = 'paid';
const PAID_CHARGE_STATUS: ChargeStatus = 'paid';
const PURCHASE_CONFIRMATION_TEMPLATE = 'purchase_confirmation';

function dedupKey(orderId: string): string {
  return `${PURCHASE_CONFIRMATION_TEMPLATE}:${orderId}`;
}

export async function confirmOrder(
  deps: ConfirmOrderDeps,
  input: ConfirmOrderInput,
): Promise<ConfirmOrderResult> {
  const capture = deps.captureFn ?? captureAndFlush;

  const { data: order, error: orderError } = await deps.supabase
    .from('orders')
    .select('id, user_id, course_id, amount_cents, currency, status')
    .eq('id', input.orderId)
    .maybeSingle();

  if (orderError) {
    throw new Error(`Failed to fetch order ${input.orderId}: ${orderError.message}`);
  }
  if (!order) {
    return { outcome: 'order_not_found', orderId: input.orderId };
  }
  const orderRow = order as OrderRow;

  // Idempotent short-circuit -- a duplicate webhook/reconcile pass on an
  // already-paid order must not waste a gateway API call.
  if (orderRow.status === PAID_ORDER_STATUS) {
    return { outcome: 'already_confirmed', orderId: input.orderId };
  }

  // Ground truth. Never branch on anything the caller passed in about status
  // -- that's the whole point of this module.
  const snapshot = await deps.paymentProvider.getChargeStatus(input.providerChargeId);

  const amountMismatch = snapshot.amount.amountCents !== orderRow.amount_cents;
  const currencyMismatch = snapshot.amount.currency !== orderRow.currency;
  if (amountMismatch || currencyMismatch) {
    await capture(deps.postHogEnv, {
      event: 'payment_amount_mismatch',
      distinctId: orderRow.user_id,
      properties: {
        orderId: input.orderId,
        courseId: orderRow.course_id,
        expectedCents: orderRow.amount_cents,
        actualCents: snapshot.amount.amountCents,
      },
    });
    return {
      outcome: 'amount_mismatch',
      orderId: input.orderId,
      expectedCents: orderRow.amount_cents,
      actualCents: snapshot.amount.amountCents,
    };
  }

  if (snapshot.status !== PAID_CHARGE_STATUS) {
    return { outcome: 'not_paid', orderId: input.orderId, chargeStatus: snapshot.status };
  }

  const { data: confirmRows, error: confirmError } = await deps.supabase
    .schema('app')
    .rpc('confirm_payment', {
      p_order_id: input.orderId,
      p_provider_charge_id: snapshot.providerChargeId,
      p_paid_at: snapshot.paidAt ?? new Date().toISOString(),
    });

  if (confirmError) {
    throw new Error(
      `confirm_payment RPC failed for order ${input.orderId}: ${confirmError.message}`,
    );
  }

  const confirmRow = (confirmRows as ConfirmPaymentRow[] | null)?.[0];
  if (!confirmRow) {
    // Order existed a moment ago (step 1 above); the RPC contract guarantees
    // exactly one row back when it does. A missing row here means the
    // invariant broke somewhere else -- surface it loudly rather than
    // guessing at an outcome.
    throw new Error(`confirm_payment RPC returned no row for order ${input.orderId}`);
  }

  if (!confirmRow.did_transition) {
    // Race between two concurrent callers, or a genuine duplicate webhook
    // that arrived after the order was already flipped to 'paid'.
    return { outcome: 'already_confirmed', orderId: input.orderId };
  }

  const { data: user, error: userError } = await deps.supabase
    .from('users')
    .select('email')
    .eq('id', confirmRow.user_id)
    .single();

  if (userError) {
    throw new Error(
      `Failed to fetch email for user ${confirmRow.user_id} (order ${input.orderId}): ${userError.message}`,
    );
  }
  const userRow = user as UserRow;

  const { error: enqueueError } = await deps.supabase
    .schema('app')
    .rpc('enqueue_email', {
      p_template: PURCHASE_CONFIRMATION_TEMPLATE,
      p_to_email: userRow.email,
      p_payload: {
        order_id: input.orderId,
        course_id: confirmRow.course_id,
        enrollment_id: confirmRow.enrollment_id,
      },
      p_dedup_key: dedupKey(input.orderId),
    });

  if (enqueueError) {
    throw new Error(`enqueue_email RPC failed for order ${input.orderId}: ${enqueueError.message}`);
  }

  await capture(deps.postHogEnv, {
    event: 'payment_confirmed',
    distinctId: confirmRow.user_id,
    properties: {
      orderId: input.orderId,
      courseId: confirmRow.course_id,
      enrollmentId: confirmRow.enrollment_id,
    },
  });

  return {
    outcome: 'confirmed',
    orderId: input.orderId,
    enrollmentId: confirmRow.enrollment_id,
    userId: confirmRow.user_id,
    courseId: confirmRow.course_id,
  };
}
