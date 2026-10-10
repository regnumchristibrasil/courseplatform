-- A30 -- app.staff_create_course / app.staff_update_course, course audit
-- append-only, price/status database checks (ticket #16).
BEGIN;
SELECT plan(46);

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'superadmin@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'admin@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'tutor@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'student@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'inactiveadmin@example.com');

UPDATE app_private.user_access SET role = 'superadmin' WHERE user_id = '11111111-1111-1111-1111-111111111111';
UPDATE app_private.user_access SET role = 'admin' WHERE user_id IN ('22222222-2222-2222-2222-222222222222', '55555555-5555-5555-5555-555555555555');
UPDATE app_private.user_access SET role = 'tutor' WHERE user_id = '33333333-3333-3333-3333-333333333333';
UPDATE app_private.user_access SET is_active = false WHERE user_id = '55555555-5555-5555-5555-555555555555';

INSERT INTO public.courses (id, title, description, price_cents, status, access_duration_days) VALUES
  ('c0000000-0000-0000-0000-0000000000d1', 'Draft D', 'desc', 10000, 'draft', 30),
  ('c0000000-0000-0000-0000-0000000000b1', 'Published P', NULL, 20000, 'published', NULL);

-- RLS hides drafts from authenticated: read through a postgres-owned view.
CREATE TEMP VIEW _cv AS SELECT * FROM public.courses;
GRANT SELECT ON _cv TO authenticated;
CREATE TEMP TABLE _ts AS SELECT updated_at AS ts FROM public.courses WHERE id = 'c0000000-0000-0000-0000-0000000000d1';
GRANT SELECT ON _ts TO authenticated;

-- Shape ---------------------------------------------------------------
SELECT has_function('app', 'staff_create_course', ARRAY['text', 'text', 'integer', 'integer'], 'staff_create_course exists');
SELECT has_function('app', 'staff_update_course', ARRAY['uuid', 'timestamp with time zone', 'text', 'text', 'integer', 'integer'], 'staff_update_course exists');
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'app.staff_update_course(uuid, timestamptz, text, text, integer, integer)'::regprocedure),
  'staff_update_course is SECURITY DEFINER'
);
SELECT ok(NOT has_function_privilege('anon', 'app.staff_create_course(text, text, integer, integer)', 'EXECUTE'), 'anon cannot create');
SELECT ok(NOT has_function_privilege('public', 'app.staff_update_course(uuid, timestamptz, text, text, integer, integer)', 'EXECUTE'), 'PUBLIC cannot update');
SELECT ok(has_function_privilege('authenticated', 'app.staff_update_course(uuid, timestamptz, text, text, integer, integer)', 'EXECUTE'), 'authenticated can update');

-- Database checks (independent of the RPCs) --------------------------------
SELECT lives_ok(
  $$ INSERT INTO public.courses (title, price_cents, status) VALUES ('No price draft', NULL, 'draft') $$,
  'draft may have no price'
);
SELECT throws_ok(
  $$ INSERT INTO public.courses (title, price_cents, status) VALUES ('Free pub', NULL, 'published') $$,
  '23514', NULL, 'published requires a price'
);
SELECT throws_ok(
  $$ INSERT INTO public.courses (title, price_cents, status) VALUES ('Zero pub', 0, 'published') $$,
  '23514', NULL, 'published requires price greater than zero'
);
SELECT throws_ok(
  $$ INSERT INTO public.courses (title, price_cents, status) VALUES ('Too pricey', 10000001, 'draft') $$,
  '23514', NULL, 'price above R$ 100.000,00 is rejected'
);
SELECT lives_ok(
  $$ INSERT INTO public.courses (title, price_cents, status) VALUES ('Max price', 10000000, 'draft') $$,
  'price of exactly R$ 100.000,00 is accepted'
);

-- Authorization on create ---------------------------------------------
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT * FROM app.staff_create_course('T', NULL, NULL, NULL) $$, '42501', NULL, 'anon denied by grants');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT throws_ok($$ SELECT * FROM app.staff_create_course('T', NULL, NULL, NULL) $$, '42501', 'forbidden', 'student cannot create');
SET LOCAL "request.jwt.claim.sub" = '55555555-5555-5555-5555-555555555555';
SELECT throws_ok($$ SELECT * FROM app.staff_create_course('T', NULL, NULL, NULL) $$, '42501', 'forbidden', 'inactive admin cannot create');

-- Create as tutor ----------------------------------------------------------
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT lives_ok($$ SELECT * FROM app.staff_create_course('Tutor draft', 'about', NULL, NULL) $$, 'tutor creates a draft with no price');
SELECT throws_ok($$ SELECT * FROM app.staff_create_course('T', NULL, 5000, NULL) $$, '42501', 'forbidden', 'tutor cannot set price on create');
SELECT throws_ok($$ SELECT * FROM app.staff_create_course('T', NULL, NULL, 30) $$, '42501', 'forbidden', 'tutor cannot set duration on create');
SELECT throws_ok($$ SELECT * FROM app.staff_create_course('   ', NULL, NULL, NULL) $$, '22023', 'invalid_input', 'blank title is invalid');
SELECT throws_ok($$ SELECT * FROM app.staff_create_course(E'\t\n', NULL, NULL, NULL) $$, '22023', 'invalid_input', 'tab/newline-only title is invalid');
SELECT throws_ok($$ SELECT * FROM app.staff_create_course(repeat('x', 201), NULL, NULL, NULL) $$, '22023', 'invalid_input', 'title above 200 chars is invalid');

-- Create as admin -------------------------------------------------------------
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT lives_ok($$ SELECT * FROM app.staff_create_course('  Admin draft  ', NULL, 9900, 90) $$, 'admin creates with price and duration');
SELECT is(
  (SELECT status || '/' || price_cents || '/' || access_duration_days FROM _cv WHERE title LIKE '%Admin draft%'),
  'draft/9900/90', 'created course is always a draft with the given price and duration'
);
SELECT is(
  (SELECT title FROM _cv WHERE title LIKE '%Admin draft%'), 'Admin draft', 'title is trimmed'
) ;
SELECT throws_ok($$ SELECT * FROM app.staff_create_course('T', NULL, 0, NULL) $$, '22023', 'invalid_input', 'price zero is invalid');
SELECT throws_ok($$ SELECT * FROM app.staff_create_course('T', NULL, 10000001, NULL) $$, '22023', 'invalid_input', 'price above limit is invalid');
SELECT throws_ok($$ SELECT * FROM app.staff_create_course('T', NULL, NULL, 0) $$, '22023', 'invalid_input', 'duration zero is invalid');

-- Update: authorization -------------------------------------------------------------
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT throws_ok(
  format($$ SELECT * FROM app.staff_update_course('c0000000-0000-0000-0000-0000000000d1', %L, 'X', NULL, 10000, 30) $$, now()),
  '42501', 'forbidden', 'student cannot update'
);
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT throws_ok(
  format($$ SELECT * FROM app.staff_update_course('c0000000-0000-0000-0000-0000000000ff', %L, 'X', NULL, 10000, 30) $$, now()),
  'P0002', 'not_found', 'unknown course is not_found for staff'
);

-- Update as tutor: content ok, commercial fields frozen -------------------------
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT lives_ok(
  $$ SELECT * FROM app.staff_update_course('c0000000-0000-0000-0000-0000000000d1', (SELECT ts FROM _ts), 'Draft D2', 'new desc', 10000, 30) $$,
  'tutor edits title/description with unchanged price and duration'
);
SELECT is((SELECT title FROM _cv WHERE id = 'c0000000-0000-0000-0000-0000000000d1'), 'Draft D2', 'title updated');
SELECT throws_ok(
  $$ SELECT * FROM app.staff_update_course('c0000000-0000-0000-0000-0000000000d1', (SELECT updated_at FROM _cv WHERE id = 'c0000000-0000-0000-0000-0000000000d1'), 'Draft D2', 'new desc', 99999, 30) $$,
  '42501', 'forbidden', 'tutor cannot change price'
);
SELECT throws_ok(
  $$ SELECT * FROM app.staff_update_course('c0000000-0000-0000-0000-0000000000d1', (SELECT updated_at FROM _cv WHERE id = 'c0000000-0000-0000-0000-0000000000d1'), 'Draft D2', 'new desc', 10000, 60) $$,
  '42501', 'forbidden', 'tutor cannot change duration'
);
SELECT is((SELECT price_cents FROM _cv WHERE id = 'c0000000-0000-0000-0000-0000000000d1'), 10000, 'price untouched after tutor attempt');

-- Update as admin: price + duration, audit rows ----------------------------------
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT results_eq(
  $$ SELECT price_changed, access_duration_changed, previous_price_cents, previous_access_duration_days
       FROM app.staff_update_course('c0000000-0000-0000-0000-0000000000d1', (SELECT updated_at FROM _cv WHERE id = 'c0000000-0000-0000-0000-0000000000d1'), 'Draft D2', 'new desc', 15000, NULL) $$,
  $$ VALUES (true, true, 10000, 30) $$,
  'admin changes price and duration; result reports what changed'
);
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM app_private.course_audit WHERE course_id = 'c0000000-0000-0000-0000-0000000000d1'),
  2::bigint, 'one audit row per sensitive field changed'
);
SELECT results_eq(
  $$ SELECT action, old_value, new_value, actor_id::text FROM app_private.course_audit
      WHERE course_id = 'c0000000-0000-0000-0000-0000000000d1' ORDER BY action $$,
  $$ VALUES ('access_duration_changed', '30', NULL, '22222222-2222-2222-2222-222222222222'),
            ('price_changed', '10000', '15000', '22222222-2222-2222-2222-222222222222') $$,
  'audit rows carry actor and before/after'
);
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';

-- Update: stale, no-op, published invariants ----------------------------------------------
SELECT throws_ok(
  $$ SELECT * FROM app.staff_update_course('c0000000-0000-0000-0000-0000000000d1', now() - interval '1 second', 'Stale', NULL, 15000, NULL) $$,
  'CR001', 'stale_target', 'stale expected_updated_at returns a conflict'
);
SELECT is((SELECT title FROM _cv WHERE id = 'c0000000-0000-0000-0000-0000000000d1'), 'Draft D2', 'stale edit changed nothing');
SELECT results_eq(
  $$ SELECT price_changed, access_duration_changed
       FROM app.staff_update_course('c0000000-0000-0000-0000-0000000000d1', (SELECT updated_at FROM _cv WHERE id = 'c0000000-0000-0000-0000-0000000000d1'), 'Draft D2', 'new desc', 15000, NULL) $$,
  $$ VALUES (false, false) $$,
  'identical values are a no-op'
);
RESET ROLE;
SELECT is((SELECT count(*) FROM app_private.course_audit WHERE course_id = 'c0000000-0000-0000-0000-0000000000d1'), 2::bigint, 'no-op writes no audit');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT throws_ok(
  $$ SELECT * FROM app.staff_update_course('c0000000-0000-0000-0000-0000000000b1', (SELECT updated_at FROM _cv WHERE id = 'c0000000-0000-0000-0000-0000000000b1'), 'Published P', NULL, NULL, NULL) $$,
  '22023', 'invalid_input', 'published course cannot lose its price'
);
SELECT throws_ok(
  $$ SELECT * FROM app.staff_update_course('c0000000-0000-0000-0000-0000000000b1', (SELECT updated_at FROM _cv WHERE id = 'c0000000-0000-0000-0000-0000000000b1'), '', NULL, 20000, NULL) $$,
  '22023', 'invalid_input', 'update validates title'
);

-- Audit is append-only (even for the table owner) -------------------------------------------
RESET ROLE;
SELECT throws_ok($$ UPDATE app_private.course_audit SET new_value = 'x' $$, 'P0001', 'course_audit is append-only', 'audit rows cannot be updated');
SELECT throws_ok($$ DELETE FROM app_private.course_audit $$, 'P0001', 'course_audit is append-only', 'audit rows cannot be deleted');
SELECT throws_ok($$ TRUNCATE app_private.course_audit $$, 'P0001', 'course_audit is append-only', 'audit cannot be truncated');
SELECT ok(NOT has_table_privilege('authenticated', 'app_private.course_audit', 'SELECT'), 'authenticated cannot read the audit');

SELECT * FROM finish();
ROLLBACK;
