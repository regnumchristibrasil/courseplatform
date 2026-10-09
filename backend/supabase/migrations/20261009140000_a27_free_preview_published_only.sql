-- A27 -- free preview so toca em curso publicado (ticket #13: "usuarios sem
-- matricula nao veem nada de cursos nao publicados", leitura e reproducao).
--
-- Antes, app.get_playable_ref nao olhava o status do curso: qualquer usuario
-- logado tocava a free preview de um curso em rascunho ou arquivado. Agora a
-- free preview sem matricula exige curso publicado, alem de aula e modulo
-- ativos. Matricula valida continua tocando tudo (A26).

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
  v_is_archived boolean;
  v_is_course_published boolean;
begin
  if exists (
    select 1
    from app_private.user_access ua
    where ua.user_id = auth.uid()
      and not ua.is_active
  ) then
    return; -- usuario desativado: zero linhas, indistinguivel de "sem direito"
  end if;

  select l.course_id,
         l.is_free_preview,
         (l.archived_at is not null or m.archived_at is not null),
         (c.status = 'published')
    into v_course_id, v_is_free_preview, v_is_archived, v_is_course_published
  from public.lessons l
  join public.modules m on m.id = l.module_id
  join public.courses c on c.id = l.course_id
  where l.id = p_lesson_id;

  if not found then
    return;
  end if;

  if not app.has_active_enrollment(auth.uid(), v_course_id)
     and not (v_is_free_preview and not v_is_archived and v_is_course_published) then
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
  'Unico caminho de leitura de app_private.lesson_assets acessivel ao cliente. Retorna zero linhas (nunca erro) para usuario desativado, sem direito, aula inexistente, ou free preview arquivada / de curso nao publicado. Matricula valida toca qualquer aula do curso, inclusive arquivada, independente do status do curso. Free preview ativa de curso publicado exige usuario ativo. GRANT TO authenticated apenas.';

revoke all on function app.get_playable_ref(uuid) from public, anon;
grant execute on function app.get_playable_ref(uuid) to authenticated;
