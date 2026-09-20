// Thin wrapper around the already-migrated `app.expire_stale_orders` RPC --
// flips orders whose gateway-issued PIX charge TTL has passed straight to
// `'expired'`, no gateway re-check needed (see prompt_course_platform.md's
// "Expiry sweep" note). Never reimplement the RPC's own logic here.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ExpireStaleOrdersResult {
  readonly expired: number;
  readonly error: Error | null;
}

// Never throws -- a failure here is reported back as `{ expired: 0, error }`
// so the caller can capture it and still return the reconciliation-pass
// results it already has, per the spec's "partial results are still useful
// to a cron consumer" instruction.
export async function expireStaleOrders(
  client: SupabaseClient,
  limit: number,
): Promise<ExpireStaleOrdersResult> {
  try {
    const { data, error } = await client
      .schema('app')
      .rpc('expire_stale_orders', { p_limit: limit });

    if (error) {
      return { expired: 0, error: new Error(`expire_stale_orders RPC failed: ${error.message}`) };
    }
    return { expired: typeof data === 'number' ? data : 0, error: null };
  } catch (error) {
    return {
      expired: 0,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
