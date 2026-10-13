-- A37: app.start_lesson(lesson_id) (ticket #25; ADR 0004).
--
-- Marca a aula como "em andamento": cria a linha de lesson_progress se nao
-- existir (first_opened_at gravado uma vez; ON CONFLICT DO NOTHING preserva
-- first_opened_at e completed_at, entao e idempotente e nunca rebaixa uma
-- conclusao). Retorna uma linha quando o chamador tem direito (aluno com
-- matricula valida, aula e modulo ativos); zero linhas, sem efeito e sem erro,
-- para equipe (progresso oculto), usuario desativado, sem sessao, sem direito,
-- aula arquivada, free preview sozinho ou aula inexistente.

create function app.start_lesson(p_lesson_id uuid)
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

  -- Usuario desativado cai em has_active_enrollment (predicado compartilhado).
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

  insert into public.lesson_progress (user_id, lesson_id)
  values (auth.uid(), p_lesson_id)
  on conflict on constraint lesson_progress_pkey do nothing;

  return query select p_lesson_id;
end;
$$;

comment on function app.start_lesson(uuid) is
  'Registra a aula como em andamento (idempotente; first_opened_at gravado uma vez, conclusao preservada). Uma linha com direito; zero linhas, sem efeito e sem erro, para equipe, desativado, sem sessao, sem direito, aula/modulo arquivado ou inexistente. GRANT TO authenticated apenas.';

revoke all on function app.start_lesson(uuid) from public, anon;
grant execute on function app.start_lesson(uuid) to authenticated;
