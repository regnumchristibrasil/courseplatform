-- A34: transicoes de status, portao de publicacao e exclusao de curso (ADR 0002,
-- decisoes 5, 6 e 7; ticket #20).
--
--   staff_set_course_status(course, expected_updated_at, status) -> id, updated_at, previous_status
--   staff_delete_course(course, expected_updated_at)
--
-- Formato de erro (mesmo contrato de A30-A33): a MESSAGE da excecao e o codigo
-- estavel, o HINT o repete.
--   forbidden             -> 42501
--   invalid_input         -> 22023  (status desconhecido ou nulo)
--   not_found             -> P0002
--   stale_target          -> CR001
--   course_has_sales      -> CR003  (exclusao de curso com matricula ou pedido)
--   publish_gate_violated -> CR004  (DETAIL = array JSON de violacoes)
--   invalid_transition    -> CR005  (fora da tabela de transicoes, inclusive status igual)
--
-- Portao (ADR 0002, decisao 6): preco definido, ao menos uma aula ATIVA e toda
-- aula ativa com video ativo. Aula ativa = aula nao arquivada em modulo nao
-- arquivado (itens arquivados nao contam).
--
-- Violacoes (DETAIL): [{"code":"price_missing"}, {"code":"no_active_lesson"},
-- {"code":"lesson_without_video","lessonId":"<uuid>"}, ...] nessa ordem; as de
-- video seguem a ordem modulo/aula da arvore.
--
-- Um curso PUBLICADO nunca pode ficar fora do portao: as RPCs de arvore
-- (aula: adicionar, arquivar, mover, excluir; modulo: arquivar) revalidam o portao
-- no fim, sob o lock do curso, e a transacao inteira e desfeita se violado.
-- O preco ja e coberto por courses_published_requires_price (A30).
--
-- Auditoria: status_changed (old/new status) e deleted (old = ultimo status).

-- Portao -----------------------------------------------------------------------
create function app_private.course_gate_violations(p_course_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(v.item order by v.ord, v.module_position, v.lesson_position), '[]'::jsonb)
  from (
    select 1 as ord, 0 as module_position, 0 as lesson_position,
           jsonb_build_object('code', 'price_missing') as item
    from public.courses c
    where c.id = p_course_id and c.price_cents is null
    union all
    select 2, 0, 0, jsonb_build_object('code', 'no_active_lesson')
    where not exists (
      select 1
      from public.lessons l
      join public.modules m on m.id = l.module_id
      where l.course_id = p_course_id and l.archived_at is null and m.archived_at is null
    )
    union all
    select 3, m.position, l.position,
           jsonb_build_object('code', 'lesson_without_video', 'lessonId', l.id)
    from public.lessons l
    join public.modules m on m.id = l.module_id
    where l.course_id = p_course_id and l.archived_at is null and m.archived_at is null
      and not exists (
        select 1 from app_private.lesson_assets la
        where la.lesson_id = l.id and la.is_active
      )
  ) v;
$$;

revoke all on function app_private.course_gate_violations(uuid) from public, anon, authenticated;

create function app_private.raise_publish_gate_violations(p_violations jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'CR004',
    message = 'publish_gate_violated',
    hint = 'publish_gate_violated',
    detail = p_violations::text;
end;
$$;

revoke all on function app_private.raise_publish_gate_violations(jsonb) from public, anon, authenticated;

-- Curso publicado fora do portao -> CR004 com a lista. Chamar sob o lock do curso.
create function app_private.enforce_publish_gate(p_course_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_violations jsonb;
begin
  if not app_private.course_is_published(p_course_id) then
    return;
  end if;
  v_violations := app_private.course_gate_violations(p_course_id);
  if jsonb_array_length(v_violations) > 0 then
    perform app_private.raise_publish_gate_violations(v_violations);
  end if;
end;
$$;

revoke all on function app_private.enforce_publish_gate(uuid) from public, anon, authenticated;

-- staff_set_course_status ---------------------------------------------------------
create function app.staff_set_course_status(
  p_course_id uuid,
  p_expected_updated_at timestamptz,
  p_status text
)
returns table (id uuid, updated_at timestamptz, previous_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_course public.courses;
  v_violations jsonb;
  v_updated_at timestamptz;
begin
  perform app_private.assert_staff();
  if p_course_id is null or p_expected_updated_at is null
     or p_status is null or p_status not in ('draft', 'published', 'archived') then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;

  perform app_private.lock_course(p_course_id);
  select * into v_course from public.courses c where c.id = p_course_id;

  if v_course.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'CR001', message = 'stale_target', hint = 'stale_target';
  end if;

  if (v_course.status, p_status) not in (
    ('draft', 'published'), ('published', 'draft'), ('published', 'archived'), ('archived', 'draft')
  ) then
    raise exception using errcode = 'CR005', message = 'invalid_transition', hint = 'invalid_transition';
  end if;

  if p_status = 'published' then
    v_violations := app_private.course_gate_violations(p_course_id);
    if jsonb_array_length(v_violations) > 0 then
      perform app_private.raise_publish_gate_violations(v_violations);
    end if;
  end if;

  update public.courses c set status = p_status
  where c.id = p_course_id
  returning c.updated_at into v_updated_at;

  insert into app_private.course_audit (course_id, actor_id, action, old_value, new_value)
  values (p_course_id, v_actor, 'status_changed', v_course.status, p_status);

  return query select p_course_id, v_updated_at, v_course.status;
end;
$$;

comment on function app.staff_set_course_status(uuid, timestamptz, text) is
  'Muda o status do curso (equipe ativa) so por rascunho->publicado, publicado->rascunho, publicado->arquivado e arquivado->rascunho. Publicar exige o portao (DETAIL em JSON). Locking otimista por updated_at; audita status_changed. Erros: forbidden 42501, invalid_input 22023, not_found P0002, stale_target CR001, publish_gate_violated CR004, invalid_transition CR005.';

-- staff_delete_course -----------------------------------------------------------------
create function app.staff_delete_course(p_course_id uuid, p_expected_updated_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course public.courses;
begin
  perform app_private.assert_staff();
  if p_course_id is null or p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;

  perform app_private.lock_course(p_course_id);
  select * into v_course from public.courses c where c.id = p_course_id;

  -- Vendas primeiro: com historico financeiro so se arquiva (ADR 0002, decisao 5).
  if exists (select 1 from public.enrollments e where e.course_id = p_course_id)
     or exists (select 1 from public.orders o where o.course_id = p_course_id) then
    raise exception using errcode = 'CR003', message = 'course_has_sales', hint = 'course_has_sales';
  end if;

  if v_course.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'CR001', message = 'stale_target', hint = 'stale_target';
  end if;

  insert into app_private.course_audit (course_id, actor_id, action, old_value, new_value)
  values (p_course_id, auth.uid(), 'deleted', v_course.status, null);

  delete from public.courses c where c.id = p_course_id;
end;
$$;

comment on function app.staff_delete_course(uuid, timestamptz) is
  'Exclui curso (com modulos, aulas e videos em cascata) sem matriculas nem pedidos, em qualquer status. Audita deleted com o ultimo status. Erros: forbidden 42501, invalid_input 22023, not_found P0002, stale_target CR001, course_has_sales CR003.';

revoke all on function app.staff_set_course_status(uuid, timestamptz, text) from public, anon;
revoke all on function app.staff_delete_course(uuid, timestamptz) from public, anon;
grant execute on function app.staff_set_course_status(uuid, timestamptz, text) to authenticated;
grant execute on function app.staff_delete_course(uuid, timestamptz) to authenticated;

-- Revalidacao do portao nas RPCs de arvore (create or replace; grants preservados) ---
create or replace function app.staff_add_lesson(
  p_module_id uuid,
  p_title text,
  p_duration_seconds integer,
  p_is_free_preview boolean,
  p_archived boolean default false
)
returns table (id uuid, "position" integer, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course_id uuid;
begin
  perform app_private.assert_staff();
  if p_module_id is null or p_archived is null then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;
  perform app_private.assert_valid_lesson_fields(p_title, p_duration_seconds, p_is_free_preview);

  select m.course_id into v_course_id from public.modules m where m.id = p_module_id;
  if v_course_id is null then
    raise exception using errcode = 'P0002', message = 'not_found', hint = 'not_found';
  end if;
  perform app_private.lock_course(v_course_id);
  if not exists (select 1 from public.modules m where m.id = p_module_id) then
    raise exception using errcode = 'P0002', message = 'not_found', hint = 'not_found';
  end if;

  return query
  insert into public.lessons as l (course_id, module_id, title, duration_seconds, is_free_preview, position, archived_at)
  select v_course_id, p_module_id, btrim(p_title, E' \t\r\n'), p_duration_seconds, p_is_free_preview,
         coalesce(max(x.position), 0) + 1,
         case when p_archived then now() else null end
  from public.lessons x
  where x.module_id = p_module_id
  returning l.id, l.position, l.updated_at;

  -- Aula nova nunca tem video: ativa em curso publicado quebra o portao.
  perform app_private.enforce_publish_gate(v_course_id);
end;
$$;

comment on function app.staff_add_lesson(uuid, text, integer, boolean, boolean) is
  'Acrescenta aula ao fim do modulo (equipe ativa); p_archived cria ja arquivada. Aula ativa em curso publicado -> publish_gate_violated (nova aula nao tem video; DETAIL traz as violacoes em JSON). Erros: forbidden 42501, invalid_input 22023, not_found P0002, publish_gate_violated CR004.';

create or replace function app.staff_set_lesson_archived(
  p_lesson_id uuid,
  p_expected_updated_at timestamptz,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course_id uuid;
begin
  perform app_private.assert_staff();
  if p_lesson_id is null or p_expected_updated_at is null or p_archived is null then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;
  v_course_id := app_private.lock_course_of_lesson(p_lesson_id);
  perform app_private.assert_lesson_fresh(p_lesson_id, p_expected_updated_at);

  update public.lessons l
  set archived_at = case
        when p_archived then coalesce(l.archived_at, now())
        else null
      end
  where l.id = p_lesson_id;

  perform app_private.enforce_publish_gate(v_course_id);
end;
$$;

comment on function app.staff_set_lesson_archived(uuid, timestamptz, boolean) is
  'Arquiva (p_archived = true) ou desarquiva a aula; a posicao e preservada. Arquivar a ultima aula ativa, ou desarquivar uma sem video, em curso publicado -> publish_gate_violated (DETAIL em JSON). Erros: forbidden 42501, invalid_input 22023, not_found P0002, stale_target CR001, publish_gate_violated CR004.';

create or replace function app.staff_move_lesson(
  p_lesson_id uuid,
  p_expected_updated_at timestamptz,
  p_target_module_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course_id uuid;
  v_source_module_id uuid;
  v_target_course_id uuid;
begin
  perform app_private.assert_staff();
  if p_lesson_id is null or p_expected_updated_at is null or p_target_module_id is null then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;
  v_course_id := app_private.lock_course_of_lesson(p_lesson_id);

  select m.course_id into v_target_course_id from public.modules m where m.id = p_target_module_id;
  if v_target_course_id is null then
    raise exception using errcode = 'P0002', message = 'not_found', hint = 'not_found';
  end if;
  -- Entre cursos e impossivel (a FK composta tambem garante); mesmo modulo nao e movimento.
  if v_target_course_id <> v_course_id then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;

  select l.module_id into v_source_module_id from public.lessons l where l.id = p_lesson_id;
  if v_source_module_id = p_target_module_id then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;

  perform app_private.assert_lesson_fresh(p_lesson_id, p_expected_updated_at);

  update public.lessons l
  set module_id = p_target_module_id,
      position = (select coalesce(max(x.position), 0) + 1 from public.lessons x where x.module_id = p_target_module_id)
  where l.id = p_lesson_id;

  perform app_private.compact_lesson_positions(v_source_module_id);

  perform app_private.enforce_publish_gate(v_course_id);
end;
$$;

comment on function app.staff_move_lesson(uuid, timestamptz, uuid) is
  'Move a aula para o fim de outro modulo do MESMO curso e compacta o modulo de origem. Locking otimista por updated_at. Mover para modulo arquivado pode deixar curso publicado sem aula ativa -> publish_gate_violated. Erros: forbidden 42501, invalid_input 22023 (outro curso ou mesmo modulo), not_found P0002, stale_target CR001.';

create or replace function app.staff_delete_lesson(p_lesson_id uuid, p_expected_updated_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course_id uuid;
  v_module_id uuid;
begin
  perform app_private.assert_staff();
  if p_lesson_id is null or p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;
  v_course_id := app_private.lock_course_of_lesson(p_lesson_id);

  -- Vendas primeiro: com historico financeiro so se arquiva (ADR 0002, decisao 5).
  if exists (select 1 from public.enrollments e where e.course_id = v_course_id)
     or exists (select 1 from public.orders o where o.course_id = v_course_id) then
    raise exception using errcode = 'CR003', message = 'course_has_sales', hint = 'course_has_sales';
  end if;

  perform app_private.assert_lesson_fresh(p_lesson_id, p_expected_updated_at);

  delete from public.lessons l where l.id = p_lesson_id returning l.module_id into v_module_id;
  perform app_private.compact_lesson_positions(v_module_id);

  perform app_private.enforce_publish_gate(v_course_id);
end;
$$;

comment on function app.staff_delete_lesson(uuid, timestamptz) is
  'Exclui aula (e seus assets, em cascata) de curso sem matriculas nem pedidos e compacta as posicoes do modulo. Excluir a ultima aula ativa de curso publicado -> publish_gate_violated (curso sem vendas). Erros: forbidden 42501, invalid_input 22023, not_found P0002, stale_target CR001, course_has_sales CR003.';

create or replace function app.staff_set_module_archived(p_module_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course_id uuid;
begin
  perform app_private.assert_staff();
  if p_module_id is null or p_archived is null then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;
  v_course_id := app_private.lock_course_of_module(p_module_id);

  update public.modules m
  set archived_at = case
        when p_archived then coalesce(m.archived_at, now())
        else null
      end
  where m.id = p_module_id;

  perform app_private.enforce_publish_gate(v_course_id);
end;
$$;

comment on function app.staff_set_module_archived(uuid, boolean) is
  'Arquiva (p_archived = true) ou desarquiva o modulo; idempotente; a posicao e preservada. Em curso publicado, arquivar o modulo da ultima aula ativa (ou desarquivar um com aula sem video) -> publish_gate_violated CR004. Erros: forbidden 42501, invalid_input 22023, not_found P0002, publish_gate_violated CR004.';
