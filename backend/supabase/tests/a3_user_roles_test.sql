-- A3 -- app_private.user_access (formerly user_roles; default-deny, zero
-- policies) + app.is_admin(). Reshaped by A18; role/is_active semantics and
-- the rest of A18 are covered in a18_user_access_test.sql.
BEGIN;
SELECT plan(19);

SELECT has_table('app_private', 'user_access', 'app_private.user_access exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'app_private.user_access'::regclass),
  'RLS is enabled on app_private.user_access'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'app_private' AND tablename = 'user_access'),
  0,
  'app_private.user_access has zero RLS policies (default deny even for the owning user)'
);

-- Fixtures.
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'plain-user@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'to-delete@example.com');

-- anon: fully denied.
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT count(*) FROM app_private.user_access $$,
  NULL, NULL,
  'anon SELECT on app_private.user_access is denied'
);
SELECT throws_ok(
  $$ INSERT INTO app_private.user_access (user_id, role) VALUES (gen_random_uuid(), 'admin') $$,
  NULL, NULL,
  'anon INSERT on app_private.user_access is denied'
);
SELECT throws_ok(
  $$ UPDATE app_private.user_access SET role = 'admin' $$,
  NULL, NULL,
  'anon UPDATE on app_private.user_access is denied'
);
SELECT throws_ok(
  $$ DELETE FROM app_private.user_access $$,
  NULL, NULL,
  'anon DELETE on app_private.user_access is denied'
);
RESET ROLE;

-- authenticated (even the row's own user_id): fully denied -- zero
-- policies means RLS blocks even the owner, this is not a per-owner table.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT throws_ok(
  $$ SELECT count(*) FROM app_private.user_access $$,
  NULL, NULL,
  'authenticated SELECT on app_private.user_access is denied, even for the user''s own grants'
);
SELECT throws_ok(
  $$ INSERT INTO app_private.user_access (user_id, role) VALUES (gen_random_uuid(), 'admin') $$,
  NULL, NULL,
  'authenticated INSERT on app_private.user_access is denied (no self-granted admin)'
);
SELECT throws_ok(
  $$ UPDATE app_private.user_access SET role = 'admin' $$,
  NULL, NULL,
  'authenticated UPDATE on app_private.user_access is denied'
);
SELECT throws_ok(
  $$ DELETE FROM app_private.user_access $$,
  NULL, NULL,
  'authenticated DELETE on app_private.user_access is denied'
);

-- app.is_admin(): false with no grant, true once service_role inserts one.
SELECT ok(NOT app.is_admin(), 'app.is_admin() is false for a user with no role grant');
RESET ROLE;

SET LOCAL ROLE service_role;
-- handle_new_user (A18) already created a student row per fixture user.
SELECT is(
  (SELECT count(*)::int FROM app_private.user_access),
  3,
  'service_role can SELECT app_private.user_access (one student row per fixture user)'
);
UPDATE app_private.user_access SET role = 'admin' WHERE user_id = '11111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT role FROM app_private.user_access WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  'admin',
  'service_role can UPDATE app_private.user_access'
);
DELETE FROM app_private.user_access WHERE user_id = '33333333-3333-3333-3333-333333333333';
SELECT is(
  (SELECT count(*)::int FROM app_private.user_access WHERE user_id = '33333333-3333-3333-3333-333333333333'),
  0,
  'service_role can DELETE from app_private.user_access'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT ok(app.is_admin(), 'app.is_admin() is true after service_role grants the admin role');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT ok(NOT app.is_admin(), 'app.is_admin() is false for a different, non-admin user');
RESET ROLE;

-- Grant surface: authenticated can call it (schema app USAGE from A1 +
-- explicit EXECUTE grant); anon cannot (no USAGE on schema app at all).
SELECT ok(
  has_function_privilege('authenticated', 'app.is_admin()', 'EXECUTE'),
  'authenticated has EXECUTE on app.is_admin()'
);
SELECT ok(
  NOT has_function_privilege('anon', 'app.is_admin()', 'EXECUTE'),
  'anon has NO EXECUTE on app.is_admin()'
);

SELECT * FROM finish();
ROLLBACK;
