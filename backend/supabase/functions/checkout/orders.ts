// Order read/write helpers for checkout. `authenticated` only has SELECT on
// `public.orders` (per A7's grants) -- all inserts/updates here must run on
// the service-role client (see `handler.ts`), never the caller client.

import type { SupabaseClient } from '@supabase/supabase-js';

const PENDING_STATUS = 'pending';
const CURRENCY_BRL = 'BRL';

export class OrderLookupError extends Error {
  constructor(message: string) {
    super(`Failed to look up existing order: ${message}`);
    this.name = 'OrderLookupError';
  }
}

export class OrderInsertError extends Error {
  constructor(message: string) {
    super(`Failed to insert order: ${message}`);
    this.name = 'OrderInsertError';
  }
}

export class OrderUpdateError extends Error {
  constructor(message: string) {
    super(`Failed to update order: ${message}`);
    this.name = 'OrderUpdateError';
  }
}

export interface ReusableOrder {
  readonly id: string;
  readonly amountCents: number;
}

// KNOWN RACE, documented not fixed -- out of scope for this task per its
// spec. This lookup and a subsequent `insertPendingOrder` call are not
// atomic: two concurrent checkout calls for the same (user, course) with no
// existing pending order can both observe "no reusable order" here and each
// insert a separate order row, creating two distinct PIX charges. Unlike
// `public.enrollments`'s partial unique index on `(user_id, course_id)
// WHERE status = 'active'` (see A6's migration), `public.orders` has no
// equivalent partial-unique constraint for `status = 'pending'`. Closing
// this gap is a migration change and is out of scope here.
export async function findReusableOrder(
  client: SupabaseClient,
  userId: string,
  courseId: string,
): Promise<ReusableOrder | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await client
    .from('orders')
    .select('id, amount_cents, currency, created_at')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .eq('status', PENDING_STATUS)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new OrderLookupError(error.message);
  }
  if (!data) {
    return null;
  }
  return { id: data.id, amountCents: data.amount_cents };
}

export interface InsertPendingOrderInput {
  readonly userId: string;
  readonly courseId: string;
  readonly amountCents: number;
  readonly provider: string;
  readonly expiresAt: string;
}

// Returns the new order's id. `amount_cents` here must always come from
// `courses.price_cents` read server-side by the caller -- never from the
// request body -- per the "no price tampering" rule in A7's migration
// comment.
export async function insertPendingOrder(
  client: SupabaseClient,
  input: InsertPendingOrderInput,
): Promise<string> {
  const { data, error } = await client
    .from('orders')
    .insert({
      user_id: input.userId,
      course_id: input.courseId,
      amount_cents: input.amountCents,
      currency: CURRENCY_BRL,
      provider: input.provider,
      status: PENDING_STATUS,
      expires_at: input.expiresAt,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new OrderInsertError(error?.message ?? 'insert returned no row');
  }
  return data.id;
}

export interface OrderProviderRefs {
  readonly providerChargeId: string;
  readonly providerTxid: string | null;
  readonly externalReference: string;
}

export async function updateOrderProviderRefs(
  client: SupabaseClient,
  orderId: string,
  refs: OrderProviderRefs,
): Promise<void> {
  const { error } = await client
    .from('orders')
    .update({
      provider_charge_id: refs.providerChargeId,
      provider_txid: refs.providerTxid,
      external_reference: refs.externalReference,
    })
    .eq('id', orderId);

  if (error) {
    throw new OrderUpdateError(error.message);
  }
}
