-- A3 -- app_private.user_roles (default-deny, zero policies) + app.is_admin().
BEGIN;
SELECT plan(19);

SELECT has_table('app_private', 'user_roles', 'app_private.user_roles exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'app_private.user_roles'::regclass),
  'RLS is enabled on app_private.user_roles'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'app_private' AND tablename = 'user_roles'),
  0,
  'app_private.user_roles has zero RLS policies (default deny even for the owning user)'
);

-- Fixtures.
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'plain-user@example.com');

-- anon: fully denied.
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT count(*) FROM app_private.user_roles $$,
  NULL, NULL,
  'anon SELECT on app_private.user_roles is denied'
);
SELECT throws_ok(
  $$ INSERT INTO app_private.user_roles (user_id, role) VALUES ('11111111-1111-1111-1111-111111111111', 'admin') $$,
  NULL, NULL,
  'anon INSERT on app_private.user_roles is denied'
);
SELECT throws_ok(
  $$ UPDATE app_private.user_roles SET role = 'admin' $$,
  NULL, NULL,
  'anon UPDATE on app_private.user_roles is denied'
);
SELECT throws_ok(
  $$ DELETE FROM app_private.user_roles $$,
  NULL, NULL,
  'anon DELETE on app_private.user_roles is denied'
);
RESET ROLE;

-- authenticated (even the row's own user_id): fully denied -- zero
-- policies means RLS blocks even the owner, this is not a per-owner table.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT throws_ok(
  $$ SELECT count(*) FROM app_private.user_roles $$,
  NULL, NULL,
  'authenticated SELECT on app_private.user_roles is denied, even for the user''s own grants'
);
SELECT throws_ok(
  $$ INSERT INTO app_private.user_roles (user_id, role) VALUES (auth.uid(), 'admin') $$,
  NULL, NULL,
  'authenticated INSERT on app_private.user_roles is denied (no self-granted admin)'
);
SELECT throws_ok(
  $$ UPDATE app_private.user_roles SET role = 'admin' $$,
  NULL, NULL,
  'authenticated UPDATE on app_private.user_roles is denied'
);
SELECT throws_ok(
  $$ DELETE FROM app_private.user_roles $$,
  NULL, NULL,
  'authenticated DELETE on app_private.user_roles is denied'
);

-- app.is_admin(): false with no grant, true once service_role inserts one.
SELECT ok(NOT app.is_admin(), 'app.is_admin() is false for a user with no role grant');
RESET ROLE;

SET LOCAL ROLE service_role;
INSERT INTO app_private.user_roles (user_id, role) VALUES ('11111111-1111-1111-1111-111111111111', 'admin');
SELECT is(
  (SELECT count(*)::int FROM app_private.user_roles),
  1,
  'service_role can INSERT into app_private.user_roles'
);
INSERT INTO app_private.user_roles (user_id, role) VALUES ('22222222-2222-2222-2222-222222222222', 'admin');
UPDATE app_private.user_roles SET granted_at = now() WHERE user_id = '22222222-2222-2222-2222-222222222222';
SELECT is(
  (SELECT count(*)::int FROM app_private.user_roles WHERE user_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'service_role can UPDATE app_private.user_roles'
);
DELETE FROM app_private.user_roles WHERE user_id = '22222222-2222-2222-2222-222222222222';
SELECT is(
  (SELECT count(*)::int FROM app_private.user_roles WHERE user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'service_role can DELETE from app_private.user_roles'
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
