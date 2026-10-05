-- A18: gestao de usuarios admin (ADR 0001).
-- Reshape de app_private.user_roles para app_private.user_access: papel unico
-- por usuario (superadmin > admin > tutor > student) mais flag is_active,
-- fonte da verdade da desativacao. Tabela de auditoria append-only,
-- app.is_admin() redefinida e app.current_access().
-- Mantem a postura de A3: RLS ligado, ZERO policies, sem grants de cliente.

-- 1. Reshape. Linhas existentes (apenas 'admin') sao preservadas.
alter table app_private.user_roles rename to user_access;

alter table app_private.user_access drop constraint user_roles_pkey;
alter table app_private.user_access drop constraint user_roles_role_check;
alter table app_private.user_access add constraint user_access_pkey primary key (user_id);
alter table app_private.user_access
  add constraint user_access_role_check
  check (role in ('superadmin', 'admin', 'tutor', 'student'));
alter table app_private.user_access rename constraint user_roles_user_id_fkey to user_access_user_id_fkey;
alter table app_private.user_access rename column granted_at to created_at;
alter table app_private.user_access add column is_active boolean not null default true;
alter table app_private.user_access add column updated_at timestamptz not null default now();

comment on table app_private.user_access is
  'Papel unico e status ativo por usuario, separado de public.users para que uma policy de self-UPDATE nunca vire vetor de auto-promocao. RLS ligado, zero policies: acessivel apenas via service_role ou RPCs SECURITY DEFINER.';

-- Reusa o utilitario compartilhado de A2 (equivalente: carimba updated_at).
create trigger user_access_touch_updated_at
  before update on app_private.user_access
  for each row
  execute function app_private.set_updated_at();

-- 2. Backfill idempotente: toda conta de auth sem linha vira student ativo.
-- Nunca sobrescreve papel existente. Mantida como funcao (nao inline) porque
-- tambem e passo pos-deploy documentado e testado de forma repetivel; so o
-- dono a executa (revoke abaixo).
create function app_private.backfill_user_access()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into app_private.user_access (user_id, role)
  select u.id, 'student'
  from auth.users u
  on conflict (user_id) do nothing;
$$;

revoke all on function app_private.backfill_user_access() from public, anon, authenticated;

select app_private.backfill_user_access();

-- 3. handle_new_user passa a criar tambem a linha student.
create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name'
  );
  insert into app_private.user_access (user_id, role)
  values (new.id, 'student')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- 4. Auditoria append-only. Sem FK para auth.users: o historico deve
-- sobreviver a exclusao de contas. UPDATE/DELETE/TRUNCATE bloqueados por
-- trigger (vale ate para o dono; ENABLE ALWAYS: tambem sob
-- session_replication_role = replica) e service_role so recebe INSERT/SELECT.
-- Aceito: o dono do schema (postgres) pode contornar desabilitando o trigger;
-- a defesa e de papel/privilegio, nao contra o proprietario.
create table app_private.user_access_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  target_id uuid not null,
  action text not null check (action in ('role_changed', 'active_changed')),
  old_value text,
  new_value text,
  reason text check (char_length(reason) <= 500),
  created_at timestamptz not null default now()
);

comment on table app_private.user_access_audit is
  'Auditoria append-only de mudancas de papel/status. Sem UI de visualizacao por ora (ADR 0001, decisao 6).';

create function app_private.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'user_access_audit is append-only';
end;
$$;

create trigger user_access_audit_block_row_mutation
  before update or delete on app_private.user_access_audit
  for each row
  execute function app_private.reject_audit_mutation();

create trigger user_access_audit_block_truncate
  before truncate on app_private.user_access_audit
  for each statement
  execute function app_private.reject_audit_mutation();

alter table app_private.user_access_audit enable always trigger user_access_audit_block_row_mutation;
alter table app_private.user_access_audit enable always trigger user_access_audit_block_truncate;

alter table app_private.user_access_audit enable row level security;

grant select, insert on app_private.user_access_audit to service_role;

-- 5. app.is_admin(): admin ou superadmin ATIVO.
create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.user_access ua
    where ua.user_id = auth.uid()
      and ua.is_active
      and ua.role in ('admin', 'superadmin')
  );
$$;

comment on function app.is_admin() is
  'True se o usuario chamador (auth.uid()) e admin ou superadmin ativo. search_path = '''' conforme convencao SECURITY DEFINER do repo.';

-- 6. app.current_access(): papel e status apenas do proprio auth.uid().
create function app.current_access()
returns table (role text, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select ua.role, ua.is_active
  from app_private.user_access ua
  where ua.user_id = auth.uid();
$$;

comment on function app.current_access() is
  'Papel e is_active do proprio chamador (auth.uid()); nenhuma linha se nao houver acesso. Nunca expoe outros usuarios.';

revoke all on function app.current_access() from public, anon;
grant execute on function app.current_access() to authenticated;
