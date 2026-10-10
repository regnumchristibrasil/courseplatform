-- A30: criar curso e editar detalhes (ADR 0002, decisoes 3, 4 e 7; ticket #16).
--
-- 1. courses.price_cents passa a aceitar NULL (rascunho sem preco), com faixa
--    1..10_000_000 centavos (R$ 100.000,00) e "publicado exige preco" como
--    CHECK de banco.
-- 2. app_private.course_audit: auditoria append-only (preco, duracao, status,
--    exclusao). Sem FK para courses: o registro de uma exclusao sobrevive ao
--    curso.
-- 3. app.staff_create_course / app.staff_update_course.
--
-- Formato de erro (mesmo contrato de A19/A28): a MESSAGE da excecao e o codigo
-- estavel, o HINT o repete.
--   forbidden     -> 42501
--   invalid_input -> 22023
--   not_found     -> P0002
--   stale_target  -> CR001 (classe CR: erros de gestao de cursos)
--
-- Locking otimista: o cliente envia o updated_at que leu (p_expected_updated_at,
-- timestamptz com microssegundos -- trafegue como texto, nunca como Date JS).
-- Divergencia -> stale_target, nada e gravado.
--
-- Semantica de update: SUBSTITUICAO completa dos campos editaveis (titulo,
-- descricao, preco, duracao); o editor sempre envia o estado inteiro. Tutor so
-- pode reenviar preco/duracao IGUAIS aos atuais; qualquer diferenca ->
-- forbidden (regra aplicada aqui, o cliente apenas esconde os controles).
-- Valores identicos aos atuais sao no-op: sem UPDATE, sem auditoria.

-- 1. Preco opcional em rascunho + faixa + publicado exige preco.
alter table public.courses alter column price_cents drop not null;
alter table public.courses drop constraint courses_price_cents_check;
alter table public.courses
  add constraint courses_price_range
    check (price_cents is null or price_cents between 1 and 10000000),
  add constraint courses_published_requires_price
    check (status <> 'published' or price_cents is not null);

comment on column public.courses.price_cents is
  'Centavos, 1..10000000 (R$ 100.000,00). NULL somente enquanto rascunho (courses_published_requires_price). Lido no servidor por checkout -- nunca aceite do cliente.';

-- 2. Auditoria append-only.
create table app_private.course_audit (
  id bigint generated always as identity primary key,
  course_id uuid not null,
  actor_id uuid not null,
  action text not null check (action in (
    'price_changed', 'access_duration_changed', 'status_changed', 'deleted'
  )),
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);

comment on table app_private.course_audit is
  'Auditoria append-only de acoes sensiveis sobre cursos (ADR 0002, decisao 7). Sem FK: sobrevive a exclusao do curso. Edicoes de conteudo nao sao auditadas.';

create function app_private.reject_course_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'course_audit is append-only';
end;
$$;

revoke all on function app_private.reject_course_audit_mutation() from public, anon, authenticated;

create trigger course_audit_block_row_mutation
  before update or delete on app_private.course_audit
  for each row
  execute function app_private.reject_course_audit_mutation();

create trigger course_audit_block_truncate
  before truncate on app_private.course_audit
  for each statement
  execute function app_private.reject_course_audit_mutation();

alter table app_private.course_audit enable always trigger course_audit_block_row_mutation;
alter table app_private.course_audit enable always trigger course_audit_block_truncate;

alter table app_private.course_audit enable row level security;
revoke all on app_private.course_audit from public, anon, authenticated;
grant select, insert on app_private.course_audit to service_role;

-- 3a. Validacao de entrada compartilhada (titulo/descricao/preco/duracao).
create function app_private.assert_valid_course_fields(
  p_title text,
  p_description text,
  p_price_cents integer,
  p_access_duration_days integer
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  c_max_title constant int := 200;
  c_max_description constant int := 5000;
  c_max_price constant int := 10000000;
  c_max_duration constant int := 36500; -- ~100 anos: evita overflow de interval
begin
  if p_title is null or btrim(p_title) = '' or char_length(btrim(p_title)) > c_max_title
     or (p_description is not null and char_length(p_description) > c_max_description)
     or (p_price_cents is not null and p_price_cents not between 1 and c_max_price)
     or (p_access_duration_days is not null and p_access_duration_days not between 1 and c_max_duration) then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;
end;
$$;

revoke all on function app_private.assert_valid_course_fields(text, text, integer, integer)
  from public, anon, authenticated;

-- 3b. app.staff_create_course: sempre cria RASCUNHO.
create function app.staff_create_course(
  p_title text,
  p_description text,
  p_price_cents integer,
  p_access_duration_days integer
)
returns table (id uuid, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select ua.role into v_role
  from app_private.user_access ua
  where ua.user_id = auth.uid() and ua.is_active
    and ua.role in ('tutor', 'admin', 'superadmin');
  if v_role is null then
    raise exception using errcode = '42501', message = 'forbidden', hint = 'forbidden';
  end if;

  -- Tutor nao define campos comerciais (ADR 0002, decisao 4).
  if v_role = 'tutor' and (p_price_cents is not null or p_access_duration_days is not null) then
    raise exception using errcode = '42501', message = 'forbidden', hint = 'forbidden';
  end if;

  perform app_private.assert_valid_course_fields(
    p_title, p_description, p_price_cents, p_access_duration_days
  );

  return query
  insert into public.courses as c (title, description, price_cents, access_duration_days, status)
  values (btrim(p_title), p_description, p_price_cents, p_access_duration_days, 'draft')
  returning c.id, c.updated_at;
end;
$$;

comment on function app.staff_create_course(text, text, integer, integer) is
  'Cria curso em rascunho (equipe ativa). Tutor nao informa preco/duracao. Erros: message = codigo estavel (forbidden 42501, invalid_input 22023).';

revoke all on function app.staff_create_course(text, text, integer, integer) from public, anon;
grant execute on function app.staff_create_course(text, text, integer, integer) to authenticated;

-- 3c. app.staff_update_course
create function app.staff_update_course(
  p_course_id uuid,
  p_expected_updated_at timestamptz,
  p_title text,
  p_description text,
  p_price_cents integer,
  p_access_duration_days integer
)
returns table (
  id uuid,
  updated_at timestamptz,
  price_changed boolean,
  access_duration_changed boolean,
  previous_price_cents integer,
  previous_access_duration_days integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_course public.courses;
  v_price_changed boolean;
  v_duration_changed boolean;
  v_updated_at timestamptz;
begin
  select ua.role into v_role
  from app_private.user_access ua
  where ua.user_id = v_actor and ua.is_active
    and ua.role in ('tutor', 'admin', 'superadmin');
  if v_role is null then
    raise exception using errcode = '42501', message = 'forbidden', hint = 'forbidden';
  end if;

  if p_course_id is null or p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;

  select * into v_course from public.courses c where c.id = p_course_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'not_found', hint = 'not_found';
  end if;

  v_price_changed := v_course.price_cents is distinct from p_price_cents;
  v_duration_changed := v_course.access_duration_days is distinct from p_access_duration_days;

  if v_role = 'tutor' and (v_price_changed or v_duration_changed) then
    raise exception using errcode = '42501', message = 'forbidden', hint = 'forbidden';
  end if;

  perform app_private.assert_valid_course_fields(
    p_title, p_description, p_price_cents, p_access_duration_days
  );

  if v_course.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'CR001', message = 'stale_target', hint = 'stale_target';
  end if;

  -- Publicado exige preco (tambem CHECK de banco; aqui devolve o codigo estavel).
  if v_course.status = 'published' and p_price_cents is null then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;

  if not v_price_changed and not v_duration_changed
     and v_course.title = btrim(p_title)
     and v_course.description is not distinct from p_description then
    return query select v_course.id, v_course.updated_at, false, false,
                        v_course.price_cents, v_course.access_duration_days;
    return;
  end if;

  if v_price_changed then
    insert into app_private.course_audit (course_id, actor_id, action, old_value, new_value)
    values (p_course_id, v_actor, 'price_changed',
            v_course.price_cents::text, p_price_cents::text);
  end if;
  if v_duration_changed then
    insert into app_private.course_audit (course_id, actor_id, action, old_value, new_value)
    values (p_course_id, v_actor, 'access_duration_changed',
            v_course.access_duration_days::text, p_access_duration_days::text);
  end if;

  update public.courses c
  set title = btrim(p_title),
      description = p_description,
      price_cents = p_price_cents,
      access_duration_days = p_access_duration_days
  where c.id = p_course_id
  returning c.updated_at into v_updated_at;

  return query select p_course_id, v_updated_at, v_price_changed, v_duration_changed,
                      v_course.price_cents, v_course.access_duration_days;
end;
$$;

comment on function app.staff_update_course(uuid, timestamptz, text, text, integer, integer) is
  'Substitui titulo/descricao/preco/duracao (equipe ativa). Tutor so reenvia preco/duracao iguais aos atuais. Locking otimista por updated_at. Audita preco e duracao. Erros: message = codigo estavel (forbidden 42501, invalid_input 22023, not_found P0002, stale_target CR001).';

revoke all on function app.staff_update_course(uuid, timestamptz, text, text, integer, integer)
  from public, anon;
grant execute on function app.staff_update_course(uuid, timestamptz, text, text, integer, integer)
  to authenticated;
