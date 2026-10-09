-- A25: public.modules entre curso e aula (ADR 0002, decisoes 1 e 2).
--
-- * modules: ordenados por curso, arquivaveis (archived_at), so titulo e
--   posicao (sem status proprio).
-- * lessons: passa a exigir module_id; lessons.course_id e mantido e
--   amarrado ao modulo por FK composta (module_id, course_id), de modo que
--   uma aula nunca aponta para modulo de outro curso e as policies/RPCs
--   existentes que leem lessons.course_id continuam validas.
-- * posicoes densas (1..N) com UNIQUE DEFERRABLE INITIALLY DEFERRED:
--   reordenar/trocar itens em uma unica transacao sem posicao temporaria.
--   A unicidade e checada no COMMIT (ou em SET CONSTRAINTS ... IMMEDIATE).
-- * backfill: um modulo padrao por curso existente, todas as aulas movidas
--   para ele, posicoes renumeradas sem lacunas. Ensaiado em transacao com
--   ROLLBACK sobre dados de formato antigo (curso sem aulas, posicoes
--   esparsas 3/17/40): saida 1..3, nenhum curso sem modulo, nenhuma aula
--   em modulo de outro curso.
-- * FK aula -> modulo e NO ACTION (nao RESTRICT): bloqueia apagar modulo
--   com aulas, mas a checagem ocorre no fim do comando, entao
--   DELETE em courses (cascade para modulos e aulas) continua funcionando.
-- * leituras publicas e app.get_playable_ref ignoram itens arquivados.

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  position integer not null check (position >= 1),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- alvo da FK composta de lessons
  constraint modules_id_course_id_key unique (id, course_id),
  constraint modules_course_position_key unique (course_id, position)
    deferrable initially deferred
);

comment on table public.modules is
  'Agrupamento ordenado de aulas dentro de um curso. Escrita apenas via RPCs de gestao (service_role / SECURITY DEFINER); clientes so leem modulos nao arquivados de cursos publicados.';

alter table public.modules enable row level security;

create trigger set_modules_updated_at
  before update on public.modules
  for each row
  execute function app_private.set_updated_at();

create policy modules_select_active_published
  on public.modules
  for select
  to anon, authenticated
  using (
    archived_at is null
    and exists (
      select 1
      from public.courses c
      where c.id = modules.course_id
        and c.status = 'published'
    )
  );

grant select on public.modules to anon, authenticated;
grant select, insert, update, delete on public.modules to service_role;
revoke truncate, references, trigger, maintain on public.modules from anon, authenticated;

-- Backfill ------------------------------------------------------------------

-- Um modulo padrao por curso existente (inclusive cursos sem aulas).
insert into public.modules (course_id, title, position)
select c.id, 'Conteúdo do curso', 1
from public.courses c;

alter table public.lessons
  add column module_id uuid,
  add column archived_at timestamptz;

-- A unicidade antiga (course_id, position) nao vale mais: a posicao passa a
-- ser por modulo. Cai antes da renumeracao para nao colidir no meio do UPDATE.
alter table public.lessons
  drop constraint lessons_course_id_position_key;

update public.lessons l
set module_id = m.id,
    position = r.new_position
from public.modules m,
     (
       select id, row_number() over (partition by course_id order by position, created_at, id) as new_position
       from public.lessons
     ) r
where m.course_id = l.course_id
  and r.id = l.id;

alter table public.lessons
  alter column module_id set not null,
  add constraint lessons_module_course_fkey
    foreign key (module_id, course_id) references public.modules (id, course_id),
  add constraint lessons_position_check check (position >= 1),
  add constraint lessons_module_position_key unique (module_id, position)
    deferrable initially deferred;

-- A unique antiga (course_id, position) era o unico indice em lessons.course_id;
-- policies, get_playable_ref e o cascade de courses ainda filtram por ele.
create index if not exists lessons_course_id_idx on public.lessons (course_id);

-- Leituras publicas ---------------------------------------------------------

drop policy lessons_select_parent_published on public.lessons;

create policy lessons_select_active_published
  on public.lessons
  for select
  to anon, authenticated
  using (
    archived_at is null
    and exists (
      select 1
      from public.modules m
      join public.courses c on c.id = m.course_id
      where m.id = lessons.module_id
        and m.archived_at is null
        and c.status = 'published'
    )
  );

-- get_playable_ref: mesma logica da A21, mais "aula ou modulo arquivado =
-- zero linhas" (indistinguivel de aula inexistente / sem direito).
create or replace function app.get_playable_ref(p_lesson_id uuid)
returns table (lesson_id uuid, provider text, external_ref text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_course_id uuid;
  v_is_free_preview boolean;
begin
  if exists (
    select 1
    from app_private.user_access ua
    where ua.user_id = auth.uid()
      and not ua.is_active
  ) then
    return; -- usuario desativado: zero linhas, indistinguivel de "sem direito"
  end if;

  select l.course_id, l.is_free_preview
    into v_course_id, v_is_free_preview
  from public.lessons l
  join public.modules m on m.id = l.module_id
  where l.id = p_lesson_id
    and l.archived_at is null
    and m.archived_at is null;

  if not found then
    return;
  end if;

  if not v_is_free_preview and not app.has_active_enrollment(auth.uid(), v_course_id) then
    return;
  end if;

  return query
    select la.lesson_id, la.provider, la.external_ref
    from app_private.lesson_assets la
    where la.lesson_id = p_lesson_id
      and la.is_active;
end;
$$;

comment on function app.get_playable_ref(uuid) is
  'Unico caminho de leitura de app_private.lesson_assets acessivel ao cliente. Retorna zero linhas (nunca erro) para usuario desativado, sem direito, aula inexistente ou aula/modulo arquivado. Free preview tambem exige usuario ativo. GRANT TO authenticated apenas.';

revoke all on function app.get_playable_ref(uuid) from public, anon;
grant execute on function app.get_playable_ref(uuid) to authenticated;
