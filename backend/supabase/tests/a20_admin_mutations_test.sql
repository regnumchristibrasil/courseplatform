-- A20 -- app.admin_set_user_role() / app.admin_set_user_active().
-- Error contract: message = stable AdminUsersErrorCode, SQLSTATE per code:
--   forbidden 42501, invalid_input 22023, not_found P0002,
--   self_target AD001, actor_inactive AD002, stale_target AD003,
--   last_superadmin AD004.
-- The expected permission matrix is GENERATED from PERMISSION_MATRIX in
-- backend/contracts/adminUsers.ts (deno task gen:matrix rewrites the block
-- between the GENERATED markers; a Deno test fails if it is stale).
BEGIN;
SELECT plan(71);

-- Fixtures. Actors: 1111 superadmin, 2222 admin, 3333 tutor, 4444 student.
-- Targets: 5555 superadmin, 6666 admin, 7777 tutor, 8888 student.
-- 9999 inactive admin, aaaa inactive superadmin.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'a-sa@example.com', '{}'),
  ('22222222-2222-2222-2222-222222222222', 'a-admin@example.com', '{}'),
  ('33333333-3333-3333-3333-333333333333', 'a-tutor@example.com', '{}'),
  ('44444444-4444-4444-4444-444444444444', 'a-student@example.com', '{}'),
  ('55555555-5555-5555-5555-555555555555', 't-sa@example.com', '{}'),
  ('66666666-6666-6666-6666-666666666666', 't-admin@example.com', '{}'),
  ('77777777-7777-7777-7777-777777777777', 't-tutor@example.com', '{}'),
  ('88888888-8888-8888-8888-888888888888', 't-student@example.com', '{}'),
  ('99999999-9999-9999-9999-999999999999', 'inactive-admin@example.com', '{}'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'inactive-sa@example.com', '{}');

UPDATE app_private.user_access SET role = 'superadmin'
  WHERE user_id IN ('11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
UPDATE app_private.user_access SET role = 'admin'
  WHERE user_id IN ('22222222-2222-2222-2222-222222222222', '66666666-6666-6666-6666-666666666666', '99999999-9999-9999-9999-999999999999');
UPDATE app_private.user_access SET role = 'tutor'
  WHERE user_id IN ('33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777');
UPDATE app_private.user_access SET is_active = false
  WHERE user_id IN ('99999999-9999-9999-9999-999999999999', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Helper: runs one call as the given actor inside a subtransaction that is
-- always rolled back; returns '<code or ok>:<audit rows seen>'.
CREATE FUNCTION pg_temp.try_call(
  p_actor uuid, p_action text, p_target uuid,
  p_role text, p_expected_role text, p_active boolean, p_expected_active boolean
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_result text;
  v_audit int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_actor::text, true);
  BEGIN
    IF p_action = 'set_role' THEN
      PERFORM * FROM app.admin_set_user_role(p_target, p_role, p_expected_role, NULL);
    ELSE
      PERFORM * FROM app.admin_set_user_active(p_target, p_active, p_expected_active, NULL);
    END IF;
    SELECT count(*) INTO v_audit FROM app_private.user_access_audit;
    v_result := 'ok:' || v_audit;
    RAISE EXCEPTION 'test_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'test_rollback' THEN
      SELECT count(*) INTO v_audit FROM app_private.user_access_audit;
      v_result := SQLERRM || ':' || v_audit;
    END IF;
  END;
  RETURN v_result;
END;
$$;

-- Shape: grants, definer, search_path.
SELECT has_function('app', 'admin_set_user_role', ARRAY['uuid', 'text', 'text', 'text'], 'admin_set_user_role exists');
SELECT has_function('app', 'admin_set_user_active', ARRAY['uuid', 'boolean', 'boolean', 'text'], 'admin_set_user_active exists');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'app.admin_set_user_role(uuid,text,text,text)'::regprocedure), 'set_user_role is SECURITY DEFINER');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'app.admin_set_user_active(uuid,boolean,boolean,text)'::regprocedure), 'set_user_active is SECURITY DEFINER');
SELECT ok((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'app.admin_set_user_role(uuid,text,text,text)'::regprocedure), 'set_user_role pins search_path');
SELECT ok((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'app.admin_set_user_active(uuid,boolean,boolean,text)'::regprocedure), 'set_user_active pins search_path');
SELECT ok(has_function_privilege('authenticated', 'app.admin_set_user_role(uuid,text,text,text)', 'EXECUTE'), 'authenticated can EXECUTE set_user_role');
SELECT ok(has_function_privilege('authenticated', 'app.admin_set_user_active(uuid,boolean,boolean,text)', 'EXECUTE'), 'authenticated can EXECUTE set_user_active');
SELECT ok(NOT has_function_privilege('anon', 'app.admin_set_user_role(uuid,text,text,text)', 'EXECUTE'), 'anon cannot EXECUTE set_user_role');
SELECT ok(NOT has_function_privilege('anon', 'app.admin_set_user_active(uuid,boolean,boolean,text)', 'EXECUTE'), 'anon cannot EXECUTE set_user_active');
SELECT ok(NOT has_function_privilege('public', 'app.admin_set_user_role(uuid,text,text,text)', 'EXECUTE'), 'PUBLIC cannot EXECUTE set_user_role');
SELECT ok(NOT has_function_privilege('public', 'app.admin_set_user_active(uuid,boolean,boolean,text)', 'EXECUTE'), 'PUBLIC cannot EXECUTE set_user_active');

-- Anon denied by grants.
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_role('88888888-8888-8888-8888-888888888888', 'tutor', 'student', NULL) $$, '42501', NULL, 'anon denied (role)');
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_active('88888888-8888-8888-8888-888888888888', false, true, NULL) $$, '42501', NULL, 'anon denied (active)');
RESET ROLE;

-- Permission matrix: actor role x target role x action (x new role).
-- Expected rows come from the contract (generated block below); this file
-- only maps roles to the fixture users.
-- BEGIN GENERATED permission_matrix (deno task gen:matrix)
CREATE TEMP TABLE matrix_expected (
  actor text, target text, action text, new_role text, allowed boolean
);
INSERT INTO matrix_expected VALUES
  ('superadmin', 'superadmin', 'set_active', NULL, true),
  ('superadmin', 'superadmin', 'set_role', 'superadmin', true),
  ('superadmin', 'superadmin', 'set_role', 'admin', true),
  ('superadmin', 'superadmin', 'set_role', 'tutor', true),
  ('superadmin', 'superadmin', 'set_role', 'student', true),
  ('superadmin', 'admin', 'set_active', NULL, true),
  ('superadmin', 'admin', 'set_role', 'superadmin', true),
  ('superadmin', 'admin', 'set_role', 'admin', true),
  ('superadmin', 'admin', 'set_role', 'tutor', true),
  ('superadmin', 'admin', 'set_role', 'student', true),
  ('superadmin', 'tutor', 'set_active', NULL, true),
  ('superadmin', 'tutor', 'set_role', 'superadmin', true),
  ('superadmin', 'tutor', 'set_role', 'admin', true),
  ('superadmin', 'tutor', 'set_role', 'tutor', true),
  ('superadmin', 'tutor', 'set_role', 'student', true),
  ('superadmin', 'student', 'set_active', NULL, true),
  ('superadmin', 'student', 'set_role', 'superadmin', true),
  ('superadmin', 'student', 'set_role', 'admin', true),
  ('superadmin', 'student', 'set_role', 'tutor', true),
  ('superadmin', 'student', 'set_role', 'student', true),
  ('admin', 'superadmin', 'set_active', NULL, false),
  ('admin', 'superadmin', 'set_role', 'superadmin', false),
  ('admin', 'superadmin', 'set_role', 'admin', false),
  ('admin', 'superadmin', 'set_role', 'tutor', false),
  ('admin', 'superadmin', 'set_role', 'student', false),
  ('admin', 'admin', 'set_active', NULL, false),
  ('admin', 'admin', 'set_role', 'superadmin', false),
  ('admin', 'admin', 'set_role', 'admin', false),
  ('admin', 'admin', 'set_role', 'tutor', false),
  ('admin', 'admin', 'set_role', 'student', false),
  ('admin', 'tutor', 'set_active', NULL, true),
  ('admin', 'tutor', 'set_role', 'superadmin', false),
  ('admin', 'tutor', 'set_role', 'admin', false),
  ('admin', 'tutor', 'set_role', 'tutor', true),
  ('admin', 'tutor', 'set_role', 'student', true),
  ('admin', 'student', 'set_active', NULL, true),
  ('admin', 'student', 'set_role', 'superadmin', false),
  ('admin', 'student', 'set_role', 'admin', false),
  ('admin', 'student', 'set_role', 'tutor', true),
  ('admin', 'student', 'set_role', 'student', true),
  ('tutor', 'superadmin', 'set_active', NULL, false),
  ('tutor', 'superadmin', 'set_role', 'superadmin', false),
  ('tutor', 'superadmin', 'set_role', 'admin', false),
  ('tutor', 'superadmin', 'set_role', 'tutor', false),
  ('tutor', 'superadmin', 'set_role', 'student', false),
  ('tutor', 'admin', 'set_active', NULL, false),
  ('tutor', 'admin', 'set_role', 'superadmin', false),
  ('tutor', 'admin', 'set_role', 'admin', false),
  ('tutor', 'admin', 'set_role', 'tutor', false),
  ('tutor', 'admin', 'set_role', 'student', false),
  ('tutor', 'tutor', 'set_active', NULL, false),
  ('tutor', 'tutor', 'set_role', 'superadmin', false),
  ('tutor', 'tutor', 'set_role', 'admin', false),
  ('tutor', 'tutor', 'set_role', 'tutor', false),
  ('tutor', 'tutor', 'set_role', 'student', false),
  ('tutor', 'student', 'set_active', NULL, false),
  ('tutor', 'student', 'set_role', 'superadmin', false),
  ('tutor', 'student', 'set_role', 'admin', false),
  ('tutor', 'student', 'set_role', 'tutor', false),
  ('tutor', 'student', 'set_role', 'student', false),
  ('student', 'superadmin', 'set_active', NULL, false),
  ('student', 'superadmin', 'set_role', 'superadmin', false),
  ('student', 'superadmin', 'set_role', 'admin', false),
  ('student', 'superadmin', 'set_role', 'tutor', false),
  ('student', 'superadmin', 'set_role', 'student', false),
  ('student', 'admin', 'set_active', NULL, false),
  ('student', 'admin', 'set_role', 'superadmin', false),
  ('student', 'admin', 'set_role', 'admin', false),
  ('student', 'admin', 'set_role', 'tutor', false),
  ('student', 'admin', 'set_role', 'student', false),
  ('student', 'tutor', 'set_active', NULL, false),
  ('student', 'tutor', 'set_role', 'superadmin', false),
  ('student', 'tutor', 'set_role', 'admin', false),
  ('student', 'tutor', 'set_role', 'tutor', false),
  ('student', 'tutor', 'set_role', 'student', false),
  ('student', 'student', 'set_active', NULL, false),
  ('student', 'student', 'set_role', 'superadmin', false),
  ('student', 'student', 'set_role', 'admin', false),
  ('student', 'student', 'set_role', 'tutor', false),
  ('student', 'student', 'set_role', 'student', false);
-- END GENERATED permission_matrix
CREATE TEMP TABLE matrix AS
WITH actors(role, id) AS (VALUES
  ('superadmin', '11111111-1111-1111-1111-111111111111'::uuid),
  ('admin', '22222222-2222-2222-2222-222222222222'),
  ('tutor', '33333333-3333-3333-3333-333333333333'),
  ('student', '44444444-4444-4444-4444-444444444444')),
targets(role, id) AS (VALUES
  ('superadmin', '55555555-5555-5555-5555-555555555555'::uuid),
  ('admin', '66666666-6666-6666-6666-666666666666'),
  ('tutor', '77777777-7777-7777-7777-777777777777'),
  ('student', '88888888-8888-8888-8888-888888888888'))
SELECT e.actor, a.id AS actor_id, e.target, t.id AS target_id, e.action, e.new_role, e.allowed
FROM matrix_expected e
JOIN actors a ON a.role = e.actor
JOIN targets t ON t.role = e.target;

SELECT is((SELECT count(*)::int FROM matrix), 80, 'matrix has 4 x 4 x (4 roles + 1 active) = 80 rows');
SELECT is_empty(
  $$ SELECT actor, target, action, new_role, allowed, got FROM (
       SELECT m.*, pg_temp.try_call(m.actor_id, m.action, m.target_id, m.new_role, m.target, false, true) AS got
       FROM matrix m) x
     WHERE got IS DISTINCT FROM CASE
       WHEN allowed THEN 'ok:' || CASE WHEN action = 'set_role' AND new_role = target THEN 0 ELSE 1 END
       ELSE 'forbidden:0' END $$,
  'every matrix row matches expectation (allowed -> ok + audit row unless no-op; denied -> forbidden + no audit)'
);

-- Self-target for every role and both actions.
SELECT is_empty(
  $$ SELECT r.role, a.action, got FROM (VALUES
       ('superadmin', '11111111-1111-1111-1111-111111111111'::uuid),
       ('admin', '22222222-2222-2222-2222-222222222222'),
       ('tutor', '33333333-3333-3333-3333-333333333333'),
       ('student', '44444444-4444-4444-4444-444444444444')) r(role, id)
     CROSS JOIN (VALUES ('set_role'), ('set_active')) a(action)
     CROSS JOIN LATERAL (SELECT pg_temp.try_call(r.id, a.action, r.id, 'student', r.role, false, true) AS got) g
     WHERE got IS DISTINCT FROM 'self_target:0' $$,
  'self-target rejected for all roles and both actions, no audit'
);
SELECT is(
  pg_temp.try_call('11111111-1111-1111-1111-111111111111', 'set_role', '11111111-1111-1111-1111-111111111111', 'superadmin', 'superadmin', NULL, NULL),
  'self_target:0', 'superadmin self no-op still self_target'
);

-- Actor state.
SELECT set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_role('88888888-8888-8888-8888-888888888888', 'tutor', 'student', NULL) $$, 'AD002', 'actor_inactive', 'inactive admin: actor_inactive (role)');
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_active('88888888-8888-8888-8888-888888888888', false, true, NULL) $$, 'AD002', 'actor_inactive', 'inactive admin: actor_inactive (active)');
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_role('88888888-8888-8888-8888-888888888888', 'tutor', 'student', NULL) $$, 'AD002', 'actor_inactive', 'inactive superadmin: actor_inactive (role)');
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_active('88888888-8888-8888-8888-888888888888', false, true, NULL) $$, 'AD002', 'actor_inactive', 'inactive superadmin: actor_inactive (active)');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_role('88888888-8888-8888-8888-888888888888', 'tutor', 'student', NULL) $$, '42501', 'forbidden', 'unknown actor: forbidden (role)');
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_active('88888888-8888-8888-8888-888888888888', false, true, NULL) $$, '42501', 'forbidden', 'unknown actor: forbidden (active)');
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_role('88888888-8888-8888-8888-888888888888', 'tutor', 'student', NULL) $$, '42501', 'forbidden', 'no sub: forbidden');

-- Unknown target; non-admins must not learn target existence.
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_role('00000000-0000-0000-0000-0000000000ff', 'tutor', 'student', NULL) $$, 'P0002', 'not_found', 'unknown target: not_found (role)');
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_active('00000000-0000-0000-0000-0000000000ff', false, true, NULL) $$, 'P0002', 'not_found', 'unknown target: not_found (active)');
SELECT set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_role('00000000-0000-0000-0000-0000000000ff', 'tutor', 'student', NULL) $$, '42501', 'forbidden', 'student + unknown target: forbidden, no existence leak');

-- Invalid input (as superadmin).
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_role('88888888-8888-8888-8888-888888888888', 'root', 'student', NULL) $$, '22023', 'invalid_input', 'invalid new role');
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_role('88888888-8888-8888-8888-888888888888', NULL, 'student', NULL) $$, '22023', 'invalid_input', 'null new role');
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_role('88888888-8888-8888-8888-888888888888', 'tutor', 'root', NULL) $$, '22023', 'invalid_input', 'invalid expected role');
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_role('88888888-8888-8888-8888-888888888888', 'tutor', NULL, NULL) $$, '22023', 'invalid_input', 'null expected role');
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_role(NULL, 'tutor', 'student', NULL) $$, '22023', 'invalid_input', 'null target (role)');
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_role('88888888-8888-8888-8888-888888888888', 'tutor', 'student', repeat('x', 501)) $$, '22023', 'invalid_input', 'reason > 500 (role)');
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_active('88888888-8888-8888-8888-888888888888', NULL, true, NULL) $$, '22023', 'invalid_input', 'null active');
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_active('88888888-8888-8888-8888-888888888888', false, NULL, NULL) $$, '22023', 'invalid_input', 'null expected active');
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_active(NULL, false, true, NULL) $$, '22023', 'invalid_input', 'null target (active)');
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_active('88888888-8888-8888-8888-888888888888', false, true, repeat('x', 501)) $$, '22023', 'invalid_input', 'reason > 500 (active)');

-- Stale target (I6).
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_role('88888888-8888-8888-8888-888888888888', 'tutor', 'admin', NULL) $$, 'AD003', 'stale_target', 'stale expected role');
SELECT throws_ok($$ SELECT * FROM app.admin_set_user_active('88888888-8888-8888-8888-888888888888', false, false, NULL) $$, 'AD003', 'stale_target', 'stale expected active');

-- Zero audit rows after every failure above.
SELECT is((SELECT count(*)::int FROM app_private.user_access_audit), 0, 'no audit rows after any failure');

-- Success path: admin promotes student -> tutor with reason.
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
SELECT results_eq(
  $$ SELECT user_id, role FROM app.admin_set_user_role('88888888-8888-8888-8888-888888888888', 'tutor', 'student', 'promotion') $$,
  $$ VALUES ('88888888-8888-8888-8888-888888888888'::uuid, 'tutor'::text) $$,
  'set_user_role returns user_id and new role'
);
SELECT results_eq(
  $$ SELECT actor_id, target_id, action, old_value, new_value, reason FROM app_private.user_access_audit $$,
  $$ VALUES ('22222222-2222-2222-2222-222222222222'::uuid, '88888888-8888-8888-8888-888888888888'::uuid, 'role_changed', 'student', 'tutor', 'promotion') $$,
  'role change audited: actor, target, action, old/new, reason'
);
SELECT is((SELECT role FROM app_private.user_access WHERE user_id = '88888888-8888-8888-8888-888888888888'), 'tutor', 'role persisted');

-- No-op role change: row returned, no new audit row, updated_at untouched.
SELECT is(
  (SELECT updated_at FROM app.admin_set_user_role('88888888-8888-8888-8888-888888888888', 'tutor', 'tutor', 'again')),
  (SELECT updated_at FROM app_private.user_access WHERE user_id = '88888888-8888-8888-8888-888888888888'),
  'no-op role returns current updated_at'
);
SELECT is((SELECT count(*)::int FROM app_private.user_access_audit), 1, 'no-op role writes no audit row');

-- Active change, reason NULL, then no-op.
SELECT results_eq(
  $$ SELECT user_id, is_active FROM app.admin_set_user_active('88888888-8888-8888-8888-888888888888', false, true, NULL) $$,
  $$ VALUES ('88888888-8888-8888-8888-888888888888'::uuid, false) $$,
  'set_user_active returns user_id and new status'
);
SELECT results_eq(
  $$ SELECT action, old_value, new_value, reason FROM app_private.user_access_audit WHERE action = 'active_changed' $$,
  $$ VALUES ('active_changed', 'true', 'false', NULL::text) $$,
  'active change audited with text old/new and null reason'
);
SELECT results_eq(
  $$ SELECT is_active FROM app.admin_set_user_active('88888888-8888-8888-8888-888888888888', false, false, NULL) $$,
  $$ VALUES (false) $$,
  'no-op active returns row, no error'
);
SELECT is((SELECT count(*)::int FROM app_private.user_access_audit), 2, 'no-op active writes no audit row');

-- Reason of exactly 500 chars is accepted and stored.
SELECT lives_ok(
  $$ SELECT * FROM app.admin_set_user_active('88888888-8888-8888-8888-888888888888', true, false, repeat('r', 500)) $$,
  'reason of 500 chars accepted'
);
SELECT is((SELECT char_length(reason) FROM app_private.user_access_audit ORDER BY id DESC LIMIT 1), 500, '500-char reason stored');

-- Superadmin acts on a peer superadmin (second active superadmin exists).
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
SELECT lives_ok(
  $$ SELECT * FROM app.admin_set_user_active('55555555-5555-5555-5555-555555555555', false, true, 'peer') $$,
  'superadmin deactivates peer superadmin while another stays active'
);
SELECT lives_ok(
  $$ SELECT * FROM app.admin_set_user_active('55555555-5555-5555-5555-555555555555', true, false, NULL) $$,
  'superadmin reactivates peer'
);
SELECT lives_ok(
  $$ SELECT * FROM app.admin_set_user_role('55555555-5555-5555-5555-555555555555', 'admin', 'superadmin', 'peer demote') $$,
  'superadmin demotes peer superadmin'
);

-- I2 (see migration header): through the RPCs the last-superadmin guard is
-- unreachable because the actor is itself an active superadmin distinct from
-- the target. What is observable: an inactive superadmin cannot act, and an
-- admin cannot touch the sole active superadmin.
UPDATE app_private.user_access SET role = 'superadmin' WHERE user_id = '55555555-5555-5555-5555-555555555555';
UPDATE app_private.user_access SET is_active = false WHERE user_id = '55555555-5555-5555-5555-555555555555';
SELECT is(
  pg_temp.try_call('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'set_active', '11111111-1111-1111-1111-111111111111', NULL, NULL, false, true),
  'actor_inactive:6', 'inactive superadmin cannot act on the sole active superadmin'
);
SELECT is(
  pg_temp.try_call('22222222-2222-2222-2222-222222222222', 'set_active', '11111111-1111-1111-1111-111111111111', NULL, NULL, false, true),
  'forbidden:6', 'admin cannot deactivate the sole active superadmin'
);

-- Audit vocabulary constraint.
SELECT throws_ok(
  $$ INSERT INTO app_private.user_access_audit (actor_id, target_id, action) VALUES (gen_random_uuid(), gen_random_uuid(), 'bogus') $$,
  '23514', NULL, 'audit action restricted to role_changed / active_changed'
);
SELECT lives_ok(
  $$ INSERT INTO app_private.user_access_audit (actor_id, target_id, action, old_value, new_value)
     VALUES (gen_random_uuid(), gen_random_uuid(), 'role_changed', 'a', 'b') $$,
  'role_changed is an allowed audit action'
);

-- H1: no-op (current == requested) is idempotent and precedes stale_target,
-- so a retry after a committed change + failed Auth sync is never stale.
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
SELECT results_eq(
  $$ SELECT role FROM app.admin_set_user_role('77777777-7777-7777-7777-777777777777', 'student', 'tutor', 'h1') $$,
  $$ VALUES ('student'::text) $$,
  'H1 role: first change applied'
);
SELECT results_eq(
  $$ SELECT role FROM app.admin_set_user_role('77777777-7777-7777-7777-777777777777', 'student', 'tutor', 'h1') $$,
  $$ VALUES ('student'::text) $$,
  'H1 role: identical retry (expected = pre-change value) returns the row, not stale_target'
);
SELECT results_eq(
  $$ SELECT role FROM app.admin_set_user_role('77777777-7777-7777-7777-777777777777', 'student', 'student', 'h1') $$,
  $$ VALUES ('student'::text) $$,
  'H1 role: retry with expected = target value also returns the row'
);
SELECT is(
  (SELECT count(*)::int FROM app_private.user_access_audit
    WHERE target_id = '77777777-7777-7777-7777-777777777777' AND action = 'role_changed'),
  1, 'H1 role: retries write no extra audit row'
);
SELECT throws_ok(
  $$ SELECT * FROM app.admin_set_user_role('77777777-7777-7777-7777-777777777777', 'admin', 'tutor', NULL) $$,
  'AD003', 'stale_target', 'H1 role: genuinely stale (current != target and != expected) still raises'
);
SELECT results_eq(
  $$ SELECT is_active FROM app.admin_set_user_active('77777777-7777-7777-7777-777777777777', false, true, 'h1') $$,
  $$ VALUES (false) $$,
  'H1 active: first change applied'
);
SELECT results_eq(
  $$ SELECT is_active FROM app.admin_set_user_active('77777777-7777-7777-7777-777777777777', false, true, 'h1') $$,
  $$ VALUES (false) $$,
  'H1 active: identical retry (expected = pre-change value) returns the row, not stale_target'
);
SELECT is(
  (SELECT count(*)::int FROM app_private.user_access_audit
    WHERE target_id = '77777777-7777-7777-7777-777777777777' AND action = 'active_changed'),
  1, 'H1 active: retry writes no extra audit row'
);
SELECT throws_ok(
  $$ SELECT * FROM app.admin_set_user_active('77777777-7777-7777-7777-777777777777', true, true, NULL) $$,
  'AD003', 'stale_target', 'H1 active: genuinely stale still raises'
);

-- M-lock: one shared advisory-lock key, taken only after the cheap unlocked
-- actor pre-check (a student never reaches the global lock).
SELECT ok(
  NOT has_function_privilege('authenticated', 'app_private.user_access_lock()', 'EXECUTE'),
  'M-lock: user_access_lock() is not executable by clients'
);
SELECT ok(
  (SELECT strpos(prosrc, 'user_access_lock()') > strpos(prosrc, 'forbidden')
     FROM pg_proc WHERE oid = 'app_private.lock_and_check_target(uuid,boolean,text,text,boolean,boolean,text)'::regprocedure),
  'M-lock: the lock call appears only after the unlocked forbidden/actor_inactive pre-check'
);
SELECT ok(
  (SELECT count(*) = 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()),
  'M-lock: the successful admin calls above hold exactly the one shared advisory lock'
);

SELECT * FROM finish();
ROLLBACK;
