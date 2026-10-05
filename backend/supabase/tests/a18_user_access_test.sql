-- A18 -- app_private.user_access (single role per user + is_active),
-- append-only audit table, handle_new_user student row, backfill,
-- app.is_admin() redefinition and app.current_access().
BEGIN;
SELECT plan(57);

-- Shape.
SELECT has_table('app_private', 'user_access', 'app_private.user_access exists');
SELECT hasnt_table('app_private', 'user_roles', 'app_private.user_roles was reshaped away');
SELECT has_column('app_private', 'user_access', 'role', 'user_access.role exists');
SELECT has_column('app_private', 'user_access', 'is_active', 'user_access.is_active exists');
SELECT has_column('app_private', 'user_access', 'created_at', 'user_access.created_at exists');
SELECT has_column('app_private', 'user_access', 'updated_at', 'user_access.updated_at exists');
SELECT col_is_pk('app_private', 'user_access', 'user_id', 'user_id is the sole primary key (single role per user)');
SELECT col_default_is('app_private', 'user_access', 'is_active', 'true', 'is_active defaults to true');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'app_private.user_access'::regclass),
  'RLS enabled on app_private.user_access'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'app_private' AND tablename = 'user_access'),
  0,
  'app_private.user_access has zero RLS policies'
);

-- Fixtures: auth inserts fire handle_new_user.
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'superadmin@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'admin@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'tutor@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'student@example.com');

-- handle_new_user inserts an active student row.
SELECT is(
  (SELECT role FROM app_private.user_access WHERE user_id = '44444444-4444-4444-4444-444444444444'),
  'student',
  'handle_new_user creates a student row for a new auth user'
);
SELECT ok(
  (SELECT is_active FROM app_private.user_access WHERE user_id = '44444444-4444-4444-4444-444444444444'),
  'handle_new_user row is active'
);
SELECT is(
  (SELECT count(*)::int FROM public.users WHERE id = '44444444-4444-4444-4444-444444444444'),
  1,
  'handle_new_user still populates public.users'
);

-- Role CHECK.
SELECT throws_ok(
  $$ UPDATE app_private.user_access SET role = 'owner' WHERE user_id = '44444444-4444-4444-4444-444444444444' $$,
  '23514', NULL,
  'role CHECK rejects values outside superadmin/admin/tutor/student'
);

-- Denied for client roles.
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT count(*) FROM app_private.user_access $$, NULL, NULL, 'anon SELECT denied');
SELECT throws_ok($$ INSERT INTO app_private.user_access (user_id, role) VALUES (gen_random_uuid(), 'student') $$, NULL, NULL, 'anon INSERT denied');
SELECT throws_ok($$ UPDATE app_private.user_access SET role = 'admin' $$, NULL, NULL, 'anon UPDATE denied');
SELECT throws_ok($$ DELETE FROM app_private.user_access $$, NULL, NULL, 'anon DELETE denied');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT throws_ok($$ SELECT count(*) FROM app_private.user_access $$, NULL, NULL, 'authenticated SELECT denied, even own row');
SELECT throws_ok($$ INSERT INTO app_private.user_access (user_id, role) VALUES (gen_random_uuid(), 'student') $$, NULL, NULL, 'authenticated INSERT denied');
SELECT throws_ok($$ UPDATE app_private.user_access SET role = 'superadmin' $$, NULL, NULL, 'authenticated UPDATE denied (no self-promotion)');
SELECT throws_ok($$ DELETE FROM app_private.user_access $$, NULL, NULL, 'authenticated DELETE denied');
SELECT is(
  (SELECT role FROM app.current_access()),
  'student',
  'app.current_access() returns own role'
);
RESET ROLE;

-- service_role can write; updated_at moves on UPDATE.
SET LOCAL ROLE service_role;
UPDATE app_private.user_access SET role = 'superadmin' WHERE user_id = '11111111-1111-1111-1111-111111111111';
UPDATE app_private.user_access SET role = 'admin' WHERE user_id = '22222222-2222-2222-2222-222222222222';
UPDATE app_private.user_access SET role = 'tutor' WHERE user_id = '33333333-3333-3333-3333-333333333333';
SELECT is(
  (SELECT role FROM app_private.user_access WHERE user_id = '22222222-2222-2222-2222-222222222222'),
  'admin',
  'service_role can UPDATE app_private.user_access'
);
RESET ROLE;

UPDATE app_private.user_access SET updated_at = '2000-01-01' WHERE user_id = '44444444-4444-4444-4444-444444444444';
UPDATE app_private.user_access SET is_active = false WHERE user_id = '44444444-4444-4444-4444-444444444444';
SELECT ok(
  (SELECT updated_at > '2000-01-02' FROM app_private.user_access WHERE user_id = '44444444-4444-4444-4444-444444444444'),
  'updated_at is refreshed on UPDATE'
);
UPDATE app_private.user_access SET is_active = true WHERE user_id = '44444444-4444-4444-4444-444444444444';

-- Backfill: idempotent, adds student rows only for users missing one.
DELETE FROM app_private.user_access WHERE user_id = '44444444-4444-4444-4444-444444444444';
SELECT app_private.backfill_user_access();
SELECT is(
  (SELECT role FROM app_private.user_access WHERE user_id = '44444444-4444-4444-4444-444444444444'),
  'student',
  'backfill adds a student row for an auth user missing one'
);
SELECT is(
  (SELECT role FROM app_private.user_access WHERE user_id = '22222222-2222-2222-2222-222222222222'),
  'admin',
  'backfill never overwrites an existing role'
);
CREATE TEMP TABLE _before AS SELECT user_id, role, is_active FROM app_private.user_access;
SELECT app_private.backfill_user_access();
SELECT is(
  (SELECT count(*)::int FROM (
    (SELECT * FROM _before EXCEPT SELECT user_id, role, is_active FROM app_private.user_access)
    UNION ALL
    (SELECT user_id, role, is_active FROM app_private.user_access EXCEPT SELECT * FROM _before)
  ) d),
  0,
  'backfill is idempotent (second run changes nothing)'
);
SELECT is(
  (SELECT count(*)::int FROM auth.users u WHERE NOT EXISTS (SELECT 1 FROM app_private.user_access a WHERE a.user_id = u.id)),
  0,
  'every auth user has an access row after backfill'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'app_private.backfill_user_access()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'app_private.backfill_user_access()', 'EXECUTE'),
  'backfill function is not callable by client roles'
);

-- app.is_admin(): active admin/superadmin only.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT ok(app.is_admin(), 'is_admin true for active superadmin');
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT ok(app.is_admin(), 'is_admin true for active admin');
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT ok(NOT app.is_admin(), 'is_admin false for tutor');
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT ok(NOT app.is_admin(), 'is_admin false for student');
SET LOCAL "request.jwt.claim.sub" = '99999999-9999-9999-9999-999999999999';
SELECT ok(NOT app.is_admin(), 'is_admin false for unknown user');
RESET ROLE;

UPDATE app_private.user_access SET is_active = false WHERE user_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT ok(NOT app.is_admin(), 'is_admin false for inactive superadmin');
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT ok(NOT app.is_admin(), 'is_admin false for inactive admin');
SELECT ok(
  (SELECT NOT is_active AND role = 'admin' FROM app.current_access()),
  'current_access reports role and is_active=false for inactive admin'
);
SELECT is((SELECT count(*)::int FROM app.current_access()), 1, 'current_access returns only the caller row');
SET LOCAL "request.jwt.claim.sub" = '99999999-9999-9999-9999-999999999999';
SELECT is((SELECT count(*)::int FROM app.current_access()), 0, 'current_access returns no row for a user without access');
RESET ROLE;

SELECT ok(
  has_function_privilege('authenticated', 'app.is_admin()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'app.current_access()', 'EXECUTE'),
  'authenticated can EXECUTE is_admin and current_access'
);
SELECT ok(
  NOT has_function_privilege('anon', 'app.is_admin()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'app.current_access()', 'EXECUTE'),
  'anon cannot EXECUTE is_admin or current_access'
);
SELECT ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'app.current_access()'::regprocedure),
  'current_access is SECURITY DEFINER with fixed empty search_path'
);
SELECT ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'app.is_admin()'::regprocedure),
  'is_admin is SECURITY DEFINER with fixed empty search_path'
);

-- Audit table: append-only.
SELECT has_table('app_private', 'user_access_audit', 'audit table exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'app_private.user_access_audit'::regclass),
  'RLS enabled on audit table'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'app_private' AND tablename = 'user_access_audit'),
  0,
  'audit table has zero RLS policies'
);
SELECT is(
  (SELECT coalesce(array_agg(privilege_type::text ORDER BY privilege_type), ARRAY[]::text[]) FROM information_schema.role_table_grants WHERE table_schema = 'app_private' AND table_name = 'user_access_audit' AND grantee IN ('anon', 'authenticated')),
  ARRAY[]::text[],
  'audit table: no client grants'
);
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'app_private' AND table_name = 'user_access_audit' AND grantee = 'service_role'),
  ARRAY['INSERT', 'SELECT'],
  'audit table: service_role has INSERT and SELECT only'
);

SET LOCAL ROLE service_role;
INSERT INTO app_private.user_access_audit (actor_id, target_id, action, old_value, new_value, reason)
VALUES ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'role_changed', 'student', 'tutor', repeat('x', 500));
SELECT is((SELECT count(*)::int FROM app_private.user_access_audit), 1, 'service_role can INSERT an audit row (reason of 500 chars)');
SELECT throws_ok(
  $$ INSERT INTO app_private.user_access_audit (actor_id, target_id, action, reason)
     VALUES ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'role_changed', repeat('x', 501)) $$,
  '23514', NULL,
  'reason longer than 500 chars is rejected'
);
SELECT throws_ok($$ UPDATE app_private.user_access_audit SET reason = 'tamper' $$, NULL, NULL, 'service_role UPDATE on audit is denied');
SELECT throws_ok($$ DELETE FROM app_private.user_access_audit $$, NULL, NULL, 'service_role DELETE on audit is denied');
RESET ROLE;

-- Trigger blocks even the table owner / superuser.
SELECT throws_ok($$ UPDATE app_private.user_access_audit SET reason = 'tamper' $$, 'P0001', 'user_access_audit is append-only', 'trigger blocks UPDATE for owner');
SELECT throws_ok($$ DELETE FROM app_private.user_access_audit $$, 'P0001', 'user_access_audit is append-only', 'trigger blocks DELETE for owner');
SELECT throws_ok($$ TRUNCATE app_private.user_access_audit $$, 'P0001', 'user_access_audit is append-only', 'trigger blocks TRUNCATE for owner');
SELECT is((SELECT count(*)::int FROM app_private.user_access_audit), 1, 'audit row survived tamper attempts');

SELECT * FROM finish();
ROLLBACK;
