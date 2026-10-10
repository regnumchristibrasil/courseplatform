-- A28 -- app.is_staff() e app.staff_list_courses(): listagem de todos os
-- cursos (qualquer status) para a equipe ativa (tutor, admin, superadmin).
-- Contrato de erro: SQLSTATE 42501 + message 'forbidden' (codigo estavel).
BEGIN;
SELECT plan(23);

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'superadmin@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'admin@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'tutor@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'student@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'inactivetutor@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'buyer1@example.com'),
  ('77777777-7777-7777-7777-777777777777', 'buyer2@example.com');

UPDATE app_private.user_access SET role = 'superadmin' WHERE user_id = '11111111-1111-1111-1111-111111111111';
UPDATE app_private.user_access SET role = 'admin' WHERE user_id = '22222222-2222-2222-2222-222222222222';
UPDATE app_private.user_access SET role = 'tutor' WHERE user_id IN ('33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555');
UPDATE app_private.user_access SET is_active = false WHERE user_id = '55555555-5555-5555-5555-555555555555';

INSERT INTO public.courses (id, title, price_cents, status, access_duration_days, created_at) VALUES
  ('c0000000-0000-0000-0000-0000000000d1', 'Draft D', 10000, 'draft', NULL, '2026-01-01 00:00:00+00'),
  ('c0000000-0000-0000-0000-0000000000b1', 'Published P', 20000, 'published', 365, '2026-01-02 00:00:00+00'),
  ('c0000000-0000-0000-0000-0000000000a1', 'Archived A', 30000, 'archived', NULL, '2026-01-03 00:00:00+00');

-- P: 1 matricula valida, 1 expirada, 1 reembolsada; 1 pedido pendente
-- valido, 1 pendente vencido, 1 pago.
INSERT INTO public.enrollments (user_id, course_id, status, expires_at) VALUES
  ('66666666-6666-6666-6666-666666666666', 'c0000000-0000-0000-0000-0000000000b1', 'active', now() + interval '30 days'),
  ('44444444-4444-4444-4444-444444444444', 'c0000000-0000-0000-0000-0000000000b1', 'active', now() - interval '1 day'),
  ('77777777-7777-7777-7777-777777777777', 'c0000000-0000-0000-0000-0000000000b1', 'refunded', NULL);
INSERT INTO public.orders (user_id, course_id, amount_cents, provider, status, expires_at) VALUES
  ('66666666-6666-6666-6666-666666666666', 'c0000000-0000-0000-0000-0000000000b1', 20000, 'efi', 'paid', NULL),
  ('77777777-7777-7777-7777-777777777777', 'c0000000-0000-0000-0000-0000000000b1', 20000, 'efi', 'pending', now() + interval '10 minutes'),
  ('44444444-4444-4444-4444-444444444444', 'c0000000-0000-0000-0000-0000000000b1', 20000, 'efi', 'pending', now() - interval '1 minute');

-- Shape ---------------------------------------------------------------
SELECT has_function('app', 'is_staff', ARRAY[]::text[], 'app.is_staff exists');
SELECT has_function('app', 'staff_list_courses', ARRAY[]::text[], 'app.staff_list_courses exists');
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'app.staff_list_courses()'::regprocedure),
  'staff_list_courses is SECURITY DEFINER'
);
SELECT ok(
  (SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'app.staff_list_courses()'::regprocedure),
  'staff_list_courses pins search_path to empty'
);
SELECT ok(has_function_privilege('authenticated', 'app.staff_list_courses()', 'EXECUTE'), 'authenticated can EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'app.staff_list_courses()', 'EXECUTE'), 'anon cannot EXECUTE');
SELECT ok(NOT has_function_privilege('public', 'app.staff_list_courses()', 'EXECUTE'), 'PUBLIC cannot EXECUTE');

-- Authorization -------------------------------------------------------
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT * FROM app.staff_list_courses() $$, '42501', NULL, 'anon denied by grants');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT throws_ok($$ SELECT * FROM app.staff_list_courses() $$, '42501', 'forbidden', 'student gets forbidden');
SET LOCAL "request.jwt.claim.sub" = '55555555-5555-5555-5555-555555555555';
SELECT throws_ok($$ SELECT * FROM app.staff_list_courses() $$, '42501', 'forbidden', 'inactive tutor gets forbidden');
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000000';
SELECT throws_ok($$ SELECT * FROM app.staff_list_courses() $$, '42501', 'forbidden', 'unknown uid gets forbidden');
SET LOCAL "request.jwt.claim.sub" = '';
SELECT throws_ok($$ SELECT * FROM app.staff_list_courses() $$, '42501', 'forbidden', 'authenticated without sub gets forbidden');

-- is_staff per role ---------------------------------------------------
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT is(app.is_staff(), true, 'active tutor is staff');
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT is(app.is_staff(), true, 'active admin is staff');
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is(app.is_staff(), true, 'active superadmin is staff');
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT is(app.is_staff(), false, 'student is not staff');
SET LOCAL "request.jwt.claim.sub" = '55555555-5555-5555-5555-555555555555';
SELECT is(app.is_staff(), false, 'inactive tutor is not staff');

-- Listing -------------------------------------------------------------
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT is((SELECT count(*) FROM app.staff_list_courses() WHERE id::text LIKE 'c0000000-%'), 3::bigint, 'tutor sees courses of every status');
SELECT results_eq(
  $$ SELECT id FROM app.staff_list_courses() WHERE id::text LIKE 'c0000000-%' $$,
  $$ VALUES ('c0000000-0000-0000-0000-0000000000a1'::uuid),
            ('c0000000-0000-0000-0000-0000000000b1'::uuid),
            ('c0000000-0000-0000-0000-0000000000d1'::uuid) $$,
  'ordered by created_at desc'
);
SELECT results_eq(
  $$ SELECT status, price_cents, access_duration_days, enrollment_count, pending_order_count
     FROM app.staff_list_courses() WHERE id = 'c0000000-0000-0000-0000-0000000000b1' $$,
  $$ VALUES ('published'::text, 20000, 365, 1::bigint, 1::bigint) $$,
  'counts only unexpired active enrollments and unexpired pending orders'
);
SELECT results_eq(
  $$ SELECT enrollment_count, pending_order_count
     FROM app.staff_list_courses() WHERE id = 'c0000000-0000-0000-0000-0000000000d1' $$,
  $$ VALUES (0::bigint, 0::bigint) $$,
  'course without sales has zero counts'
);
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT is((SELECT count(*) FROM app.staff_list_courses() WHERE id::text LIKE 'c0000000-%'), 3::bigint, 'admin sees all courses');
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*) FROM app.staff_list_courses() WHERE id::text LIKE 'c0000000-%'), 3::bigint, 'superadmin sees all courses');

SELECT * FROM finish();
ROLLBACK;
