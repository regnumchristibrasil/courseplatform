import { assertEquals, assertRejects } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CandidateOrdersLookupError, fetchCandidateOrders } from './candidates.ts';
import { createFakeReconcileSupabase } from './fakes.ts';

const FIXED_NOW = () => new Date('2026-09-03T12:00:00.000Z');

Deno.test('fetchCandidateOrders returns the mapped candidate orders', async () => {
  const { client } = createFakeReconcileSupabase({
    ordersSelectResult: {
      data: [
        { id: 'order-1', provider_charge_id: 'charge-1' },
        { id: 'order-2', provider_charge_id: 'charge-2' },
      ],
      error: null,
    },
  });

  const candidates = await fetchCandidateOrders(
    client as unknown as SupabaseClient,
    100,
    FIXED_NOW,
  );

  assertEquals(candidates, [
    { id: 'order-1', providerChargeId: 'charge-1' },
    { id: 'order-2', providerChargeId: 'charge-2' },
  ]);
});

Deno.test('fetchCandidateOrders returns an empty array when there is no data', async () => {
  const { client } = createFakeReconcileSupabase({
    ordersSelectResult: { data: null, error: null },
  });
  const candidates = await fetchCandidateOrders(
    client as unknown as SupabaseClient,
    100,
    FIXED_NOW,
  );
  assertEquals(candidates, []);
});

Deno.test('fetchCandidateOrders defensively skips a row with a null provider_charge_id', async () => {
  const { client } = createFakeReconcileSupabase({
    ordersSelectResult: {
      data: [
        { id: 'order-1', provider_charge_id: null },
        { id: 'order-2', provider_charge_id: 'charge-2' },
      ],
      error: null,
    },
  });
  const candidates = await fetchCandidateOrders(
    client as unknown as SupabaseClient,
    100,
    FIXED_NOW,
  );
  assertEquals(candidates, [{ id: 'order-2', providerChargeId: 'charge-2' }]);
});

Deno.test('fetchCandidateOrders uses the real current time when now is not injected', async () => {
  const { client, ordersCalls } = createFakeReconcileSupabase({
    ordersSelectResult: { data: [], error: null },
  });
  const before = Date.now();
  await fetchCandidateOrders(client as unknown as SupabaseClient, 100);
  const after = Date.now();

  const lteCall = ordersCalls.find((call) => call.method === 'lte');
  const embeddedIso = (lteCall?.args[1] as string) ?? '';
  const embeddedTime = Date.parse(embeddedIso);
  const staleWindowMs = 3 * 60_000;
  if (embeddedTime < before - staleWindowMs || embeddedTime > after - staleWindowMs) {
    throw new Error(`embedded staleBefore timestamp ${embeddedIso} not within expected window`);
  }
});

Deno.test('fetchCandidateOrders throws CandidateOrdersLookupError on a DB error', async () => {
  const { client } = createFakeReconcileSupabase({
    ordersSelectResult: { data: null, error: { message: 'timeout' } },
  });
  await assertRejects(
    () => fetchCandidateOrders(client as unknown as SupabaseClient, 100, FIXED_NOW),
    CandidateOrdersLookupError,
  );
});

Deno.test('fetchCandidateOrders filters by pending status, non-null charge id, staleness, orders ascending, and clamps the limit', async () => {
  const { client, ordersCalls } = createFakeReconcileSupabase({
    ordersSelectResult: { data: [], error: null },
  });
  await fetchCandidateOrders(client as unknown as SupabaseClient, 42, FIXED_NOW);

  const eqCall = ordersCalls.find((call) => call.method === 'eq');
  assertEquals(eqCall, { method: 'eq', args: ['status', 'pending'] });

  const notCall = ordersCalls.find((call) => call.method === 'not');
  assertEquals(notCall, { method: 'not', args: ['provider_charge_id', 'is', null] });

  const lteCall = ordersCalls.find((call) => call.method === 'lte');
  // 3 minutes before the fixed "now" injected above.
  assertEquals(lteCall, { method: 'lte', args: ['created_at', '2026-09-03T11:57:00.000Z'] });

  const orderCall = ordersCalls.find((call) => call.method === 'order');
  assertEquals(orderCall, { method: 'order', args: ['created_at', { ascending: true }] });

  const limitCall = ordersCalls.find((call) => call.method === 'limit');
  assertEquals(limitCall, { method: 'limit', args: [42] });
});
