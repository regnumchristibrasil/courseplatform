-- A35: public.lesson_progress e app.my_courses() (ticket #23; ADR 0004).
--
-- * lesson_progress: uma linha por (user_id, lesson_id). Pertence ao aluno e a
--   aula, nao a matricula: expiracao, reembolso e recompra nao a alteram.
--   RLS ligado e NENHUMA policy nem grant para o cliente; acesso so por RPCs
--   SECURITY DEFINER (decisao 3). Cascade com auth.users e lessons.
-- * my_courses: cursos com matricula 'active' (valida ou expirada); a
--   reembolsada nao aparece. Valida primeiro, depois expirada, ambas por
--   matricula mais recente. Percentual calculado na leitura: aulas ativas
--   concluidas / aulas ativas, arquivadas (aula ou modulo) fora dos dois lados.
--   Matricula 'expired' (historico da recompra, A23) conta como acesso expirado;
--   reembolso mais recente que o ultimo acesso esconde o curso.
--   Usuario desativado, sem sessao ou sem matricula = zero linhas, nunca erro.

create table public.lesson_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  first_opened_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (user_id, lesson_id)
);

comment on table public.lesson_progress is
  'Progresso por aluno e aula (ADR 0004). Independe da matricula. Sem policies e sem grants ao cliente: acesso apenas por RPCs SECURITY DEFINER.';

create index lesson_progress_lesson_id_idx on public.lesson_progress (lesson_id);

alter table public.lesson_progress enable row level security;

revoke all on public.lesson_progress from public, anon, authenticated;
grant select, insert, update, delete on public.lesson_progress to service_role;

create function app.my_courses()
returns table (
  course_id uuid,
  title text,
  course_status text,
  is_expired boolean,
  expires_at timestamptz,
  total_lessons integer,
  completed_lessons integer,
  progress_percent integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with caller as (
    select ua.user_id
    from app_private.user_access ua
    where ua.user_id = auth.uid()
      and ua.is_active
  ),
  mine as (
    select e.course_id,
           bool_or(e.expires_at is null or e.expires_at > now()) as is_valid,
           max(e.granted_at) as last_granted_at,
           -- expires_at do acesso vigente; se so ha expiradas, a mais recente.
           case
             when bool_or(e.expires_at is null or e.expires_at > now())
               then max(e.expires_at) filter (where e.expires_at is null or e.expires_at > now())
             else max(e.expires_at)
           end as expires_at
    from public.enrollments e
    join caller c on c.user_id = e.user_id
    -- 'expired' e o historico fechado por confirm_payment na recompra (A23).
    where e.status in ('active', 'expired')
    group by e.course_id
    -- reembolso posterior ao ultimo acesso esconde o curso.
    having not exists (
      select 1 from public.enrollments r
      where r.user_id = auth.uid()
        and r.course_id = e.course_id
        and r.status = 'refunded'
        and r.granted_at >= max(e.granted_at)
    )
  ),
  counts as (
    select m.course_id,
           count(l.id)::integer as total_lessons,
           count(lp.completed_at)::integer as completed_lessons
    from mine m
    left join public.lessons l
           on l.course_id = m.course_id
          and l.archived_at is null
          and exists (
            select 1 from public.modules mo
            where mo.id = l.module_id and mo.archived_at is null
          )
    left join public.lesson_progress lp
           on lp.lesson_id = l.id
          and lp.user_id = auth.uid()
    group by m.course_id
  )
  select m.course_id,
         c.title,
         c.status,
         not m.is_valid,
         m.expires_at,
         n.total_lessons,
         n.completed_lessons,
         case when n.total_lessons = 0 then 0
              else round(100.0 * n.completed_lessons / n.total_lessons)::integer
         end
  from mine m
  join public.courses c on c.id = m.course_id
  join counts n on n.course_id = m.course_id
  order by m.is_valid desc, m.last_granted_at desc, m.course_id;
$$;

comment on function app.my_courses() is
  'Cursos do aluno chamador (matricula active, valida ou expirada; reembolsada fora) com progresso calculado na leitura. Zero linhas, nunca erro, para usuario desativado, sem sessao ou sem matricula. GRANT TO authenticated apenas.';

revoke all on function app.my_courses() from public, anon;
grant execute on function app.my_courses() to authenticated;
