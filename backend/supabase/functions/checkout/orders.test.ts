import { assertEquals, assertRejects } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createFakeClient } from './fakes.ts';
import {
  findReusableOrder,
  insertPendingOrder,
  OrderInsertError,
  OrderLookupError,
  OrderUpdateError,
  updateOrderProviderRefs,
} from './orders.ts';

Deno.test('findReusableOrder returns the mapped order when one exists', async () => {
  const { client } = createFakeClient({
    orders: {
      select: {
        data: {
          id: 'order-1',
          amount_cents: 4990,
          currency: 'BRL',
          created_at: '2026-01-01T00:00:00Z',
        },
        error: null,
      },
    },
  });
  const order = await findReusableOrder(
    client as unknown as SupabaseClient,
    'user-1',
    'course-1',
  );
  assertEquals(order, { id: 'order-1', amountCents: 4990 });
});

Deno.test('findReusableOrder returns null when there is no pending order', async () => {
  const { client } = createFakeClient({ orders: { select: { data: null, error: null } } });
  const order = await findReusableOrder(
    client as unknown as SupabaseClient,
    'user-1',
    'course-1',
  );
  assertEquals(order, null);
});

Deno.test('findReusableOrder throws OrderLookupError on a DB error', async () => {
  const { client } = createFakeClient({
    orders: { select: { data: null, error: { message: 'timeout' } } },
  });
  await assertRejects(
    () => findReusableOrder(client as unknown as SupabaseClient, 'user-1', 'course-1'),
    OrderLookupError,
  );
});

Deno.test('findReusableOrder filters by user, course, pending status, and non-expired', async () => {
  const { client, calls } = createFakeClient({ orders: { select: { data: null, error: null } } });
  await findReusableOrder(client as unknown as SupabaseClient, 'user-1', 'course-1');

  const eqCalls = calls.filter((call) => call.method === 'eq');
  assertEquals(eqCalls, [
    { table: 'orders', method: 'eq', args: ['user_id', 'user-1'] },
    { table: 'orders', method: 'eq', args: ['course_id', 'course-1'] },
    { table: 'orders', method: 'eq', args: ['status', 'pending'] },
  ]);

  // The `.or()` clause's exact content (embedded "now" timestamp) is
  // covered by the dedicated test below -- here just confirm it ran once.
  const orCalls = calls.filter((call) => call.method === 'or');
  assertEquals(orCalls.length, 1);

  const orderCall = calls.find((call) => call.method === 'order');
  assertEquals(orderCall, {
    table: 'orders',
    method: 'order',
    args: ['created_at', { ascending: false }],
  });

  const limitCall = calls.find((call) => call.method === 'limit');
  assertEquals(limitCall, { table: 'orders', method: 'limit', args: [1] });
});

// The `.or()` clause embeds `new Date().toISOString()` -- assert only the
// static prefix/shape rather than an exact timestamp, to avoid a flaky test
// on slow CI runs where "now" ticks between the call and the assertion.
Deno.test('findReusableOrder embeds an expires_at.is.null OR expires_at.gt.<now> clause', async () => {
  const { client, calls } = createFakeClient({ orders: { select: { data: null, error: null } } });
  const before = Date.now();
  await findReusableOrder(client as unknown as SupabaseClient, 'user-1', 'course-1');
  const after = Date.now();

  const orCall = calls.find((call) => call.method === 'or');
  const clause = orCall?.args[0] as string;
  const match = clause.match(/^expires_at\.is\.null,expires_at\.gt\.(.+)$/);
  if (!match) {
    throw new Error(`unexpected or() clause: ${clause}`);
  }
  const embeddedTime = Date.parse(match[1] as string);
  if (embeddedTime < before || embeddedTime > after) {
    throw new Error(`embedded timestamp ${match[1]} not within [${before}, ${after}]`);
  }
});

Deno.test('insertPendingOrder inserts a pending order and returns its id', async () => {
  const { client, calls } = createFakeClient({
    orders: { insert: { data: { id: 'order-new' }, error: null } },
  });
  const orderId = await insertPendingOrder(client as unknown as SupabaseClient, {
    userId: 'user-1',
    courseId: 'course-1',
    amountCents: 4990,
    provider: 'mercadopago',
    expiresAt: '2026-01-01T00:30:00.000Z',
  });

  assertEquals(orderId, 'order-new');
  const insertCall = calls.find((call) => call.method === 'insert');
  assertEquals(insertCall?.args[0], {
    user_id: 'user-1',
    course_id: 'course-1',
    amount_cents: 4990,
    currency: 'BRL',
    provider: 'mercadopago',
    status: 'pending',
    expires_at: '2026-01-01T00:30:00.000Z',
  });
});

Deno.test('insertPendingOrder throws OrderInsertError on a DB error', async () => {
  const { client } = createFakeClient({
    orders: { insert: { data: null, error: { message: 'unique violation' } } },
  });
  await assertRejects(
    () =>
      insertPendingOrder(client as unknown as SupabaseClient, {
        userId: 'user-1',
        courseId: 'course-1',
        amountCents: 4990,
        provider: 'mercadopago',
        expiresAt: '2026-01-01T00:30:00.000Z',
      }),
    OrderInsertError,
  );
});

Deno.test('insertPendingOrder throws OrderInsertError when no row is returned and no error is set', async () => {
  const { client } = createFakeClient({
    orders: { insert: { data: null, error: null } },
  });
  await assertRejects(
    () =>
      insertPendingOrder(client as unknown as SupabaseClient, {
        userId: 'user-1',
        courseId: 'course-1',
        amountCents: 4990,
        provider: 'mercadopago',
        expiresAt: '2026-01-01T00:30:00.000Z',
      }),
    OrderInsertError,
  );
});

Deno.test('updateOrderProviderRefs updates provider fields by order id', async () => {
  const { client, calls } = createFakeClient({
    orders: { update: { data: null, error: null } },
  });
  await updateOrderProviderRefs(client as unknown as SupabaseClient, 'order-1', {
    providerChargeId: 'charge-123',
    providerTxid: 'txid-abc',
    externalReference: 'order-1',
  });

  const updateCall = calls.find((call) => call.method === 'update');
  assertEquals(updateCall?.args[0], {
    provider_charge_id: 'charge-123',
    provider_txid: 'txid-abc',
    external_reference: 'order-1',
  });
  const eqCall = calls.find((call) => call.method === 'eq');
  assertEquals(eqCall, { table: 'orders', method: 'eq', args: ['id', 'order-1'] });
});

Deno.test('updateOrderProviderRefs throws OrderUpdateError on a DB error', async () => {
  const { client } = createFakeClient({
    orders: { update: { data: null, error: { message: 'row not found' } } },
  });
  await assertRejects(
    () =>
      updateOrderProviderRefs(client as unknown as SupabaseClient, 'order-1', {
        providerChargeId: 'charge-123',
        providerTxid: null,
        externalReference: 'order-1',
      }),
    OrderUpdateError,
  );
});
