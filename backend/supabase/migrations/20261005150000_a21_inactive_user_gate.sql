-- A21: gate de usuario inativo (ADR 0001, decisao 5).
-- Desativacao bloqueia reproducao e checkout; matriculas sao preservadas e
-- reativar restaura o acesso. O pedido PIX pendente continua sendo
-- confirmado pelo webhook (app.confirm_payment nao consulta user_access);
-- o acesso segue bloqueado aqui.
--
-- Assinaturas e grants congelados: apenas o corpo muda. Usuario SEM linha em
-- app_private.user_access e tratado como ativo (comportamento pre-A21; A18
-- faz backfill e handle_new_user cria a linha, entao o caso e residual).

create or replace function app.has_active_enrollment(p_user_id uuid, p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.enrollments e
    where e.user_id = p_user_id
      and e.course_id = p_course_id
      and e.status = 'active'
      and (e.expires_at is null or e.expires_at > now())
  )
  and not exists (
    select 1
    from app_private.user_access ua
    where ua.user_id = p_user_id
      and not ua.is_active
  );
$$;

comment on function app.has_active_enrollment(uuid, uuid) is
  'Predicado compartilhado "usuario tem direito ao curso agora": matricula ativa e nao expirada E usuario nao desativado (app_private.user_access.is_active). Sem linha em user_access conta como ativo. service_role apenas. search_path = '''' conforme convencao SECURITY DEFINER do repo.';

-- get_playable_ref: free preview tambem era um caminho de conteudo que nao
-- passava por has_active_enrollment; usuario inativo nao reproduz nada.
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
  where l.id = p_lesson_id;

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
  'Unico caminho de leitura de app_private.lesson_assets acessivel ao cliente. Retorna zero linhas (nunca erro) para usuario desativado, sem direito ou aula inexistente. Free preview tambem exige usuario ativo. GRANT TO authenticated apenas.';

revoke all on function app.get_playable_ref(uuid) from public, anon;
grant execute on function app.get_playable_ref(uuid) to authenticated;
