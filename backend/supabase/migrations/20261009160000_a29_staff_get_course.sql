-- A29: app.staff_get_course(uuid) -- arvore completa de um curso para a equipe
-- (ADR 0002, decisao 3; ticket #15).
--
-- Retorna jsonb: curso + modulos (por position) + aulas (por position) + video
-- ATIVO por aula (ou null). Inclui modulos e aulas arquivados (a equipe os ve,
-- marcados por archived_at). E o unico caminho pelo qual o cliente le
-- app_private.lesson_assets, e so para equipe ativa (app.is_staff()).
--
-- Formato de erro (mesmo contrato de A28): a MESSAGE da excecao e o codigo
-- estavel, o HINT o repete. Nao-equipe: 'forbidden' (42501), checado ANTES de
-- procurar o curso, para nao vazar existencia de ids. Curso inexistente (ou id
-- nulo) para equipe: 'not_found' (P0002).

create function app.staff_get_course(p_course_id uuid)
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
