import { assertEquals } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { expireStaleOrders } from './expire-stale.ts';
import { createFakeReconcileSupabase } from './fakes.ts';

Deno.test('expireStaleOrders returns the RPC-returned count on success', async () => {
  const { client, rpcCalls } = createFakeReconcileSupabase({ rpcResult: { data: 7, error: null } });
  const result = await expireStaleOrders(client as unknown as SupabaseClient, 100);
  assertEquals(result, { expired: 7, error: null });
  assertEquals(rpcCalls, [{ schema: 'app', fn: 'expire_stale_orders', args: { p_limit: 100 } }]);
});

Deno.test('expireStaleOrders returns expired:0 and a non-null data value defensively', async () => {
  const { client } = createFakeReconcileSupabase({ rpcResult: { data: null, error: null } });
  const result = await expireStaleOrders(client as unknown as SupabaseClient, 100);
  assertEquals(result, { expired: 0, error: null });
});

Deno.test('expireStaleOrders never throws -- returns expired:0 and an error when the RPC returns a Postgrest error', async () => {
  const { client } = createFakeReconcileSupabase({
    rpcResult: { data: null, error: { message: 'function does not exist' } },
  });
  const result = await expireStaleOrders(client as unknown as SupabaseClient, 100);
  assertEquals(result.expired, 0);
  assertEquals(result.error instanceof Error, true);
  assertEquals(result.error?.message.includes('function does not exist'), true);
});

Deno.test('expireStaleOrders never throws -- returns expired:0 and an error when the RPC call itself throws', async () => {
  const { client } = createFakeReconcileSupabase({ rpcThrows: new Error('network exploded') });
  const result = await expireStaleOrders(client as unknown as SupabaseClient, 100);
  assertEquals(result.expired, 0);
  assertEquals(result.error instanceof Error, true);
  assertEquals(result.error?.message, 'network exploded');
});

Deno.test('expireStaleOrders wraps a thrown non-Error value', async () => {
  const { client } = createFakeReconcileSupabase({ rpcThrows: 'plain string rejection' });
  const result = await expireStaleOrders(client as unknown as SupabaseClient, 100);
  assertEquals(result.expired, 0);
  assertEquals(result.error?.message, 'plain string rejection');
});
