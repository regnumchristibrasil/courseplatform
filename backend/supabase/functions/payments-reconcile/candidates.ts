// Selects `orders` rows worth re-checking with the payment gateway: still
// `pending`, old enough that a webhook should have arrived by now, and
// actually carrying a charge id to refetch (see prompt_course_platform.md's
// "Add a scheduled reconciliation job" note -- an order with no
// `provider_charge_id` never got a charge created at all, so there is
// nothing for `confirmOrder` to check).

import type { SupabaseClient } from '@supabase/supabase-js';

const PENDING_STATUS = 'pending';
const STALE_AFTER_MINUTES = 3; // NFR: reconciliation cron re-checks orders pending > 3 min.

export class CandidateOrdersLookupError extends Error {
  constructor(message: string) {
    super(`Failed to look up reconciliation candidate orders: ${message}`);
    this.name = 'CandidateOrdersLookupError';
  }
}

export interface CandidateOrder {
  readonly id: string;
  readonly providerChargeId: string;
}

interface CandidateOrderRow {
  readonly id: string;
  readonly provider_charge_id: string | null;
}

function staleBeforeIso(now: () => Date): string {
  return new Date(now().getTime() - STALE_AFTER_MINUTES * 60_000).toISOString();
}

export async function fetchCandidateOrders(
  client: SupabaseClient,
  limit: number,
  now: () => Date = () => new Date(),
): Promise<readonly CandidateOrder[]> {
  const { data, error } = await client
    .from('orders')
    .select('id, provider_charge_id')
    .eq('status', PENDING_STATUS)
    .not('provider_charge_id', 'is', null)
    .lte('created_at', staleBeforeIso(now))
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new CandidateOrdersLookupError(error.message);
  }

  const rows = (data ?? []) as readonly CandidateOrderRow[];
  // The `.not('provider_charge_id', 'is', null)` filter above already
  // excludes nulls at the DB level -- this narrows the type for callers
  // rather than re-filtering, and defensively skips a row in the
  // (shouldn't-happen) case a null slips through.
  return rows
    .filter((row): row is CandidateOrderRow & { readonly provider_charge_id: string } =>
      row.provider_charge_id !== null
    )
    .map((row) => ({ id: row.id, providerChargeId: row.provider_charge_id }));
}
