-- A13 -- app.refund_order: CAS (paid -> refunded) + automatic enrollment
-- revocation, webhook-retry idempotency, and the paid-but-no-active-
-- enrollment edge case.
BEGIN;
SELECT plan(17);

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'buyer-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'buyer-b@example.com');

INSERT INTO public.courses (id, title, price_cents, status) VALUES
  ('c0000000-0000-0000-0000-00000000000a', 'Refundable Course', 10000, 'published');

INSERT INTO public.orders (id, user_id, course_id, amount_cents, provider, status, paid_at) VALUES
  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a', 10000, 'mercadopago', 'paid', '2026-01-01T12:00:00Z'),
  ('00000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a', 10000, 'mercadopago', 'pending', NULL),
  ('00000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-00000000000a', 10000, 'mercadopago', 'paid', '2026-01-01T12:00:00Z');

INSERT INTO public.enrollments (id, user_id, course_id, status, granted_at) VALUES
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a', 'active', '2026-01-01T12:00:00Z');
  -- user B (order 3) intentionally has NO enrollment row -- covers the
  -- paid-but-nothing-to-revoke edge case.

SET LOCAL ROLE service_role;

-- Happy path.
SELECT results_eq(
  $$ SELECT did_transition, revoked_enrollment_id FROM app.refund_order(
       '00000000-0000-0000-0000-000000000001'::uuid, '2026-01-05T00:00:00Z'::timestamptz
     ) $$,
  $$ VALUES (true, 'e0000000-0000-0000-0000-000000000001'::uuid) $$,
  'refund_order on a paid order with an active enrollment transitions and revokes it'
);
SELECT is(
  (SELECT status FROM public.orders WHERE id = '00000000-0000-0000-0000-000000000001'),
  'refunded',
  'the order row is now refunded'
);
SELECT is(
  (SELECT refunded_at FROM public.orders WHERE id = '00000000-0000-0000-0000-000000000001'),
  '2026-01-05T00:00:00Z'::timestamptz,
  'refunded_at is stamped with p_refunded_at'
);
SELECT is(
  (SELECT status FROM public.enrollments WHERE id = 'e0000000-0000-0000-0000-000000000001'),
  'refunded',
  'the matching enrollment is revoked (status -> refunded), not deleted'
);

-- Idempotency: a duplicate refund webhook delivery is a no-op.
SELECT results_eq(
  $$ SELECT did_transition, revoked_enrollment_id FROM app.refund_order(
       '00000000-0000-0000-0000-000000000001'::uuid, '2026-01-06T00:00:00Z'::timestamptz
     ) $$,
  $$ VALUES (false, NULL::uuid) $$,
  'a duplicate refund_order call on an already-refunded order does not re-transition'
);
SELECT is(
  (SELECT refunded_at FROM public.orders WHERE id = '00000000-0000-0000-0000-000000000001'),
  '2026-01-05T00:00:00Z'::timestamptz,
  'the duplicate call does not overwrite the original refunded_at (CAS predicate excludes it)'
);

-- An order that was never paid cannot be refunded.
SELECT results_eq(
  $$ SELECT did_transition FROM app.refund_order(
       '00000000-0000-0000-0000-000000000002'::uuid, now()
     ) $$,
  $$ VALUES (false) $$,
  'refund_order on a still-pending order does not transition'
);

-- Unknown order id.
SELECT results_eq(
  $$ SELECT did_transition, revoked_enrollment_id FROM app.refund_order(
       '99999999-9999-9999-9999-999999999999'::uuid, now()
     ) $$,
  $$ VALUES (false, NULL::uuid) $$,
  'refund_order on a nonexistent order_id returns did_transition=false, not an error'
);

-- Paid order, but no active enrollment exists to revoke: order still
-- transitions, revoked_enrollment_id is NULL.
SELECT results_eq(
  $$ SELECT did_transition, revoked_enrollment_id FROM app.refund_order(
       '00000000-0000-0000-0000-000000000003'::uuid, now()
     ) $$,
  $$ VALUES (true, NULL::uuid) $$,
  'refund_order on a paid order with no active enrollment still transitions the order, revoked_enrollment_id is NULL'
);
SELECT is(
  (SELECT status FROM public.orders WHERE id = '00000000-0000-0000-0000-000000000003'),
  'refunded',
  'the order without a matching enrollment is still marked refunded'
);

-- Re-enrollment after refund: the partial unique index on enrollments (A6)
-- does not block a fresh active enrollment for the same (user, course).
INSERT INTO public.enrollments (user_id, course_id, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a', 'active');
SELECT is(
  (SELECT count(*)::int FROM public.enrollments WHERE user_id = '11111111-1111-1111-1111-111111111111' AND course_id = 'c0000000-0000-0000-0000-00000000000a' AND status = 'active'),
  1,
  'the refunded user can re-enroll in the same course'
);
RESET ROLE;

-- End-to-end: app.has_active_enrollment reflects the refund immediately
-- for a user who has NOT re-enrolled.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT ok(
  NOT app.has_active_enrollment('c0000000-0000-0000-0000-00000000000a'::uuid),
  'app.has_active_enrollment is false for user B immediately after their refund (no re-enrollment)'
);
RESET ROLE;

-- Grant surface: service_role only.
SELECT ok(
  has_function_privilege('service_role', 'app.refund_order(uuid, timestamptz)', 'EXECUTE'),
  'service_role has EXECUTE on refund_order'
);
SELECT ok(
  NOT has_function_privilege('anon', 'app.refund_order(uuid, timestamptz)', 'EXECUTE'),
  'anon has NO EXECUTE on refund_order'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'app.refund_order(uuid, timestamptz)', 'EXECUTE'),
  'authenticated has NO EXECUTE on refund_order (no self-service refunds)'
);

-- Sanity: fixture counts, unaffected by the above.
SELECT is(
  (SELECT count(*)::int FROM public.orders WHERE id IN (
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003'
  )),
  3,
  'sanity: three order fixtures exist'
);
SELECT is(
  (SELECT count(*)::int FROM public.enrollments WHERE user_id IN (
    '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'
  )),
  2,
  'sanity: two enrollment rows exist total (one refunded, one re-enrolled active)'
);

SELECT * FROM finish();
ROLLBACK;
