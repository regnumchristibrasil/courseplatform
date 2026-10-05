-- RUNBOOK (ambiente real): promover o PRIMEIRO superadmin.
--
-- Quando: uma unica vez, depois do deploy das migrations a18-a21 e de
-- `select app_private.backfill_user_access();`, e depois que a pessoa ja criou
-- a conta normalmente (cadastro ou convite). O trigger handle_new_user a
-- registra como student; este script a promove.
--
-- Como: edite o e-mail e o user_id nas linhas marcadas (UNICOS pontos a editar)
-- e rode tudo de uma vez com um papel dono do schema (postgres), por exemplo:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/runbooks/bootstrap_superadmin.sql
-- Tudo roda em UMA transacao: se o e-mail nao existir, nao estiver confirmado,
-- a conta estiver banida ou removida (deleted_at), o user_id nao for um uuid
-- valido ou nao pertencer a esse e-mail, for ambiguo ou a conta ja
-- for superadmin ativo, o bloco levanta excecao e NADA e gravado.
--
-- CHECKLIST DO OPERADOR (obrigatorio, ANTES do commit):
--   1. O cadastro esta aberto (enable_confirmations=false), entao qualquer
--      pessoa pode ter pre-registrado este e-mail. O script exige e-mail
--      confirmado, sem ban e sem deleted_at, mas isso NAO prova identidade.
--   2. PRIMEIRO rode o select abaixo para LER o user_id e confirmar a identidade
--      fora de banda; so depois cole os DOIS valores (e-mail e user_id):
--        select id, email, email_confirmed_at, banned_until, deleted_at, created_at
--        from auth.users where lower(email) = lower('<email>');
--      Verifique que o user_id e a conta pertencem a pessoa pretendida
--      (data de criacao e confirmacao coerentes, contato fora de banda).
--   3. So entao rode o script (o bloco exige e-mail E user_id coincidentes);
--      em caso de duvida, de ROLLBACK em vez de commit.
--
-- O ator da auditoria e o proprio alvo (bootstrap), acao 'role_changed'.
-- Efeito colateral: a conta fica is_active = true.
-- Depois disso, novos admins/superadmins devem ser geridos pela tela de
-- administracao de usuarios, nunca por SQL manual.

begin;

select set_config('bootstrap.email', 'COLOQUE_O_EMAIL_AQUI', true); -- <- EDITAR AQUI
select set_config('bootstrap.user_id', 'COLOQUE_O_USER_ID_AQUI', true); -- <- EDITAR AQUI (uuid lido no select)

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

commit;
