-- A38: app.complete_lesson(lesson_id) e app.uncomplete_lesson(lesson_id)
-- (ticket #26; ADR 0004).
--
-- Conclusao manual e alternavel. Mesmo contrato de app.start_lesson: uma linha
-- quando o chamador tem direito (aluno com matricula valida, aula e modulo
-- ativos); zero linhas, sem efeito e sem erro, para equipe (progresso oculto),
-- usuario desativado, sem sessao, sem direito, aula/modulo arquivado ou aula
-- inexistente.
--
-- * complete_lesson: upsert; cria a linha se a aula nunca foi aberta e preserva
--   first_opened_at e um completed_at ja gravado (idempotente).
-- * uncomplete_lesson: limpa completed_at da linha existente (volta a "em
--   andamento"); sem linha, nao cria nada. Idempotente.
-- Nada aqui apaga linhas: progresso sobrevive a expiracao, reembolso, recompra
-- e arquivamento (decisao 1).

create function app.complete_lesson(p_lesson_id uuid)
returns table (lesson_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_course_id uuid;
begin
  if auth.uid() is null or p_lesson_id is null then
    return;
  end if;

  if app.is_staff() then
    return;
  end if;

  select l.course_id
    into v_course_id
  from public.lessons l
  join public.modules m on m.id = l.module_id
  where l.id = p_lesson_id
    and l.archived_at is null
    and m.archived_at is null;

  if not found or not app.has_active_enrollment(auth.uid(), v_course_id) then
    return;
  end if;

  insert into public.lesson_progress as lp (user_id, lesson_id, completed_at)
  values (auth.uid(), p_lesson_id, now())
  on conflict on constraint lesson_progress_pkey
  do update set completed_at = coalesce(lp.completed_at, excluded.completed_at);

  return query select p_lesson_id;
end;
$$;

create function app.uncomplete_lesson(p_lesson_id uuid)
returns table (lesson_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_course_id uuid;
begin
  if auth.uid() is null or p_lesson_id is null then
    return;
  end if;

  if app.is_staff() then
    return;
  end if;

  select l.course_id
    into v_course_id
  from public.lessons l
  join public.modules m on m.id = l.module_id
  where l.id = p_lesson_id
    and l.archived_at is null
    and m.archived_at is null;

  if not found or not app.has_active_enrollment(auth.uid(), v_course_id) then
    return;
  end if;

  update public.lesson_progress lp
     set completed_at = null
   where lp.user_id = auth.uid()
     and lp.lesson_id = p_lesson_id
     and lp.completed_at is not null;

  return query select p_lesson_id;
end;
$$;

comment on function app.complete_lesson(uuid) is
  'Marca a aula como concluida (idempotente; first_opened_at e completed_at ja gravados preservados). Uma linha com direito; zero linhas, sem efeito e sem erro, para equipe, desativado, sem sessao, sem direito, aula/modulo arquivado ou inexistente. GRANT TO authenticated apenas.';
comment on function app.uncomplete_lesson(uuid) is
  'Desmarca a conclusao (volta a em andamento; nunca cria nem apaga linha). Mesmo contrato de direito e de zero linhas de app.complete_lesson. GRANT TO authenticated apenas.';

revoke all on function app.complete_lesson(uuid) from public, anon;
revoke all on function app.uncomplete_lesson(uuid) from public, anon;
grant execute on function app.complete_lesson(uuid) to authenticated;
grant execute on function app.uncomplete_lesson(uuid) to authenticated;
