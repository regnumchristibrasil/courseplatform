-- A10 -- app.confirm_payment (atomic CAS) + app.expire_stale_orders.
-- Highest-value TDD unit in Track A: covers the happy path, webhook-retry
-- idempotency, unknown order, the already-active-enrollment edge case, the
-- lifetime-vs-timed expires_at computation, and the grant surface.
BEGIN;
SELECT plan(25);

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'buyer-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'buyer-b@example.com');

INSERT INTO public.courses (id, title, price_cents, status, access_duration_days) VALUES
  ('c0000000-0000-0000-0000-00000000000a', 'Lifetime Course', 10000, 'published', NULL),
  ('c0000000-0000-0000-0000-00000000000b', 'Timed Course', 15000, 'published', 30);

INSERT INTO public.orders (id, user_id, course_id, amount_cents, provider, status) VALUES
  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a', 10000, 'mercadopago', 'pending'),
  ('00000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000b', 15000, 'mercadopago', 'pending');

-- Happy path: lifetime course -> did_transition true, enrollment created
-- with expires_at NULL.
SET LOCAL ROLE service_role;
SELECT results_eq(
  $$ SELECT did_transition, order_status FROM app.confirm_payment(
       '00000000-0000-0000-0000-000000000001'::uuid, 'mp-charge-1', '2026-01-01T12:00:00Z'::timestamptz
     ) $$,
  $$ VALUES (true, 'paid') $$,
  'confirm_payment on a pending order transitions to paid'
);
SELECT is(
  (SELECT status FROM public.orders WHERE id = '00000000-0000-0000-0000-000000000001'),
  'paid',
  'the order row itself is now paid'
);
SELECT is(
  (SELECT provider_charge_id FROM public.orders WHERE id = '00000000-0000-0000-0000-000000000001'),
  'mp-charge-1',
  'provider_charge_id is recorded on the order'
);
SELECT is(
  (SELECT count(*)::int FROM public.enrollments WHERE user_id = '11111111-1111-1111-1111-111111111111' AND course_id = 'c0000000-0000-0000-0000-00000000000a'),
  1,
  'exactly one enrollment was created'
);
SELECT is(
  (SELECT expires_at FROM public.enrollments WHERE user_id = '11111111-1111-1111-1111-111111111111' AND course_id = 'c0000000-0000-0000-0000-00000000000a'),
  NULL,
  'expires_at is NULL for a lifetime-access course (access_duration_days IS NULL)'
);
SELECT is(
  (SELECT granted_at FROM public.enrollments WHERE user_id = '11111111-1111-1111-1111-111111111111' AND course_id = 'c0000000-0000-0000-0000-00000000000a'),
  '2026-01-01T12:00:00Z'::timestamptz,
  'granted_at is set to p_paid_at, not now()'
);

-- Timed course: expires_at = p_paid_at + access_duration_days.
SELECT results_eq(
  $$ SELECT did_transition FROM app.confirm_payment(
       '00000000-0000-0000-0000-000000000002'::uuid, 'mp-charge-2', '2026-01-01T12:00:00Z'::timestamptz
     ) $$,
  $$ VALUES (true) $$,
  'confirm_payment on the second pending order also transitions'
);
SELECT is(
  (SELECT expires_at FROM public.enrollments WHERE user_id = '11111111-1111-1111-1111-111111111111' AND course_id = 'c0000000-0000-0000-0000-00000000000b'),
  '2026-01-31T12:00:00Z'::timestamptz,
  'expires_at = p_paid_at + access_duration_days days for a timed course'
);

-- Idempotency: a duplicate webhook delivery (same order, already paid) does
-- NOT transition again and does NOT create a second enrollment.
SELECT results_eq(
  $$ SELECT did_transition, order_status FROM app.confirm_payment(
       '00000000-0000-0000-0000-000000000001'::uuid, 'mp-charge-1-retry', '2026-01-02T00:00:00Z'::timestamptz
     ) $$,
  $$ VALUES (false, 'paid') $$,
  'a duplicate confirm_payment call on an already-paid order does not re-transition'
);
SELECT is(
  (SELECT count(*)::int FROM public.enrollments WHERE user_id = '11111111-1111-1111-1111-111111111111' AND course_id = 'c0000000-0000-0000-0000-00000000000a'),
  1,
  'no second enrollment was created by the duplicate call'
);
SELECT is(
  (SELECT provider_charge_id FROM public.orders WHERE id = '00000000-0000-0000-0000-000000000001'),
  'mp-charge-1',
  'the duplicate call does not overwrite the original provider_charge_id (CAS predicate excludes it)'
);

-- Unknown order id: did_transition false, everything else null -- not an
-- error, so the webhook handler can still return 200 and log.
SELECT results_eq(
  $$ SELECT did_transition, order_status, enrollment_id, user_id, course_id FROM app.confirm_payment(
       '99999999-9999-9999-9999-999999999999'::uuid, 'mp-charge-x', now()
     ) $$,
  $$ VALUES (false, NULL::text, NULL::uuid, NULL::uuid, NULL::uuid) $$,
  'confirm_payment on a nonexistent order_id returns did_transition=false and null fields, not an error'
);

-- Edge case: an already-ACTIVE enrollment for the same (user, course)
-- exists when a second order for that pair is confirmed -- the CAS still
-- flips the order to paid (did_transition=true), but ON CONFLICT DO
-- NOTHING means no second enrollment row is created and enrollment_id
-- comes back NULL.
INSERT INTO public.orders (id, user_id, course_id, amount_cents, provider, status) VALUES
  ('00000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a', 10000, 'mercadopago', 'pending');
SELECT results_eq(
  $$ SELECT did_transition, enrollment_id FROM app.confirm_payment(
       '00000000-0000-0000-0000-000000000003'::uuid, 'mp-charge-3', now()
     ) $$,
  $$ VALUES (true, NULL::uuid) $$,
  'confirming a second order for an already-actively-enrolled (user, course) transitions the order but does not duplicate the enrollment'
);
SELECT is(
  (SELECT count(*)::int FROM public.enrollments WHERE user_id = '11111111-1111-1111-1111-111111111111' AND course_id = 'c0000000-0000-0000-0000-00000000000a'),
  1,
  'still exactly one enrollment row after the conflicting confirm_payment call'
);
RESET ROLE;

-- Grant surface: service_role only.
SELECT ok(
  has_function_privilege('service_role', 'app.confirm_payment(uuid, text, timestamptz)', 'EXECUTE'),
  'service_role has EXECUTE on confirm_payment'
);
SELECT ok(
  NOT has_function_privilege('anon', 'app.confirm_payment(uuid, text, timestamptz)', 'EXECUTE'),
  'anon has NO EXECUTE on confirm_payment'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'app.confirm_payment(uuid, text, timestamptz)', 'EXECUTE'),
  'authenticated has NO EXECUTE on confirm_payment'
);

-- End-to-end RLS sanity: the owning user can now SELECT their own,
-- server-created enrollment.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT count(*)::int FROM public.enrollments WHERE course_id = 'c0000000-0000-0000-0000-00000000000a'),
  1,
  'the owning user can SELECT the enrollment app.confirm_payment created for them'
);
RESET ROLE;

-- app.expire_stale_orders.
INSERT INTO public.orders (id, user_id, course_id, amount_cents, provider, status, expires_at, created_at) VALUES
  ('00000000-0000-0000-0000-000000000010', '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-00000000000a', 10000, 'mercadopago', 'pending', now() - interval '1 hour', now() - interval '2 hours'),
  ('00000000-0000-0000-0000-000000000011', '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-00000000000b', 15000, 'mercadopago', 'pending', now() + interval '1 hour', now()),
  ('00000000-0000-0000-0000-000000000012', '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-00000000000a', 10000, 'mercadopago', 'pending', NULL, now());

SET LOCAL ROLE service_role;
SELECT is(
  app.expire_stale_orders(100),
  1,
  'expire_stale_orders returns the count of orders it actually expired'
);
SELECT is(
  (SELECT status FROM public.orders WHERE id = '00000000-0000-0000-0000-000000000010'),
  'expired',
  'a pending order past its own expires_at is flipped to expired'
);
SELECT is(
  (SELECT status FROM public.orders WHERE id = '00000000-0000-0000-0000-000000000011'),
  'pending',
  'a pending order whose expires_at is still in the future is left alone'
);
SELECT is(
  (SELECT status FROM public.orders WHERE id = '00000000-0000-0000-0000-000000000012'),
  'pending',
  'a pending order with expires_at IS NULL is left alone (no known charge expiry to sweep on)'
);
SELECT is(
  (SELECT status FROM public.orders WHERE id = '00000000-0000-0000-0000-000000000001'),
  'paid',
  'expire_stale_orders never touches an already-paid order'
);
RESET ROLE;

SELECT ok(
  has_function_privilege('service_role', 'app.expire_stale_orders(int)', 'EXECUTE'),
  'service_role has EXECUTE on expire_stale_orders'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'app.expire_stale_orders(int)', 'EXECUTE'),
  'authenticated has NO EXECUTE on expire_stale_orders'
);

SELECT * FROM finish();
ROLLBACK;
