-- A26 -- acesso do aluno matriculado sobrevive a despublicacao e arquivamento
-- (ticket #13; GLOSSARY "Acesso do aluno").
-- Substitui o comportamento de app.get_playable_ref da A25 para matriculados:
-- la, aula/modulo arquivado nunca tocava; aqui toca com matricula valida.
--
-- Regra unica: quem tem matricula valida (ativa, nao expirada, usuario ativo)
-- le modulos e aulas do curso -- inclusive arquivados -- e reproduz os videos,
-- qualquer que seja o status do curso. Sem matricula valida, vale o catalogo
-- publico (A25): so itens nao arquivados de cursos publicados.
--
-- Leitura: policies adicionais (permissivas, combinam por OR com as publicas
-- da A25), apenas para `authenticated`, usando o wrapper app.has_active_enrollment(uuid)
-- que ja aplica expiracao e o gate de usuario inativo (A21).

create policy modules_select_enrolled
  on public.modules
  for select
  to authenticated
  using (app.has_active_enrollment(course_id));

create policy lessons_select_enrolled
  on public.lessons
  for select
  to authenticated
  using (app.has_active_enrollment(course_id));

-- get_playable_ref: com direito ao curso, aula/modulo arquivado toca (o aluno
-- comprou o conteudo). Sem direito, so free preview ATIVA toca; arquivada =
-- zero linhas, como no catalogo publico. Zero linhas continua indistinguivel
-- de aula inexistente.
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
         (l.archived_at is not null or m.archived_at is not null)
    into v_course_id, v_is_free_preview, v_is_archived
  from public.lessons l
  join public.modules m on m.id = l.module_id
  where l.id = p_lesson_id;

  if not found then
    return;
  end if;

  if not app.has_active_enrollment(auth.uid(), v_course_id)
     and (not v_is_free_preview or v_is_archived) then
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
  'Unico caminho de leitura de app_private.lesson_assets acessivel ao cliente. Retorna zero linhas (nunca erro) para usuario desativado, sem direito, aula inexistente ou free preview arquivada. Matricula valida toca qualquer aula do curso, inclusive arquivada, independente do status do curso. Free preview ativa exige usuario ativo. GRANT TO authenticated apenas.';

revoke all on function app.get_playable_ref(uuid) from public, anon;
grant execute on function app.get_playable_ref(uuid) to authenticated;
