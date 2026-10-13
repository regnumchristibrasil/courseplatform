-- A36: app.my_course_tree(course_id) (ticket #24; ADR 0004).
--
-- Arvore do curso para a pagina do aluno: cabecalho, totais e modulos ativos
-- com aulas ativas e estado por aula, numa unica linha (jsonb em "modules",
-- ja ordenado por posicao). Uma linha unica distingue "curso sem aulas" de
-- "sem direito" (zero linhas, nunca erro; mesmo principio de get_playable_ref).
--
-- Direito = equipe ativa (qualquer curso) ou matricula valida, via o predicado
-- compartilhado app.has_active_enrollment (ativa, nao expirada, usuario ativo).
-- Matricula expirada, reembolsada, preview gratuito sozinho, curso inexistente
-- e usuario desativado ou sem sessao caem em zero linhas.
-- Aulas e modulos arquivados ficam fora da arvore e dos totais; a conclusao
-- registrada e preservada. Estado: completed | in_progress (aberta e nao
-- concluida) | not_started. continue_lesson_id = primeira aula ativa nao
-- concluida; com tudo concluido, a primeira aula ativa ("Revisar curso").

create function app.my_course_tree(p_course_id uuid)
returns table (
  course_id uuid,
  title text,
  description text,
  course_status text,
  is_staff boolean,
  total_lessons integer,
  completed_lessons integer,
  progress_percent integer,
  total_duration_seconds integer,
  continue_lesson_id uuid,
  modules jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as (
    select app.is_staff() as is_staff
  ),
  allowed as (
    select c.id, c.title, c.description, c.status, v.is_staff
    from public.courses c
    cross join viewer v
    where c.id = p_course_id
      and auth.uid() is not null
      and (v.is_staff or app.has_active_enrollment(auth.uid(), c.id))
  ),
  lessons_ordered as (
    select l.id,
           l.module_id,
           l.title,
           l.duration_seconds,
           mo.position as module_position,
           l.position as lesson_position,
           case
             when lp.completed_at is not null then 'completed'
             when lp.lesson_id is not null then 'in_progress'
             else 'not_started'
           end as state,
           row_number() over (order by mo.position, l.position) as seq
    from allowed a
    join public.modules mo on mo.course_id = a.id and mo.archived_at is null
    join public.lessons l on l.module_id = mo.id and l.archived_at is null
    left join public.lesson_progress lp
           on lp.lesson_id = l.id
          and lp.user_id = auth.uid()
  ),
  totals as (
    select count(*)::integer as total_lessons,
           (count(*) filter (where state = 'completed'))::integer as completed_lessons,
           coalesce(sum(duration_seconds), 0)::integer as total_duration_seconds,
           coalesce(
             (select lo.id from lessons_ordered lo where lo.state <> 'completed' order by lo.seq limit 1),
             (select lo.id from lessons_ordered lo order by lo.seq limit 1)
           ) as continue_lesson_id
    from lessons_ordered
  ),
  tree as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', mo.id,
          'title', mo.title,
          'lessons', coalesce((
            select jsonb_agg(
                     jsonb_build_object(
                       'id', lo.id,
                       'title', lo.title,
                       'duration_seconds', lo.duration_seconds,
                       'state', lo.state
                     )
                     order by lo.lesson_position
                   )
            from lessons_ordered lo
            where lo.module_id = mo.id
          ), '[]'::jsonb)
        )
        order by mo.position
      ),
      '[]'::jsonb
    ) as modules
    from allowed a
    join public.modules mo on mo.course_id = a.id and mo.archived_at is null
  )
  select a.id,
         a.title,
         a.description,
         a.status,
         a.is_staff,
         t.total_lessons,
         t.completed_lessons,
         case when t.total_lessons = 0 then 0
              else round(100.0 * t.completed_lessons / t.total_lessons)::integer
         end,
         t.total_duration_seconds,
         t.continue_lesson_id,
         tr.modules
  from allowed a
  cross join totals t
  cross join tree tr;
$$;

comment on function app.my_course_tree(uuid) is
  'Arvore do curso para o aluno chamador (modulos e aulas ativos, estado por aula, percentual, aula de Continuar). Uma linha; zero linhas, nunca erro, para quem nao tem direito (sem matricula valida e nao equipe), curso inexistente, usuario desativado ou sem sessao. GRANT TO authenticated apenas.';

revoke all on function app.my_course_tree(uuid) from public, anon;
grant execute on function app.my_course_tree(uuid) to authenticated;
