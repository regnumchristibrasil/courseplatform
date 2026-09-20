-- A7 -- orders RLS ("anon: -, owner: S (own), other user: -,
-- service_role: all"), with amount_cents proven un-writable by any client
-- role and provider_charge_id proven unique once assigned.
BEGIN;
SELECT plan(23);

SELECT has_table('public', 'orders', 'public.orders exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.orders'::regclass),
  'RLS is enabled on public.orders'
);

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'buyer@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'other@example.com');

INSERT INTO public.courses (id, title, price_cents, status) VALUES
  ('c0000000-0000-0000-0000-00000000000a', 'Priced Course', 19900, 'published');

INSERT INTO public.orders (id, user_id, course_id, amount_cents, provider, status) VALUES
  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a', 19900, 'mercadopago', 'pending');

-- amount_cents is never client-settable, in either direction.
SELECT is(
  (SELECT amount_cents FROM public.orders WHERE id = '00000000-0000-0000-0000-000000000001'),
  19900,
  'amount_cents matches courses.price_cents as inserted server-side'
);

-- provider_charge_id uniqueness once assigned; NULLs (pre-charge-creation)
-- do not collide with each other.
INSERT INTO public.orders (user_id, course_id, amount_cents, provider, status) VALUES
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-00000000000a', 19900, 'mercadopago', 'pending');
SELECT is(
  (SELECT count(*)::int FROM public.orders WHERE provider_charge_id IS NULL),
  2,
  'two orders can both have a NULL provider_charge_id (pre-charge-creation)'
);
UPDATE public.orders SET provider_charge_id = 'mp-charge-1' WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT throws_ok(
  $$ UPDATE public.orders SET provider_charge_id = 'mp-charge-1' WHERE user_id = '22222222-2222-2222-2222-222222222222' $$,
  NULL, NULL,
  'a second order cannot claim the same provider_charge_id'
);

-- anon: fully denied, all four operations.
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT count(*) FROM public.orders $$,
  NULL, NULL,
  'anon SELECT on public.orders is denied'
);
SELECT throws_ok(
  $$ INSERT INTO public.orders (user_id, course_id, amount_cents, provider) VALUES ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a', 1, 'mercadopago') $$,
  NULL, NULL,
  'anon INSERT on public.orders is denied'
);
SELECT throws_ok(
  $$ UPDATE public.orders SET status = 'paid' $$,
  NULL, NULL,
  'anon UPDATE on public.orders is denied'
);
SELECT throws_ok(
  $$ DELETE FROM public.orders $$,
  NULL, NULL,
  'anon DELETE on public.orders is denied'
);
RESET ROLE;

-- owner: SELECT own rows only, no writes at all -- including trying to
-- tamper with amount_cents on their own order.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT count(*)::int FROM public.orders),
  1,
  'owner SELECT sees only their own order'
);
SELECT throws_ok(
  $$ INSERT INTO public.orders (user_id, course_id, amount_cents, provider)
     VALUES (auth.uid(), 'c0000000-0000-0000-0000-00000000000a', 1, 'mercadopago') $$,
  NULL, NULL,
  'owner INSERT on public.orders is denied (price-tampering vector -- amount_cents must be server-computed)'
);
SELECT throws_ok(
  $$ UPDATE public.orders SET amount_cents = 1 WHERE user_id = auth.uid() $$,
  NULL, NULL,
  'owner UPDATE of amount_cents on their own order is denied'
);
SELECT throws_ok(
  $$ UPDATE public.orders SET status = 'paid' WHERE user_id = auth.uid() $$,
  NULL, NULL,
  'owner UPDATE of status on their own order is denied (no self-service payment confirmation)'
);
SELECT throws_ok(
  $$ DELETE FROM public.orders WHERE user_id = auth.uid() $$,
  NULL, NULL,
  'owner DELETE on public.orders is denied'
);
RESET ROLE;

-- other user: cannot see the first user's order, and cannot write to it
-- either (no grant exists at all, so this is denied before RLS even runs).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT is(
  (SELECT count(*)::int FROM public.orders WHERE id = '00000000-0000-0000-0000-000000000001'),
  0,
  'other user cannot SELECT the first user''s order'
);
SELECT throws_ok(
  $$ UPDATE public.orders SET status = 'paid' WHERE id = '00000000-0000-0000-0000-000000000001' $$,
  NULL, NULL,
  'other user cannot UPDATE the first user''s order (no grant, regardless of RLS row-scoping)'
);
RESET ROLE;

-- service_role: unrestricted -- proven functionally (INSERT/UPDATE/DELETE).
SET LOCAL ROLE service_role;
SELECT is(
  (SELECT count(*)::int FROM public.orders),
  2,
  'service_role SELECT sees every order'
);
UPDATE public.orders SET status = 'paid', paid_at = now() WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT is(
  (SELECT status FROM public.orders WHERE id = '00000000-0000-0000-0000-000000000001'),
  'paid',
  'service_role can UPDATE order status'
);
INSERT INTO public.orders (id, user_id, course_id, amount_cents, provider, status) VALUES
  ('00000000-0000-0000-0000-000000000099', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a', 19900, 'mercadopago', 'cancelled');
SELECT is(
  (SELECT count(*)::int FROM public.orders WHERE id = '00000000-0000-0000-0000-000000000099'),
  1,
  'service_role can INSERT an order directly'
);
DELETE FROM public.orders WHERE id = '00000000-0000-0000-0000-000000000099';
SELECT is(
  (SELECT count(*)::int FROM public.orders WHERE id = '00000000-0000-0000-0000-000000000099'),
  0,
  'service_role can DELETE an order directly'
);
RESET ROLE;

-- Data integrity.
SELECT throws_ok(
  $$ INSERT INTO public.orders (user_id, course_id, amount_cents, provider) VALUES ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a', -1, 'mercadopago') $$,
  NULL, NULL,
  'negative amount_cents is rejected'
);
SELECT throws_ok(
  $$ INSERT INTO public.orders (user_id, course_id, amount_cents, provider) VALUES ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a', 100, 'stripe') $$,
  NULL, NULL,
  'an unrecognized provider value is rejected'
);
SELECT throws_ok(
  $$ INSERT INTO public.orders (user_id, course_id, amount_cents, provider, status) VALUES ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a', 100, 'mercadopago', 'bogus') $$,
  NULL, NULL,
  'an unrecognized orders.status value is rejected'
);

SELECT * FROM finish();
ROLLBACK;
