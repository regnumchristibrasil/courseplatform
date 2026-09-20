-- A6 -- enrollments RLS ("anon: -, owner: S (own), other user: -,
-- service_role: all") + both app.has_active_enrollment overloads.
BEGIN;
SELECT plan(30);

SELECT has_table('public', 'enrollments', 'public.enrollments exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.enrollments'::regclass),
  'RLS is enabled on public.enrollments'
);

-- Fixtures: two users, one published course (lifetime) and one published
-- course with a 30-day access window.
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'other@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'refunded-only@example.com');

INSERT INTO public.courses (id, title, price_cents, status, access_duration_days) VALUES
  ('c0000000-0000-0000-0000-00000000000a', 'Lifetime Course', 10000, 'published', NULL),
  ('c0000000-0000-0000-0000-00000000000b', 'Timed Course', 15000, 'published', 30),
  ('c0000000-0000-0000-0000-00000000000c', 'Refunded-Only Course', 12000, 'published', NULL);

INSERT INTO public.enrollments (id, user_id, course_id, status, granted_at, expires_at) VALUES
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a', 'active', now(), NULL),
  ('e0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000b', 'active', now() - interval '40 days', now() - interval '10 days'),
  ('e0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-00000000000c', 'refunded', now() - interval '5 days', NULL),
  ('e0000000-0000-0000-0000-000000000004', '33333333-3333-3333-3333-333333333333', 'c0000000-0000-0000-0000-00000000000b', 'refunded', now() - interval '5 days', NULL);

-- Partial unique index: a second ACTIVE row for the same (user, course) is
-- rejected, but user 2's refunded row does not block a fresh active
-- enrollment for the same (user, course) -- re-enrollment after refund.
SELECT throws_ok(
  $$ INSERT INTO public.enrollments (user_id, course_id, status)
     VALUES ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a', 'active') $$,
  NULL, NULL,
  'a second ACTIVE enrollment for the same (user, course) is rejected'
);
INSERT INTO public.enrollments (user_id, course_id, status) VALUES
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-00000000000c', 'active');
SELECT is(
  (SELECT count(*)::int FROM public.enrollments WHERE user_id = '22222222-2222-2222-2222-222222222222' AND course_id = 'c0000000-0000-0000-0000-00000000000c'),
  2,
  'a refunded row does not block re-enrollment for the same (user, course)'
);

-- anon: fully denied, all four operations.
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT count(*) FROM public.enrollments $$,
  NULL, NULL,
  'anon SELECT on public.enrollments is denied'
);
SELECT throws_ok(
  $$ INSERT INTO public.enrollments (user_id, course_id) VALUES ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a') $$,
  NULL, NULL,
  'anon INSERT on public.enrollments is denied'
);
SELECT throws_ok(
  $$ UPDATE public.enrollments SET status = 'refunded' $$,
  NULL, NULL,
  'anon UPDATE on public.enrollments is denied'
);
SELECT throws_ok(
  $$ DELETE FROM public.enrollments $$,
  NULL, NULL,
  'anon DELETE on public.enrollments is denied'
);
RESET ROLE;

-- owner: SELECT own rows only, no writes at all.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT count(*)::int FROM public.enrollments),
  2,
  'owner SELECT sees only their own enrollments'
);
SELECT throws_ok(
  $$ INSERT INTO public.enrollments (user_id, course_id) VALUES (auth.uid(), 'c0000000-0000-0000-0000-00000000000a') $$,
  NULL, NULL,
  'owner INSERT on public.enrollments is denied (no client-created enrollments, ever)'
);
SELECT throws_ok(
  $$ UPDATE public.enrollments SET status = 'refunded' WHERE user_id = auth.uid() $$,
  NULL, NULL,
  'owner UPDATE on public.enrollments is denied'
);
SELECT throws_ok(
  $$ DELETE FROM public.enrollments WHERE user_id = auth.uid() $$,
  NULL, NULL,
  'owner DELETE on public.enrollments is denied'
);
RESET ROLE;

-- other user: cannot see the first user's rows, and cannot write to them
-- either (no grant exists at all, so this is denied before RLS even runs).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT is(
  (SELECT count(*)::int FROM public.enrollments WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'other user cannot SELECT user A''s enrollments'
);
SELECT throws_ok(
  $$ UPDATE public.enrollments SET status = 'refunded' WHERE user_id = '11111111-1111-1111-1111-111111111111' $$,
  NULL, NULL,
  'other user cannot UPDATE user A''s enrollments (no grant, regardless of RLS row-scoping)'
);
RESET ROLE;

-- service_role: unrestricted -- proven functionally (INSERT/UPDATE/DELETE),
-- not just via SELECT count.
SET LOCAL ROLE service_role;
SELECT is(
  (SELECT count(*)::int FROM public.enrollments),
  5,
  'service_role SELECT sees every enrollment row'
);
INSERT INTO public.enrollments (id, user_id, course_id, status) VALUES
  ('e0000000-0000-0000-0000-000000000099', '33333333-3333-3333-3333-333333333333', 'c0000000-0000-0000-0000-00000000000a', 'active');
SELECT is(
  (SELECT count(*)::int FROM public.enrollments WHERE id = 'e0000000-0000-0000-0000-000000000099'),
  1,
  'service_role can INSERT an enrollment directly'
);
UPDATE public.enrollments SET status = 'refunded' WHERE id = 'e0000000-0000-0000-0000-000000000099';
SELECT is(
  (SELECT status FROM public.enrollments WHERE id = 'e0000000-0000-0000-0000-000000000099'),
  'refunded',
  'service_role can UPDATE an enrollment directly'
);
DELETE FROM public.enrollments WHERE id = 'e0000000-0000-0000-0000-000000000099';
SELECT is(
  (SELECT count(*)::int FROM public.enrollments WHERE id = 'e0000000-0000-0000-0000-000000000099'),
  0,
  'service_role can DELETE an enrollment directly'
);
RESET ROLE;

-- app.has_active_enrollment(p_user_id, p_course_id): the shared
-- implementation, service_role only.
SET LOCAL ROLE service_role;
SELECT ok(
  app.has_active_enrollment('11111111-1111-1111-1111-111111111111'::uuid, 'c0000000-0000-0000-0000-00000000000a'::uuid),
  '2-arg has_active_enrollment is true for an active, non-expired enrollment'
);
SELECT ok(
  NOT app.has_active_enrollment('11111111-1111-1111-1111-111111111111'::uuid, 'c0000000-0000-0000-0000-00000000000b'::uuid),
  '2-arg has_active_enrollment is false once expires_at is in the past'
);
SELECT ok(
  NOT app.has_active_enrollment('33333333-3333-3333-3333-333333333333'::uuid, 'c0000000-0000-0000-0000-00000000000b'::uuid),
  '2-arg has_active_enrollment is false for a status = ''refunded'' enrollment (no active row exists)'
);
RESET ROLE;

SELECT ok(
  NOT has_function_privilege('anon', 'app.has_active_enrollment(uuid, uuid)', 'EXECUTE'),
  'anon has NO EXECUTE on the 2-arg has_active_enrollment'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'app.has_active_enrollment(uuid, uuid)', 'EXECUTE'),
  'authenticated has NO EXECUTE on the 2-arg has_active_enrollment'
);
SELECT ok(
  has_function_privilege('service_role', 'app.has_active_enrollment(uuid, uuid)', 'EXECUTE'),
  'service_role has EXECUTE on the 2-arg has_active_enrollment'
);

-- app.has_active_enrollment(p_course_id): the policy-facing wrapper,
-- scoped to the caller's own auth.uid(), authenticated only.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT ok(
  app.has_active_enrollment('c0000000-0000-0000-0000-00000000000a'::uuid),
  '1-arg has_active_enrollment is true for the caller''s own active course'
);
SELECT ok(
  NOT app.has_active_enrollment('c0000000-0000-0000-0000-00000000000b'::uuid),
  '1-arg has_active_enrollment is false for the caller''s expired course'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT ok(
  NOT app.has_active_enrollment('c0000000-0000-0000-0000-00000000000b'::uuid),
  '1-arg has_active_enrollment is false for a course the caller never enrolled in'
);
RESET ROLE;

SELECT ok(
  NOT has_function_privilege('anon', 'app.has_active_enrollment(uuid)', 'EXECUTE'),
  'anon has NO EXECUTE on the 1-arg has_active_enrollment'
);
SELECT ok(
  has_function_privilege('authenticated', 'app.has_active_enrollment(uuid)', 'EXECUTE'),
  'authenticated has EXECUTE on the 1-arg has_active_enrollment'
);

-- Data integrity.
SELECT throws_ok(
  $$ INSERT INTO public.enrollments (user_id, course_id, status) VALUES ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a', 'bogus') $$,
  NULL, NULL,
  'an unrecognized enrollments.status value is rejected'
);

SELECT * FROM finish();
ROLLBACK;
