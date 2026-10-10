-- A33: video da aula (ADR 0002, decisoes 2 e 3; ticket #19).
--
--   app_private.parse_video_ref(text) -> (provider, external_ref)
--     Normaliza ID ou URL do YouTube / Panda. Valida apenas o FORMATO (nunca
--     a existencia do video). Mesmas regras de backend/contracts/videoRef.ts;
--     o teste de paridade a33 roda a tabela de casos compartilhada nos dois.
--
--   app.staff_set_lesson_video(lesson, expected_updated_at, input) -> jsonb
--     { provider, external_ref, duplicates: [{course_title, lesson_title}] }
--     Define ou substitui o video ativo da aula numa unica transacao: o ativo
--     anterior vira historico inativo (migracao de provedor por aula, A5) e o
--     novo entra ativo, nunca dois ativos. Reaplicar o video ja ativo e no-op.
--     Usar o mesmo video em outra aula e permitido; os titulos das outras
--     aulas voltam em `duplicates` (so a equipe chama esta RPC).
--
-- Erros (mesmo contrato de A31/A32): MESSAGE = HINT = codigo estavel.
--   forbidden     42501  (antes de procurar o alvo: nao vaza ids)
--   invalid_input 22023  (formato nao reconhecido, entradas nulas)
--   not_found     P0002
--   stale_target  CR001  (updated_at da aula divergente)
--
-- A referencia do video nunca chega a clientes que nao sao equipe: lesson_assets
-- continua sem policy e sem grant; esta RPC e SECURITY DEFINER e so retorna o
-- video que acabou de gravar.
--
-- Portao de publicacao: definir/substituir nunca remove o video de uma aula,
-- entao nao o quebra. A remocao (e o portao completo) pertence ao ticket #20.

-- Parser ---------------------------------------------------------------------
create function app_private.parse_video_ref(p_input text)
returns table (provider text, external_ref text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  c_youtube_id constant text := '^[A-Za-z0-9_-]{11}$';
  c_youtube_url constant text :=
    '^(?:https?://)?(?:www\.)?(?:youtube\.com/(?:watch\?v=|embed/)|youtu\.be/)([A-Za-z0-9_-]{11})(?:[?&#][^\r\n]*)?$';
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_panda_embed constant text := 'pandavideo\.com\.br/embed/?\?(?:[^\r\n]*&)?v=([0-9a-f-]{36})';
  v_text text := btrim(p_input, E' \t\r\n');
  v_match text[];
begin
  if v_text is null then
    return;
  end if;

  v_match := regexp_match(v_text, c_youtube_url);
  if v_match is not null then
    return query select 'youtube'::text, v_match[1];
    return;
  end if;
  if v_text ~ c_youtube_id then
    return query select 'youtube'::text, v_text;
    return;
  end if;

  v_match := regexp_match(v_text, c_panda_embed, 'i');
  if v_match is not null and v_match[1] ~* c_uuid then
    return query select 'panda'::text, lower(v_match[1]);
    return;
  end if;
  if v_text ~* c_uuid then
    return query select 'panda'::text, lower(v_text);
  end if;
end;
$$;

revoke all on function app_private.parse_video_ref(text) from public, anon, authenticated;

-- staff_set_lesson_video -----------------------------------------------------
create function app.staff_set_lesson_video(
  p_lesson_id uuid,
  p_expected_updated_at timestamptz,
  p_video_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_duplicates constant int := 20;
  v_provider text;
  v_external_ref text;
  v_duplicates jsonb;
begin
  perform app_private.assert_staff();
  if p_lesson_id is null or p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;

  select p.provider, p.external_ref into v_provider, v_external_ref
  from app_private.parse_video_ref(p_video_input) p;
  if v_provider is null then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;

  perform app_private.lock_course_of_lesson(p_lesson_id);
  perform app_private.assert_lesson_fresh(p_lesson_id, p_expected_updated_at);

  if not exists (
    select 1 from app_private.lesson_assets la
    where la.lesson_id = p_lesson_id and la.is_active
      and la.provider = v_provider and la.external_ref = v_external_ref
  ) then
    -- Desativa antes de inserir: o indice parcial de A5 nao e deferrable.
    update app_private.lesson_assets la
    set is_active = false
    where la.lesson_id = p_lesson_id and la.is_active;

    insert into app_private.lesson_assets (lesson_id, provider, external_ref, is_active)
    values (p_lesson_id, v_provider, v_external_ref, true);

    -- O video faz parte da aula: invalida tokens de edicao concorrentes.
    update public.lessons l set title = l.title where l.id = p_lesson_id;
  end if;

  select coalesce(jsonb_agg(d.entry order by d.sort_key), '[]'::jsonb) into v_duplicates
  from (
    select jsonb_build_object('course_title', c.title, 'lesson_title', l.title) as entry,
           c.title || '/' || lpad(m.position::text, 6, '0') || '/' || lpad(l.position::text, 6, '0') as sort_key
    from app_private.lesson_assets la
    join public.lessons l on l.id = la.lesson_id
    join public.modules m on m.id = l.module_id
    join public.courses c on c.id = l.course_id
    where la.is_active
      and la.provider = v_provider
      and la.external_ref = v_external_ref
      and la.lesson_id <> p_lesson_id
    order by sort_key
    limit c_max_duplicates
  ) d;

  return jsonb_build_object(
    'provider', v_provider,
    'external_ref', v_external_ref,
    'duplicates', v_duplicates
  );
end;
$$;

comment on function app.staff_set_lesson_video(uuid, timestamptz, text) is
  'Define ou substitui o video ativo da aula a partir de ID ou URL (YouTube/Panda), validando so o formato. O ativo anterior vira historico inativo na mesma transacao; reaplicar o mesmo video e no-op. Retorna {provider, external_ref, duplicates[{course_title, lesson_title}]}: o mesmo video em outras aulas e permitido, so avisado. Erros: forbidden 42501, invalid_input 22023, not_found P0002, stale_target CR001.';

revoke all on function app.staff_set_lesson_video(uuid, timestamptz, text) from public, anon;
grant execute on function app.staff_set_lesson_video(uuid, timestamptz, text) to authenticated;
