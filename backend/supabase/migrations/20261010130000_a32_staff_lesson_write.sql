-- A32: gestao de aulas pela equipe (ADR 0002, decisoes 2, 3, 5 e 6; ticket #18).
--
-- RPCs SECURITY DEFINER em app.*, chamadas direto pelo PostgREST:
--   staff_add_lesson(module, title, duration, free_preview, archived) -> id, position, updated_at
--   staff_update_lesson(lesson, expected_updated_at, title, duration, free_preview)
--   staff_reorder_lessons(module, ids[])      -> lista COMPLETA do modulo (arquivadas inclusas)
--   staff_move_lesson(lesson, expected_updated_at, target_module)  -> vai para o fim do destino
--   staff_set_lesson_archived(lesson, expected_updated_at, bool)
--   staff_delete_lesson(lesson, expected_updated_at)
--
-- Formato de erro (mesmo contrato de A31): a MESSAGE da excecao e o codigo
-- estavel, o HINT o repete.
--   forbidden             -> 42501  (checado ANTES de procurar o alvo: nao vaza ids)
--   invalid_input         -> 22023  (inclui mover para modulo de outro curso)
--   not_found             -> P0002
--   stale_target          -> CR001  (updated_at da aula divergente, ou lista de reordenacao antiga)
--   course_has_sales      -> CR003  (curso com matricula ou pedido: so arquivar)
--   publish_gate_violated -> CR004  (aula ativa sem video em curso publicado)
--
-- Locking otimista por aula: operacoes sobre UMA aula recebem o updated_at lido
-- pelo cliente. Reordenar, mover e excluir mudam updated_at das aulas que trocam de
-- posicao (trigger), o que invalida edicoes concorrentes sobre elas: a posicao
-- tambem e conteudo, e a UI relê a arvore em stale_target.
-- Concorrencia: toda operacao trava a linha do curso (FOR UPDATE, A31), entao a
-- comparacao de updated_at e a escrita sao serializadas.
--
-- Portao de publicacao (ADR 0002, decisao 6): este ticket aplica apenas o que o
-- escopo de aulas exige - aula ATIVA nova ou desarquivada em curso publicado
-- precisa de video ativo (criar ja arquivada e o caminho para preparar a aula).
-- O portao completo (preco, ao menos uma aula ativa, remover o ultimo video)
-- pertence ao ticket #20.
--
-- Aulas nao tem auditoria propria: ADR 0002, decisao 7.

-- Validacao ------------------------------------------------------------------
create function app_private.assert_valid_lesson_fields(
  p_title text,
  p_duration_seconds integer,
  p_is_free_preview boolean
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  c_max_title constant int := 200;
  c_max_duration_seconds constant int := 86400;
begin
  if p_title is null
     or btrim(p_title, E' \t\r\n') = ''
     or char_length(btrim(p_title, E' \t\r\n')) > c_max_title
     or p_is_free_preview is null
     or (p_duration_seconds is not null
         and (p_duration_seconds < 1 or p_duration_seconds > c_max_duration_seconds)) then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;
end;
$$;

revoke all on function app_private.assert_valid_lesson_fields(text, integer, boolean) from public, anon, authenticated;

-- Resolve o curso da aula e o trava; not_found se a aula nao existe.
create function app_private.lock_course_of_lesson(p_lesson_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_course_id uuid;
begin
  select l.course_id into v_course_id from public.lessons l where l.id = p_lesson_id;
  if v_course_id is null then
    raise exception using errcode = 'P0002', message = 'not_found', hint = 'not_found';
  end if;
  perform app_private.lock_course(v_course_id);
  -- Relê sob o lock: a aula pode ter sido excluida entre a leitura e o lock.
  if not exists (select 1 from public.lessons l where l.id = p_lesson_id) then
    raise exception using errcode = 'P0002', message = 'not_found', hint = 'not_found';
  end if;
  return v_course_id;
end;
$$;

revoke all on function app_private.lock_course_of_lesson(uuid) from public, anon, authenticated;

-- Aula editada por outra pessoa desde a leitura -> stale_target. Chamar sob o lock.
create function app_private.assert_lesson_fresh(p_lesson_id uuid, p_expected_updated_at timestamptz)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.lessons l
    where l.id = p_lesson_id and l.updated_at = p_expected_updated_at
  ) then
    raise exception using errcode = 'CR001', message = 'stale_target', hint = 'stale_target';
  end if;
end;
$$;

revoke all on function app_private.assert_lesson_fresh(uuid, timestamptz) from public, anon, authenticated;

create function app_private.course_is_published(p_course_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.courses c where c.id = p_course_id and c.status = 'published');
$$;

revoke all on function app_private.course_is_published(uuid) from public, anon, authenticated;

create function app_private.raise_publish_gate_violated()
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'CR004', message = 'publish_gate_violated', hint = 'publish_gate_violated';
end;
$$;

revoke all on function app_private.raise_publish_gate_violated() from public, anon, authenticated;

-- Compacta as posicoes de um modulo em 1..N preservando a ordem relativa.
create function app_private.compact_lesson_positions(p_module_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.lessons l
  set position = r.new_position
  from (
    select x.id, (row_number() over (order by x.position))::integer as new_position
    from public.lessons x
    where x.module_id = p_module_id
  ) r
  where l.id = r.id
    and l.position <> r.new_position;
$$;

revoke all on function app_private.compact_lesson_positions(uuid) from public, anon, authenticated;

-- staff_add_lesson -----------------------------------------------------------
create function app.staff_add_lesson(
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

  -- Aula nova nunca tem video (o video entra por RPC propria): ativa em curso
  -- publicado quebraria o portao.
  if not p_archived and app_private.course_is_published(v_course_id) then
    perform app_private.raise_publish_gate_violated();
  end if;

  return query
  insert into public.lessons as l (course_id, module_id, title, duration_seconds, is_free_preview, position, archived_at)
  select v_course_id, p_module_id, btrim(p_title, E' \t\r\n'), p_duration_seconds, p_is_free_preview,
         coalesce(max(x.position), 0) + 1,
         case when p_archived then now() else null end
  from public.lessons x
  where x.module_id = p_module_id
  returning l.id, l.position, l.updated_at;
end;
$$;

comment on function app.staff_add_lesson(uuid, text, integer, boolean, boolean) is
  'Acrescenta aula ao fim do modulo (equipe ativa); p_archived cria ja arquivada. Aula ativa em curso publicado -> publish_gate_violated (nova aula nao tem video). Erros: forbidden 42501, invalid_input 22023, not_found P0002, publish_gate_violated CR004.';

-- staff_update_lesson --------------------------------------------------------
create function app.staff_update_lesson(
  p_lesson_id uuid,
  p_expected_updated_at timestamptz,
  p_title text,
  p_duration_seconds integer,
  p_is_free_preview boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.assert_staff();
  if p_lesson_id is null or p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;
  perform app_private.assert_valid_lesson_fields(p_title, p_duration_seconds, p_is_free_preview);
  perform app_private.lock_course_of_lesson(p_lesson_id);
  perform app_private.assert_lesson_fresh(p_lesson_id, p_expected_updated_at);

  update public.lessons l
  set title = btrim(p_title, E' \t\r\n'),
      duration_seconds = p_duration_seconds,
      is_free_preview = p_is_free_preview
  where l.id = p_lesson_id;
end;
$$;

comment on function app.staff_update_lesson(uuid, timestamptz, text, integer, boolean) is
  'Substitui titulo, duracao (segundos, opcional) e flag de previa gratuita. Locking otimista por updated_at. Erros: forbidden 42501, invalid_input 22023, not_found P0002, stale_target CR001.';

-- staff_reorder_lessons ------------------------------------------------------
create function app.staff_reorder_lessons(p_module_id uuid, p_lesson_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course_id uuid;
  v_expected uuid[];
begin
  perform app_private.assert_staff();
  if p_module_id is null or p_lesson_ids is null or array_position(p_lesson_ids, null) is not null
     or cardinality(p_lesson_ids) <> (select count(distinct x) from unnest(p_lesson_ids) as x) then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;

  select m.course_id into v_course_id from public.modules m where m.id = p_module_id;
  if v_course_id is null then
    raise exception using errcode = 'P0002', message = 'not_found', hint = 'not_found';
  end if;
  perform app_private.lock_course(v_course_id);
  if not exists (select 1 from public.modules m where m.id = p_module_id) then
    raise exception using errcode = 'P0002', message = 'not_found', hint = 'not_found';
  end if;

  select coalesce(array_agg(l.id order by l.id), '{}') into v_expected
  from public.lessons l
  where l.module_id = p_module_id;

  -- A lista tem de ser exatamente o conjunto atual do modulo (arquivadas
  -- inclusas); aula criada, movida ou excluida por outra pessoa -> stale_target.
  if v_expected is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(p_lesson_ids) as x) then
    raise exception using errcode = 'CR001', message = 'stale_target', hint = 'stale_target';
  end if;

  update public.lessons l
  set position = o.new_position
  from unnest(p_lesson_ids) with ordinality as o(lesson_id, new_position)
  where l.id = o.lesson_id
    and l.position <> o.new_position;
end;
$$;

comment on function app.staff_reorder_lessons(uuid, uuid[]) is
  'Regrava as posicoes das aulas do modulo a partir da lista completa e ordenada de ids (arquivadas inclusas), numa transacao. Lista que nao bate com o conjunto atual -> stale_target. Erros: forbidden 42501, invalid_input 22023, not_found P0002, stale_target CR001.';

-- staff_move_lesson ----------------------------------------------------------
create function app.staff_move_lesson(
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
end;
$$;

comment on function app.staff_move_lesson(uuid, timestamptz, uuid) is
  'Move a aula para o fim de outro modulo do MESMO curso e compacta o modulo de origem. Locking otimista por updated_at. Erros: forbidden 42501, invalid_input 22023 (outro curso ou mesmo modulo), not_found P0002, stale_target CR001.';

-- staff_set_lesson_archived --------------------------------------------------
create function app.staff_set_lesson_archived(
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

  -- Desarquivar torna a aula ativa: em curso publicado exige video ativo.
  if not p_archived
     and app_private.course_is_published(v_course_id)
     and not exists (
       select 1 from app_private.lesson_assets la
       where la.lesson_id = p_lesson_id and la.is_active
     ) then
    perform app_private.raise_publish_gate_violated();
  end if;

  update public.lessons l
  set archived_at = case
        when p_archived then coalesce(l.archived_at, now())
        else null
      end
  where l.id = p_lesson_id;
end;
$$;

comment on function app.staff_set_lesson_archived(uuid, timestamptz, boolean) is
  'Arquiva (p_archived = true) ou desarquiva a aula; a posicao e preservada. Desarquivar sem video ativo em curso publicado -> publish_gate_violated. Erros: forbidden 42501, invalid_input 22023, not_found P0002, stale_target CR001, publish_gate_violated CR004.';

-- staff_delete_lesson --------------------------------------------------------
create function app.staff_delete_lesson(p_lesson_id uuid, p_expected_updated_at timestamptz)
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
end;
$$;

comment on function app.staff_delete_lesson(uuid, timestamptz) is
  'Exclui aula (e seus assets, em cascata) de curso sem matriculas nem pedidos e compacta as posicoes do modulo. Erros: forbidden 42501, invalid_input 22023, not_found P0002, stale_target CR001, course_has_sales CR003.';

-- Grants ---------------------------------------------------------------------
revoke all on function app.staff_add_lesson(uuid, text, integer, boolean, boolean) from public, anon;
revoke all on function app.staff_update_lesson(uuid, timestamptz, text, integer, boolean) from public, anon;
revoke all on function app.staff_reorder_lessons(uuid, uuid[]) from public, anon;
revoke all on function app.staff_move_lesson(uuid, timestamptz, uuid) from public, anon;
revoke all on function app.staff_set_lesson_archived(uuid, timestamptz, boolean) from public, anon;
revoke all on function app.staff_delete_lesson(uuid, timestamptz) from public, anon;
grant execute on function app.staff_add_lesson(uuid, text, integer, boolean, boolean) to authenticated;
grant execute on function app.staff_update_lesson(uuid, timestamptz, text, integer, boolean) to authenticated;
grant execute on function app.staff_reorder_lessons(uuid, uuid[]) to authenticated;
grant execute on function app.staff_move_lesson(uuid, timestamptz, uuid) to authenticated;
grant execute on function app.staff_set_lesson_archived(uuid, timestamptz, boolean) to authenticated;
grant execute on function app.staff_delete_lesson(uuid, timestamptz) to authenticated;

-- staff_get_course: aulas passam a expor updated_at (token do locking otimista) --
-- (corpo identico ao de A29, mais lessons[].updated_at)
create or replace function app.staff_get_course(p_course_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not app.is_staff() then
    raise exception using errcode = '42501', message = 'forbidden', hint = 'forbidden';
  end if;

  select jsonb_build_object(
    'id', c.id,
    'title', c.title,
    'description', c.description,
    'status', c.status,
    'price_cents', c.price_cents,
    'access_duration_days', c.access_duration_days,
    'created_at', c.created_at,
    'updated_at', c.updated_at,
    'enrollment_count', (
      select count(*) from public.enrollments e
      where e.course_id = c.id and e.status = 'active'
        and (e.expires_at is null or e.expires_at > now())
    ),
    'pending_order_count', (
      select count(*) from public.orders o
      where o.course_id = c.id and o.status = 'pending'
        and (o.expires_at is null or o.expires_at > now())
    ),
    'modules', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'title', m.title,
          'position', m.position,
          'archived_at', m.archived_at,
          'lessons', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', l.id,
                'title', l.title,
                'position', l.position,
                'duration_seconds', l.duration_seconds,
                'is_free_preview', l.is_free_preview,
                'archived_at', l.archived_at,
                'updated_at', l.updated_at,
                'video', (
                  select jsonb_build_object('provider', la.provider, 'external_ref', la.external_ref)
                  from app_private.lesson_assets la
                  where la.lesson_id = l.id and la.is_active
                )
              )
              order by l.position
            )
            from public.lessons l
            where l.module_id = m.id
          ), '[]'::jsonb)
        )
        order by m.position
      )
      from public.modules m
      where m.course_id = c.id
    ), '[]'::jsonb)
  )
  into v_result
  from public.courses c
  where c.id = p_course_id;

  if v_result is null then
    raise exception using errcode = 'P0002', message = 'not_found', hint = 'not_found';
  end if;

  return v_result;
end;
$$;

comment on function app.staff_get_course(uuid) is
  'Arvore do curso (modulos, aulas e video ativo por aula, incluindo arquivados) para equipe ativa. Erros: message = codigo estavel (forbidden 42501, not_found P0002). Unico caminho de leitura de lesson_assets pelo cliente alem de get_playable_ref.';

revoke all on function app.staff_get_course(uuid) from public, anon;
grant execute on function app.staff_get_course(uuid) to authenticated;
