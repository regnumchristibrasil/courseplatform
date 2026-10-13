-- A39: public.lesson_comments, app.list_lesson_comments e
-- app.create_lesson_comment (ticket #27; ADR 0004).
--
-- * lesson_comments: comentario de primeiro nivel por aula. RLS ligado e
--   NENHUMA policy nem grant ao cliente; acesso so por RPCs SECURITY DEFINER
--   (decisao 3). Respostas e exclusao logica entram no ticket #28.
-- * Participam (leem e escrevem) apenas aluno com matricula valida em aula e
--   modulo ativos e a equipe (decisao 4). Escrita sem direito = erro
--   'forbidden' (42501); leitura sem direito = zero linhas, nunca erro.
-- * Autor projetado como primeiro nome + indicador de equipe; sem e-mail nem
--   user_id. Sem nome cadastrado, o rotulo generico 'Aluno'.
-- * Texto simples, 1 a 2.000 caracteres apos trim ('invalid_input').
-- * Limite: 10 criacoes por usuario no ultimo minuto, contado nas proprias
--   linhas (sem filtrar por estado); equipe isenta; erro 'rate_limited'.
-- * Paginacao: 20 por pagina, cursor (created_at, id) decrescente; a RPC
--   devolve ate 21 linhas, a 21a so sinaliza que ha mais.

create table public.lesson_comments (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

comment on table public.lesson_comments is
  'Comentarios por aula (ADR 0004). Sem policies e sem grants ao cliente: acesso apenas por RPCs SECURITY DEFINER.';

create index lesson_comments_lesson_page_idx
  on public.lesson_comments (lesson_id, created_at desc, id desc);
create index lesson_comments_user_recent_idx
  on public.lesson_comments (user_id, created_at desc);

alter table public.lesson_comments enable row level security;

revoke all on public.lesson_comments from public, anon, authenticated;
grant select, insert, update, delete on public.lesson_comments to service_role;

-- Primeiro nome do autor; nunca cai para o e-mail.
create function app_private.comment_author_first_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- Primeiro token separado por qualquer espaco (inclui tab e NBSP), limitado a
  -- 30 caracteres; token com '@' (forma de e-mail) cai no rotulo generico.
  select coalesce(
    nullif(
      case
        when t.token like '%@%' then null
        else left(t.token, 30)
      end,
      ''
    ),
    'Aluno'
  )
  from (select 1) as one
  left join public.users u on u.id = p_user_id
  cross join lateral (
    select (regexp_match(u.full_name, '^[\s\u00a0]*([^\s\u00a0]+)'))[1] as token
  ) t;
$$;

create function app_private.is_staff_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.user_access ua
    where ua.user_id = p_user_id
      and ua.is_active
      and ua.role in ('tutor', 'admin', 'superadmin')
  );
$$;

-- Direito de participar dos comentarios da aula: equipe (aula existente) ou
-- aluno com matricula valida e aula/modulo ativos. Desativado e sem sessao: false.
create function app_private.can_comment_on_lesson(p_lesson_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_course_id uuid;
  v_active boolean;
begin
  if auth.uid() is null or p_lesson_id is null then
    return false;
  end if;

  if app.is_staff() then
    return exists (select 1 from public.lessons l where l.id = p_lesson_id);
  end if;

  select l.course_id, (l.archived_at is null and m.archived_at is null)
    into v_course_id, v_active
  from public.lessons l
  join public.modules m on m.id = l.module_id
  where l.id = p_lesson_id;

  return found and v_active and app.has_active_enrollment(auth.uid(), v_course_id);
end;
$$;

revoke all on function app_private.comment_author_first_name(uuid) from public, anon, authenticated;
revoke all on function app_private.is_staff_user(uuid) from public, anon, authenticated;
revoke all on function app_private.can_comment_on_lesson(uuid) from public, anon, authenticated;

create function app.list_lesson_comments(
  p_lesson_id uuid,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  author_first_name text,
  is_staff_author boolean,
  body text,
  created_at timestamptz,
  is_own boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_fetch_limit constant integer := 21;
begin
  -- Cursor pela metade e erro do cliente; ignorar reenviaria a primeira pagina.
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;

  if not app_private.can_comment_on_lesson(p_lesson_id) then
    return;
  end if;

  return query
  select c.id,
         app_private.comment_author_first_name(c.user_id),
         app_private.is_staff_user(c.user_id),
         c.body,
         c.created_at,
         c.user_id = auth.uid()
  from public.lesson_comments c
  where c.lesson_id = p_lesson_id
    and (
      p_cursor_created_at is null
      or (c.created_at, c.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by c.created_at desc, c.id desc
  limit c_fetch_limit;
end;
$$;

create function app.create_lesson_comment(p_lesson_id uuid, p_body text)
returns table (
  id uuid,
  author_first_name text,
  is_staff_author boolean,
  body text,
  created_at timestamptz,
  is_own boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_max_length constant integer := 2000;
  c_rate_limit constant integer := 10;
  v_body text := btrim(p_body, E' \t\r\n' || chr(160));
  v_new_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'unauthorized', hint = 'unauthorized';
  end if;

  if p_lesson_id is null or v_body is null or char_length(v_body) < 1 or char_length(v_body) > c_max_length then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;

  if not app_private.can_comment_on_lesson(p_lesson_id) then
    raise exception using errcode = '42501', message = 'forbidden', hint = 'forbidden';
  end if;

  if not app.is_staff() then
    -- Serializa criacoes do mesmo usuario: sem isso, chamadas paralelas leriam a
    -- mesma contagem e ultrapassariam o limite.
    perform pg_advisory_xact_lock(hashtextextended('lesson_comments:' || auth.uid()::text, 0));

    if (
      select count(*)
      from public.lesson_comments c
      where c.user_id = auth.uid()
        and c.created_at > now() - interval '1 minute'
    ) >= c_rate_limit then
      raise exception using errcode = 'P0001', message = 'rate_limited', hint = 'rate_limited';
    end if;
  end if;

  insert into public.lesson_comments (lesson_id, user_id, body)
  values (p_lesson_id, auth.uid(), v_body)
  returning public.lesson_comments.id into v_new_id;

  return query
  select c.id,
         app_private.comment_author_first_name(c.user_id),
         app_private.is_staff_user(c.user_id),
         c.body,
         c.created_at,
         true
  from public.lesson_comments c
  where c.id = v_new_id;
end;
$$;

comment on function app.list_lesson_comments(uuid, timestamptz, uuid) is
  'Comentarios da aula, mais recentes primeiro (created_at, id desc), ate 21 linhas (20 + 1 sinalizando mais) a partir do cursor (created_at, id) exclusivo. Zero linhas, sem erro, para quem nao participa (sem sessao, desativado, sem matricula valida, aula/modulo arquivado ou inexistente). Projeta primeiro nome e selo de equipe, sem e-mail. GRANT TO authenticated apenas.';
comment on function app.create_lesson_comment(uuid, text) is
  'Publica comentario (texto simples, 1 a 2.000 caracteres apos trim). Erros: unauthorized (sem sessao), invalid_input, forbidden (sem direito), rate_limited (10 por minuto, equipe isenta). Devolve a linha criada no mesmo formato de list_lesson_comments. GRANT TO authenticated apenas.';

revoke all on function app.list_lesson_comments(uuid, timestamptz, uuid) from public, anon;
revoke all on function app.create_lesson_comment(uuid, text) from public, anon;
grant execute on function app.list_lesson_comments(uuid, timestamptz, uuid) to authenticated;
grant execute on function app.create_lesson_comment(uuid, text) to authenticated;
