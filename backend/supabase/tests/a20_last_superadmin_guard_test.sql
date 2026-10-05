-- A20 -- I2 guard: DEFERRED CONSTRAINT TRIGGER on app_private.user_access
-- (nunca ficar sem superadmin ativo) + bloqueio de TRUNCATE.
-- Assume banco limpo (sem o seed de desenvolvimento): exatamente um
-- superadmin ativo e criado aqui.
BEGIN;
SELECT plan(18);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'sa1@example.com', '{}'),
  ('22222222-2222-2222-2222-222222222222', 'sa2@example.com', '{}'),
  ('33333333-3333-3333-3333-333333333333', 'adm@example.com', '{}'),
  ('44444444-4444-4444-4444-444444444444', 'stu@example.com', '{}');

-- Fresh-DB behaviour: with ZERO superadmins nothing trips.
UPDATE app_private.user_access SET role = 'admin' WHERE user_id = '33333333-3333-3333-3333-333333333333';

-- Runs the statements in a subtransaction that is always rolled back.
-- p_immediate = true forces the deferred check (SET CONSTRAINTS ALL
-- IMMEDIATE) the way COMMIT would. Returns 'ok' or '<sqlstate>:<message>'.
CREATE FUNCTION pg_temp.try_sql(p_stmts text[], p_immediate boolean) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_result text := 'ok';
  v_stmt text;
BEGIN
  BEGIN
    FOREACH v_stmt IN ARRAY p_stmts LOOP
      EXECUTE v_stmt;
    END LOOP;
    IF p_immediate THEN
      SET CONSTRAINTS ALL IMMEDIATE;
    END IF;
    RAISE EXCEPTION 'test_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'test_rollback' THEN
      v_result := SQLSTATE || ':' || SQLERRM;
    END IF;
  END;
  RETURN v_result;
END;
$$;

SELECT is(
  pg_temp.try_sql(ARRAY[
    $$ UPDATE app_private.user_access SET role = 'student' WHERE user_id = '33333333-3333-3333-3333-333333333333' $$,
    $$ DELETE FROM app_private.user_access WHERE user_id = '33333333-3333-3333-3333-333333333333' $$
  ], true),
  'ok', 'zero superadmins (fresh DB): demote/delete of non-superadmins never trips the guard'
);

-- Exactly one active superadmin from here on.
UPDATE app_private.user_access SET role = 'superadmin' WHERE user_id = '11111111-1111-1111-1111-111111111111';

SELECT ok(
  (SELECT count(*) = 2 FROM pg_trigger
    WHERE tgrelid = 'app_private.user_access'::regclass AND tgconstraint <> 0
      AND tgdeferrable AND tginitdeferred),
  'two DEFERRABLE INITIALLY DEFERRED constraint triggers (UPDATE and DELETE) on user_access'
);
SELECT is_empty(
  $$ SELECT tgname FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgrelid IN ('app_private.user_access'::regclass, 'app_private.user_access_audit'::regclass)
        AND tgname ~ '(last_superadmin|audit_block)'
        AND tgenabled <> 'A' $$,
  'guard and audit-block triggers are ENABLE ALWAYS (also fire under session_replication_role=replica)'
);

SELECT is(
  pg_temp.try_sql(ARRAY[$$ DELETE FROM app_private.user_access WHERE user_id = '11111111-1111-1111-1111-111111111111' $$], false),
  'ok', 'deferred: the DELETE statement itself succeeds, the check runs at commit'
);
SELECT is(
  pg_temp.try_sql(ARRAY[$$ DELETE FROM app_private.user_access WHERE user_id = '11111111-1111-1111-1111-111111111111' $$], true),
  'AD004:last_superadmin', 'deleting the sole active superadmin fails at commit'
);
SELECT is(
  pg_temp.try_sql(ARRAY[$$ UPDATE app_private.user_access SET role = 'admin' WHERE user_id = '11111111-1111-1111-1111-111111111111' $$], true),
  'AD004:last_superadmin', 'demoting the sole active superadmin fails at commit'
);
SELECT is(
  pg_temp.try_sql(ARRAY[$$ UPDATE app_private.user_access SET is_active = false WHERE user_id = '11111111-1111-1111-1111-111111111111' $$], true),
  'AD004:last_superadmin', 'deactivating the sole active superadmin fails at commit'
);
SELECT is(
  pg_temp.try_sql(ARRAY[$$ DELETE FROM auth.users WHERE id = '11111111-1111-1111-1111-111111111111' $$], true),
  'AD004:last_superadmin', 'cascade delete from auth.users of the sole superadmin is blocked'
);
SELECT is(
  pg_temp.try_sql(ARRAY[$$ DELETE FROM app_private.user_access WHERE user_id = '44444444-4444-4444-4444-444444444444' $$], true),
  'ok', 'deleting a non-superadmin is fine'
);
SELECT is(
  pg_temp.try_sql(ARRAY[$$ UPDATE app_private.user_access SET is_active = false WHERE user_id = '33333333-3333-3333-3333-333333333333' $$], true),
  'ok', 'deactivating a non-superadmin is fine'
);

-- TRUNCATE is refused while an active superadmin exists (not deferred). Runs
-- before this transaction queues deferred events (TRUNCATE refuses pending ones).
SELECT is(
  pg_temp.try_sql(ARRAY[$$ TRUNCATE app_private.user_access $$], false),
  'AD004:last_superadmin', 'TRUNCATE app_private.user_access is refused while a superadmin exists'
);
SELECT is(
  pg_temp.try_sql(ARRAY[$$ TRUNCATE auth.users CASCADE $$], false),
  'AD004:last_superadmin', 'TRUNCATE auth.users CASCADE is refused through the cascade'
);

-- Two active superadmins.
UPDATE app_private.user_access SET role = 'superadmin' WHERE user_id = '22222222-2222-2222-2222-222222222222';
SELECT is(
  pg_temp.try_sql(ARRAY[$$ DELETE FROM app_private.user_access WHERE user_id = '22222222-2222-2222-2222-222222222222' $$], true),
  'ok', 'with two active superadmins, deleting one is fine'
);
SELECT is(
  pg_temp.try_sql(ARRAY[
    $$ UPDATE app_private.user_access SET role = 'admin' WHERE user_id = '11111111-1111-1111-1111-111111111111' $$,
    $$ UPDATE app_private.user_access SET is_active = false WHERE user_id = '22222222-2222-2222-2222-222222222222' $$
  ], true),
  'AD004:last_superadmin', 'demoting one and deactivating the other in one transaction leaves none: blocked'
);

-- Successor promoted and old one removed in ONE transaction.
UPDATE app_private.user_access SET role = 'student' WHERE user_id = '22222222-2222-2222-2222-222222222222';
SELECT is(
  pg_temp.try_sql(ARRAY[
    $$ UPDATE app_private.user_access SET role = 'superadmin' WHERE user_id = '22222222-2222-2222-2222-222222222222' $$,
    $$ DELETE FROM app_private.user_access WHERE user_id = '11111111-1111-1111-1111-111111111111' $$
  ], true),
  'ok', 'promoting a successor then deleting the old superadmin in one transaction is fine'
);
SELECT is(
  pg_temp.try_sql(ARRAY[
    $$ DELETE FROM app_private.user_access WHERE user_id = '11111111-1111-1111-1111-111111111111' $$,
    $$ UPDATE app_private.user_access SET role = 'superadmin' WHERE user_id = '22222222-2222-2222-2222-222222222222' $$
  ], true),
  'ok', 'order inside the transaction does not matter (checked at commit against final state)'
);

-- Single predicate shared by the RPC dead-code branches and the trigger.
SELECT ok(
  NOT has_function_privilege('authenticated', 'app_private.assert_not_last_superadmin(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'app_private.assert_not_last_superadmin(uuid)', 'EXECUTE'),
  'assert_not_last_superadmin is not callable by client roles'
);
SELECT throws_ok(
  $$ SELECT app_private.assert_not_last_superadmin('11111111-1111-1111-1111-111111111111') $$,
  'AD004', 'last_superadmin', 'assert_not_last_superadmin(target) raises when no OTHER active superadmin exists'
);

SELECT * FROM finish();
ROLLBACK;
