-- A31: gestao de modulos pela equipe (ADR 0002, decisoes 2, 3 e 5; ticket #17).
--
-- RPCs SECURITY DEFINER em app.*, chamadas direto pelo PostgREST:
--   staff_add_module(course, title)          -> id do novo modulo (ao fim)
--   staff_rename_module(module, title)
--   staff_reorder_modules(course, ids[])     -> lista COMPLETA (arquivados inclusos)
--   staff_set_module_archived(module, bool)  -> arquivar/desarquivar
--   staff_delete_module(module)
--
-- Formato de erro (mesmo contrato de A19/A28/A30): a MESSAGE da excecao e o
-- codigo estavel, o HINT o repete.
--   forbidden         -> 42501  (checado ANTES de procurar o alvo: nao vaza ids)
--   invalid_input     -> 22023
--   not_found         -> P0002
--   stale_target      -> CR001  (lista de reordenacao desatualizada)
--   module_not_empty  -> CR002  (modulo com aulas, arquivadas inclusas)
--   course_has_sales  -> CR003  (curso com matricula ou pedido, de qualquer status)
--
-- Concorrencia: toda operacao trava a linha do curso (FOR UPDATE), serializando
-- escritas na arvore do mesmo curso. As posicoes sao densas (1..N) e a unique
-- (course_id, position) e DEFERRABLE INITIALLY DEFERRED (A25), entao reordenar
-- e compactar rodam em um unico UPDATE sem posicao temporaria. Modulos
-- arquivados mantem a posicao.
--
-- Modulos nao tem auditoria propria: ADR 0002, decisao 7, restringe course_audit
-- a preco, duracao, status e exclusao de CURSO.

-- Validacao + autorizacao compartilhadas ------------------------------------
create function app_private.assert_staff()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not app.is_staff() then
    raise exception using errcode = '42501', message = 'forbidden', hint = 'forbidden';
  end if;
end;
$$;

revoke all on function app_private.assert_staff() from public, anon, authenticated;

create function app_private.assert_valid_module_title(p_title text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  c_max_title constant int := 200;
begin
  if p_title is null
     or btrim(p_title, E' \t\r\n') = ''
     or char_length(btrim(p_title, E' \t\r\n')) > c_max_title then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;
end;
$$;

revoke all on function app_private.assert_valid_module_title(text) from public, anon, authenticated;

-- Trava o curso; not_found se nao existe.
create function app_private.lock_course(p_course_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.courses c where c.id = p_course_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'not_found', hint = 'not_found';
  end if;
end;
$$;

revoke all on function app_private.lock_course(uuid) from public, anon, authenticated;

-- Resolve o curso do modulo e o trava; not_found se o modulo nao existe.
create function app_private.lock_course_of_module(p_module_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_course_id uuid;
begin
  select m.course_id into v_course_id from public.modules m where m.id = p_module_id;
  if v_course_id is null then
    raise exception using errcode = 'P0002', message = 'not_found', hint = 'not_found';
  end if;
  perform app_private.lock_course(v_course_id);
  -- Relê sob o lock: outra transacao pode ter excluido o modulo entre a leitura
  -- e o lock; sem isso rename/archive/delete virariam no-op silencioso.
  if not exists (select 1 from public.modules m where m.id = p_module_id) then
    raise exception using errcode = 'P0002', message = 'not_found', hint = 'not_found';
  end if;
  return v_course_id;
end;
$$;

revoke all on function app_private.lock_course_of_module(uuid) from public, anon, authenticated;

-- staff_add_module ---------------------------------------------------------
create function app.staff_add_module(p_course_id uuid, p_title text)
returns table (id uuid, "position" integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.assert_staff();
  if p_course_id is null then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;
  perform app_private.assert_valid_module_title(p_title);
  perform app_private.lock_course(p_course_id);

  return query
  insert into public.modules as m (course_id, title, position)
  select p_course_id, btrim(p_title, E' \t\r\n'), coalesce(max(x.position), 0) + 1
  from public.modules x
  where x.course_id = p_course_id
  returning m.id, m.position;
end;
$$;

comment on function app.staff_add_module(uuid, text) is
  'Acrescenta modulo ao fim do curso (equipe ativa). Erros: message = codigo estavel (forbidden 42501, invalid_input 22023, not_found P0002).';

-- staff_rename_module ------------------------------------------------------
create function app.staff_rename_module(p_module_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.assert_staff();
  if p_module_id is null then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;
  perform app_private.assert_valid_module_title(p_title);
  perform app_private.lock_course_of_module(p_module_id);

  update public.modules m
  set title = btrim(p_title, E' \t\r\n')
  where m.id = p_module_id;
end;
$$;

comment on function app.staff_rename_module(uuid, text) is
  'Renomeia modulo (equipe ativa). Erros: forbidden 42501, invalid_input 22023, not_found P0002.';

-- staff_reorder_modules ----------------------------------------------------
create function app.staff_reorder_modules(p_course_id uuid, p_module_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected uuid[];
begin
  perform app_private.assert_staff();
  if p_course_id is null or p_module_ids is null or array_position(p_module_ids, null) is not null
     or cardinality(p_module_ids) <> (select count(distinct x) from unnest(p_module_ids) as x) then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;
  perform app_private.lock_course(p_course_id);

  select coalesce(array_agg(m.id order by m.id), '{}') into v_expected
  from public.modules m
  where m.course_id = p_course_id;

  -- A lista tem de ser exatamente o conjunto atual (arquivados inclusos);
  -- modulo criado/excluido por outra pessoa desde a leitura -> stale_target.
  if v_expected is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(p_module_ids) as x) then
    raise exception using errcode = 'CR001', message = 'stale_target', hint = 'stale_target';
  end if;

  update public.modules m
  set position = o.new_position
  from unnest(p_module_ids) with ordinality as o(module_id, new_position)
  where m.id = o.module_id
    and m.position <> o.new_position;
end;
$$;

comment on function app.staff_reorder_modules(uuid, uuid[]) is
  'Regrava as posicoes a partir da lista completa e ordenada de ids (arquivados inclusos), numa transacao. Lista que nao bate com o conjunto atual -> stale_target. Erros: forbidden 42501, invalid_input 22023, not_found P0002, stale_target CR001.';

-- staff_set_module_archived ------------------------------------------------
create function app.staff_set_module_archived(p_module_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.assert_staff();
  if p_module_id is null or p_archived is null then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;
  perform app_private.lock_course_of_module(p_module_id);

  update public.modules m
  set archived_at = case
        when p_archived then coalesce(m.archived_at, now())
        else null
      end
  where m.id = p_module_id;
end;
$$;

comment on function app.staff_set_module_archived(uuid, boolean) is
  'Arquiva (p_archived = true) ou desarquiva o modulo; idempotente; a posicao e preservada. Erros: forbidden 42501, invalid_input 22023, not_found P0002.';

-- staff_delete_module ------------------------------------------------------
create function app.staff_delete_module(p_module_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course_id uuid;
begin
  perform app_private.assert_staff();
  if p_module_id is null then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;
  v_course_id := app_private.lock_course_of_module(p_module_id);

  -- Vendas primeiro: com historico financeiro so se arquiva (ADR 0002, decisao 5).
  if exists (select 1 from public.enrollments e where e.course_id = v_course_id)
     or exists (select 1 from public.orders o where o.course_id = v_course_id) then
    raise exception using errcode = 'CR003', message = 'course_has_sales', hint = 'course_has_sales';
  end if;

  if exists (select 1 from public.lessons l where l.module_id = p_module_id) then
    raise exception using errcode = 'CR002', message = 'module_not_empty', hint = 'module_not_empty';
  end if;

  delete from public.modules m where m.id = p_module_id;

  -- Mantem as posicoes densas (1..N), preservando a ordem relativa.
  update public.modules m
  set position = r.new_position
  from (
    select x.id, (row_number() over (order by x.position))::integer as new_position
    from public.modules x
    where x.course_id = v_course_id
  ) r
  where m.id = r.id
    and m.position <> r.new_position;
end;
$$;

comment on function app.staff_delete_module(uuid) is
  'Exclui modulo vazio de curso sem matriculas nem pedidos (qualquer status) e compacta as posicoes. Erros: forbidden 42501, invalid_input 22023, not_found P0002, module_not_empty CR002, course_has_sales CR003.';

-- Grants -------------------------------------------------------------------
revoke all on function app.staff_add_module(uuid, text) from public, anon;
revoke all on function app.staff_rename_module(uuid, text) from public, anon;
revoke all on function app.staff_reorder_modules(uuid, uuid[]) from public, anon;
revoke all on function app.staff_set_module_archived(uuid, boolean) from public, anon;
revoke all on function app.staff_delete_module(uuid) from public, anon;
grant execute on function app.staff_add_module(uuid, text) to authenticated;
grant execute on function app.staff_rename_module(uuid, text) to authenticated;
grant execute on function app.staff_reorder_modules(uuid, uuid[]) to authenticated;
grant execute on function app.staff_set_module_archived(uuid, boolean) to authenticated;
grant execute on function app.staff_delete_module(uuid) to authenticated;
