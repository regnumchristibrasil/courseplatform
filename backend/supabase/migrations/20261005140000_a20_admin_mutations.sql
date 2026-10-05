-- A20: app.admin_set_user_role() e app.admin_set_user_active() -- mutacoes de
-- papel/status por admin (ADR 0001, decisoes 3 e 4; invariantes I1-I6).
--
-- Formato de erro (contrato parseavel pelo cliente): a MESSAGE da excecao e
-- o codigo estavel de AdminUsersErrorCode, sem texto adicional; o HINT repete
-- o codigo. SQLSTATE por codigo:
--   forbidden       -> 42501  (igual a a19)
--   invalid_input   -> 22023  (igual a a19)
--   not_found       -> P0002  (no_data_found)
--   self_target     -> AD001  (classe AD: erros de gestao de usuarios)
--   actor_inactive  -> AD002
--   stale_target    -> AD003
--   last_superadmin -> AD004
-- O cliente deve usar message (ou hint) como codigo, nunca texto livre.
-- Atencao: o status HTTP difere entre RPC direta (PostgREST) e Edge Function;
-- chaveie sempre em error.message/code, nunca no status HTTP.
--
-- Ordem das checagens (nao vazar existencia de alvo para nao-admins), todas
-- ANTES de tocar o lock global:
--   ator (auth.uid()) existe e esta ativo -> entrada valida -> ator != alvo
--   -> ator e admin/superadmin
-- Depois, sob o lock: rechecagem do ator (FOR UPDATE) -> alvo existe -> regra
-- de rank -> no-op -> stale -> ultimo superadmin -> UPDATE + auditoria.
--
-- No-op ANTES de stale (idempotencia): se o valor atual ja e o valor pedido,
-- a RPC devolve a linha (sem auditoria, sem erro) mesmo que expected* seja
-- diferente. Assim o retry apos "mudanca commitada + falha do ban no Auth"
-- (expected = valor anterior OU = valor pedido) nunca vira stale_target, e a
-- Edge Function consegue re-sincronizar o Auth. stale_target so ocorre quando
-- o valor atual difere do pedido E do esperado.
--
-- Concorrencia: pg_advisory_xact_lock global (app_private.user_access_lock(),
-- mesma chave nas RPCs e no trigger de I2) serializa toda mutacao de acesso,
-- alem de FOR UPDATE nas linhas ator/alvo. O lock so e tomado depois de uma
-- pre-checagem barata sem lock de que o chamador e admin/superadmin ativo:
-- nao-admins nunca tocam o lock global.
--
-- I2: DEFERRED CONSTRAINT TRIGGER em app_private.user_access (secao 5) e a
-- garantia real de "sempre ha ao menos um superadmin ativo", valendo ate para
-- SQL manual, cascade de auth.users e service_role. Pelas RPCs o ramo
-- last_superadmin e inalcancavel (o ator precisa ser superadmin ativo e
-- distinto do alvo); o predicado e o MESMO (assert_not_last_superadmin).
-- TRUNCATE e recusado enquanto houver superadmin ativo.
--
-- O ban no Auth NAO e feito aqui: a Edge Function o faz apos o sucesso. Pela
-- RPC direta, desativar nao aplica o ban (aceito: o flag e a fonte da
-- verdade; o gate de dados de a21 vale para usuario inativo).

-- (O vocabulario da auditoria -- CHECK de action -- vive na definicao da
-- tabela em a18.)

-- 1. Chave unica do lock global de mutacao de acesso. Definida UMA vez aqui;
-- RPCs, helper e trigger de I2 chamam esta funcao.
create function app_private.user_access_lock()
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('app_private.user_access_mutation', 0));
$$;

revoke all on function app_private.user_access_lock() from public, anon, authenticated;

-- 2. Predicado unico de I2: levanta last_superadmin (AD004) se NAO existe
-- outro superadmin ativo alem de p_target. p_target NULL = "qualquer": o
-- trigger o usa no estado final da transacao.
create function app_private.assert_not_last_superadmin(p_target uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from app_private.user_access ua
    where ua.role = 'superadmin'
      and ua.is_active
      and (p_target is null or ua.user_id <> p_target)
  ) then
    raise exception using errcode = 'AD004', message = 'last_superadmin', hint = 'last_superadmin';
  end if;
end;
$$;

revoke all on function app_private.assert_not_last_superadmin(uuid) from public, anon, authenticated;

-- 3. Helper interno: valida ator/entrada/alvo e devolve a linha do alvo
-- travada. Nao e exposto a clientes. p_is_role_change escolhe a variante
-- (papel x status) e quais parametros de entrada sao obrigatorios.
create function app_private.lock_and_check_target(
  p_target uuid,
  p_is_role_change boolean,
  p_new_role text,
  p_expected_role text,
  p_active boolean,
  p_expected_active boolean,
  p_reason text
)
returns app_private.user_access
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_row app_private.user_access;
  v_target app_private.user_access;
  c_roles constant text[] := array['superadmin', 'admin', 'tutor', 'student'];
  c_manageable constant text[] := array['student', 'tutor'];
  c_max_reason constant int := 500; -- MAX_REASON_LENGTH do contrato
begin
  -- Pre-checagem barata SEM lock: ator existente e ativo.
  select * into v_actor_row from app_private.user_access ua where ua.user_id = v_actor;
  if not found then
    raise exception using errcode = '42501', message = 'forbidden', hint = 'forbidden';
  end if;
  if not v_actor_row.is_active then
    raise exception using errcode = 'AD002', message = 'actor_inactive', hint = 'actor_inactive';
  end if;

  -- Entrada valida (so depois do ator, para nao vazar nada a nao-existentes).
  if p_target is null
     or (p_reason is not null and char_length(p_reason) > c_max_reason)
     or (p_is_role_change and (
           p_new_role is null or p_new_role <> all (c_roles)
           or p_expected_role is null or p_expected_role <> all (c_roles)))
     or (not p_is_role_change and (p_active is null or p_expected_active is null)) then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;

  -- I1.
  if p_target = v_actor then
    raise exception using errcode = 'AD001', message = 'self_target', hint = 'self_target';
  end if;

  if v_actor_row.role not in ('admin', 'superadmin') then
    raise exception using errcode = '42501', message = 'forbidden', hint = 'forbidden';
  end if;

  -- Somente admin/superadmin ativo chega aqui: serializa as mutacoes de
  -- acesso (I2 sob concorrencia) e rechecagem do ator sob o lock.
  perform app_private.user_access_lock();

  select * into v_actor_row
  from app_private.user_access ua
  where ua.user_id = v_actor
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'forbidden', hint = 'forbidden';
  end if;
  if not v_actor_row.is_active then
    raise exception using errcode = 'AD002', message = 'actor_inactive', hint = 'actor_inactive';
  end if;
  if v_actor_row.role not in ('admin', 'superadmin') then
    raise exception using errcode = '42501', message = 'forbidden', hint = 'forbidden';
  end if;

  select * into v_target
  from app_private.user_access ua
  where ua.user_id = p_target
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'not_found', hint = 'not_found';
  end if;

  -- I4 / decisao 4: admin so toca student/tutor e so atribui student/tutor;
  -- superadmin toca qualquer alvo (pares incluidos), nunca a si mesmo.
  if v_actor_row.role = 'admin' then
    if v_target.role <> all (c_manageable)
       or (p_is_role_change and p_new_role <> all (c_manageable)) then
      raise exception using errcode = '42501', message = 'forbidden', hint = 'forbidden';
    end if;
  end if;

  return v_target;
end;
$$;

revoke all on function app_private.lock_and_check_target(uuid, boolean, text, text, boolean, boolean, text)
  from public, anon, authenticated;

-- 4. app.admin_set_user_role
create function app.admin_set_user_role(
  p_target uuid,
  p_role text,
  p_expected_role text,
  p_reason text default null
)
returns table (user_id uuid, role text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_target app_private.user_access;
begin
  v_target := app_private.lock_and_check_target(
    p_target, true, p_role, p_expected_role, null, null, p_reason
  );

  -- No-op idempotente ANTES de stale (ver cabecalho): devolve a linha.
  if v_target.role = p_role then
    return query select v_target.user_id, v_target.role, v_target.updated_at;
    return;
  end if;

  if v_target.role <> p_expected_role then
    raise exception using errcode = 'AD003', message = 'stale_target', hint = 'stale_target';
  end if;

  -- I2: rebaixar superadmin ativo exige outro superadmin ativo.
  if v_target.role = 'superadmin' and v_target.is_active then
    perform app_private.assert_not_last_superadmin(p_target);
  end if;

  insert into app_private.user_access_audit (actor_id, target_id, action, old_value, new_value, reason)
  values (v_actor, p_target, 'role_changed', v_target.role, p_role, p_reason);

  return query
  update app_private.user_access ua
  set role = p_role
  where ua.user_id = p_target
  returning ua.user_id, ua.role, ua.updated_at;
end;
$$;

comment on function app.admin_set_user_role(uuid, text, text, text) is
  'Altera papel de p_target (ator = auth.uid()). Erros: message = codigo estavel (forbidden 42501, invalid_input 22023, not_found P0002, self_target AD001, actor_inactive AD002, stale_target AD003, last_superadmin AD004). Valor atual == pedido e no-op idempotente (devolve a linha, sem auditoria) ANTES de stale_target.';

revoke all on function app.admin_set_user_role(uuid, text, text, text) from public, anon;
grant execute on function app.admin_set_user_role(uuid, text, text, text) to authenticated;

-- 5. app.admin_set_user_active (somente banco; ban no Auth e da Edge Function)
create function app.admin_set_user_active(
  p_target uuid,
  p_active boolean,
  p_expected_active boolean,
  p_reason text default null
)
returns table (user_id uuid, is_active boolean, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_target app_private.user_access;
begin
  v_target := app_private.lock_and_check_target(
    p_target, false, null, null, p_active, p_expected_active, p_reason
  );

  -- No-op idempotente ANTES de stale (ver cabecalho): devolve a linha.
  if v_target.is_active = p_active then
    return query select v_target.user_id, v_target.is_active, v_target.updated_at;
    return;
  end if;

  if v_target.is_active <> p_expected_active then
    raise exception using errcode = 'AD003', message = 'stale_target', hint = 'stale_target';
  end if;

  -- I2: desativar superadmin ativo exige outro superadmin ativo.
  if not p_active and v_target.role = 'superadmin' and v_target.is_active then
    perform app_private.assert_not_last_superadmin(p_target);
  end if;

  insert into app_private.user_access_audit (actor_id, target_id, action, old_value, new_value, reason)
  values (v_actor, p_target, 'active_changed', v_target.is_active::text, p_active::text, p_reason);

  return query
  update app_private.user_access ua
  set is_active = p_active
  where ua.user_id = p_target
  returning ua.user_id, ua.is_active, ua.updated_at;
end;
$$;

comment on function app.admin_set_user_active(uuid, boolean, boolean, text) is
  'Altera is_active de p_target (ator = auth.uid()); somente banco, a Edge Function aplica o ban no Auth depois. Erros iguais a admin_set_user_role. Valor atual == pedido e no-op idempotente (devolve a linha, sem auditoria) ANTES de stale_target.';

revoke all on function app.admin_set_user_active(uuid, boolean, boolean, text) from public, anon;
grant execute on function app.admin_set_user_active(uuid, boolean, boolean, text) to authenticated;

-- 6. I2 como constraint trigger DEFERIDO: avaliado no COMMIT sobre o estado
-- final (permite promover o sucessor e remover o antigo na mesma transacao).
-- SECURITY DEFINER para o lock funcionar para qualquer papel que mutar a
-- tabela. WHEN limita o disparo a quem era superadmin ativo; banco sem
-- superadmin (fresco) nunca dispara.
create function app_private.guard_last_superadmin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.user_access_lock();
  perform app_private.assert_not_last_superadmin(null);
  return null;
end;
$$;

revoke all on function app_private.guard_last_superadmin() from public, anon, authenticated;

create constraint trigger user_access_guard_last_superadmin_upd
  after update on app_private.user_access
  deferrable initially deferred
  for each row
  when (old.role = 'superadmin' and old.is_active
        and (new.role <> 'superadmin' or not new.is_active))
  execute function app_private.guard_last_superadmin();

create constraint trigger user_access_guard_last_superadmin_del
  after delete on app_private.user_access
  deferrable initially deferred
  for each row
  when (old.role = 'superadmin' and old.is_active)
  execute function app_private.guard_last_superadmin();

-- TRUNCATE nao e coberto por triggers de linha: recusado (nao deferido)
-- enquanto houver superadmin ativo.
-- Recusa se EXISTE superadmin ativo (o inverso do predicado de
-- assert_not_last_superadmin). Banco sem superadmin (fresco) pode truncar.
create function app_private.guard_user_access_truncate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.user_access_lock();
  if exists (
    select 1 from app_private.user_access ua where ua.role = 'superadmin' and ua.is_active
  ) then
    raise exception using errcode = 'AD004', message = 'last_superadmin', hint = 'last_superadmin';
  end if;
  return null;
end;
$$;

revoke all on function app_private.guard_user_access_truncate() from public, anon, authenticated;

create trigger user_access_guard_truncate
  before truncate on app_private.user_access
  for each statement
  execute function app_private.guard_user_access_truncate();

-- Os guards valem tambem sob session_replication_role = replica.
alter table app_private.user_access enable always trigger user_access_guard_last_superadmin_upd;
alter table app_private.user_access enable always trigger user_access_guard_last_superadmin_del;
alter table app_private.user_access enable always trigger user_access_guard_truncate;
