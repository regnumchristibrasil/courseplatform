-- A20 -- runbook do primeiro superadmin (runbooks/bootstrap_superadmin.sql).
-- O bloco abaixo e IDENTICO ao do runbook (um teste Deno compara os dois).
BEGIN;
SELECT plan(21);

CREATE TEMP TABLE bootstrap_sql AS SELECT $sqlblock$
-- BEGIN BOOTSTRAP BLOCK
do $bootstrap$
declare
  v_email text := lower(btrim(coalesce(current_setting('bootstrap.email', true), '')));
  v_user_id_text text := btrim(coalesce(current_setting('bootstrap.user_id', true), ''));
  v_user_id uuid;
  v_count integer;
begin
  if v_email = '' or v_email = lower('COLOQUE_O_EMAIL_AQUI') then
    raise exception using errcode = '22023', message = 'bootstrap.email nao informado';
  end if;

  if v_user_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023',
      message = 'bootstrap.user_id nao informado ou invalido (informe o uuid conferido fora de banda)';
  end if;
  v_user_id := v_user_id_text::uuid;

  with target as (
    select ua.user_id, ua.role as old_role
    from app_private.user_access ua
    join auth.users u on u.id = ua.user_id
    where lower(u.email) = v_email
      and u.id = v_user_id
      and u.email_confirmed_at is not null
      and u.deleted_at is null
      and (u.banned_until is null or u.banned_until < now())
      and not (ua.role = 'superadmin' and ua.is_active)
    for update of ua
  ),
  promoted as (
    update app_private.user_access ua
    set role = 'superadmin', is_active = true
    from target t
    where ua.user_id = t.user_id
    returning ua.user_id, t.old_role
  ),
  audited as (
    insert into app_private.user_access_audit
      (actor_id, target_id, action, old_value, new_value, reason)
    select p.user_id, p.user_id, 'role_changed', p.old_role, 'superadmin',
           'bootstrap do primeiro superadmin'
    from promoted p
    returning 1
  )
  select count(*) into v_count from audited;

  if v_count <> 1 then
    raise exception using errcode = 'P0002',
      message = format('bootstrap: esperava 1 conta, afetou %s (causas provaveis: e-mail inexistente, user_id nao pertence a esse e-mail, e-mail NAO confirmado, conta banida, conta removida (deleted_at), e-mail ambiguo ou ja superadmin ativo)', v_count);
  end if;
end
$bootstrap$;
-- END BOOTSTRAP BLOCK
$sqlblock$::text AS stmt;

INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at, banned_until, deleted_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Boot@Example.com', '{}', now(), NULL, NULL),
  ('22222222-2222-2222-2222-222222222222', 'other@example.com', '{}', now(), NULL, NULL),
  ('33333333-3333-3333-3333-333333333333', 'unconfirmed@example.com', '{}', NULL, NULL, NULL),
  ('44444444-4444-4444-4444-444444444444', 'banned@example.com', '{}', now(), now() + interval '1 day', NULL),
  ('55555555-5555-5555-5555-555555555555', 'deleted@example.com', '{}', now(), NULL, now()),
  ('66666666-6666-6666-6666-666666666666', 'expiredban@example.com', '{}', now(), now() - interval '1 day', NULL);

SELECT set_config('bootstrap.user_id', '33333333-3333-3333-3333-333333333333', true);
SELECT set_config('bootstrap.email', 'unconfirmed@example.com', true);
SELECT throws_ok((SELECT stmt FROM bootstrap_sql), 'P0002', NULL, 'unconfirmed email is rejected');
SELECT set_config('bootstrap.user_id', '44444444-4444-4444-4444-444444444444', true);
SELECT set_config('bootstrap.email', 'banned@example.com', true);
SELECT throws_ok((SELECT stmt FROM bootstrap_sql), 'P0002', NULL, 'banned account is rejected');
SELECT set_config('bootstrap.user_id', '55555555-5555-5555-5555-555555555555', true);
SELECT set_config('bootstrap.email', 'deleted@example.com', true);
SELECT throws_ok((SELECT stmt FROM bootstrap_sql), 'P0002', NULL, 'account with deleted_at set is rejected');
SELECT is(
  (SELECT count(*)::int FROM app_private.user_access WHERE role = 'superadmin'), 0,
  'rejected candidates were not promoted'
);

SELECT set_config('bootstrap.user_id', '11111111-1111-1111-1111-111111111111', true);
SELECT set_config('bootstrap.email', 'COLOQUE_O_EMAIL_AQUI', true);
SELECT throws_ok((SELECT stmt FROM bootstrap_sql), '22023', NULL, 'placeholder email is refused');
SELECT set_config('bootstrap.email', '', true);
SELECT throws_ok((SELECT stmt FROM bootstrap_sql), '22023', NULL, 'empty email is refused');

SELECT set_config('bootstrap.user_id', '11111111-1111-1111-1111-111111111111', true);
SELECT set_config('bootstrap.email', 'nobody@example.com', true);
SELECT throws_ok((SELECT stmt FROM bootstrap_sql), 'P0002', NULL, 'unknown email fails instead of silently updating 0 rows');
SELECT is((SELECT count(*)::int FROM app_private.user_access_audit), 0, 'failure writes no audit row');

-- email certo + id errado: rejeitado, sem promocao e sem auditoria
SELECT set_config('bootstrap.email', 'boot@example.com', true);
SELECT set_config('bootstrap.user_id', '22222222-2222-2222-2222-222222222222', true);
SELECT throws_ok((SELECT stmt FROM bootstrap_sql), 'P0002', NULL, 'right email + wrong id is rejected');
SELECT is((SELECT count(*)::int FROM app_private.user_access WHERE role = 'superadmin'), 0, 'wrong id promoted nobody');
SELECT is((SELECT count(*)::int FROM app_private.user_access_audit), 0, 'wrong id wrote no audit row');

-- id certo + email errado: rejeitado
SELECT set_config('bootstrap.email', 'other@example.com', true);
SELECT set_config('bootstrap.user_id', '11111111-1111-1111-1111-111111111111', true);
SELECT throws_ok((SELECT stmt FROM bootstrap_sql), 'P0002', NULL, 'right id + wrong email is rejected');

-- id ausente, placeholder ou malformado: 22023
SELECT set_config('bootstrap.email', 'boot@example.com', true);
SELECT set_config('bootstrap.user_id', 'COLOQUE_O_USER_ID_AQUI', true);
SELECT throws_ok((SELECT stmt FROM bootstrap_sql), '22023', NULL, 'placeholder user_id is refused');
SELECT set_config('bootstrap.user_id', 'not-a-uuid', true);
SELECT throws_ok((SELECT stmt FROM bootstrap_sql), '22023', NULL, 'malformed user_id is refused');
SELECT set_config('bootstrap.user_id', '', true);
SELECT throws_ok((SELECT stmt FROM bootstrap_sql), '22023', NULL, 'empty user_id is refused');

SELECT set_config('bootstrap.user_id', '11111111-1111-1111-1111-111111111111', true);
SELECT set_config('bootstrap.email', '  BOOT@example.COM ', true);
SELECT lives_ok((SELECT stmt FROM bootstrap_sql), 'promotes by lower(trimmed email)');
SELECT results_eq(
  $$ SELECT role, is_active FROM app_private.user_access WHERE user_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ VALUES ('superadmin'::text, true) $$,
  'target is an active superadmin'
);
SELECT results_eq(
  $$ SELECT actor_id, target_id, action, old_value, new_value FROM app_private.user_access_audit $$,
  $$ VALUES ('11111111-1111-1111-1111-111111111111'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'role_changed', 'student', 'superadmin') $$,
  'audit row has the valid role_changed action, written in the same statement'
);
SELECT throws_ok((SELECT stmt FROM bootstrap_sql), 'P0002', NULL, 'rerun on an already active superadmin fails (no double audit)');
SELECT is(
  (SELECT role FROM app_private.user_access WHERE user_id = '22222222-2222-2222-2222-222222222222'),
  'student', 'other users are untouched'
);

SELECT set_config('bootstrap.user_id', '66666666-6666-6666-6666-666666666666', true);
SELECT set_config('bootstrap.email', 'expiredban@example.com', true);
SELECT lives_ok((SELECT stmt FROM bootstrap_sql), 'confirmed active account with an expired ban is promoted');

SELECT * FROM finish();
ROLLBACK;
