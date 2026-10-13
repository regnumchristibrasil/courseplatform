-- A40: respostas de um nivel e exclusao logica de comentarios (ticket #28; ADR 0004).
--
-- * lesson_comments ganha parent_id (resposta a um comentario raiz), deleted_at
--   e deleted_by (exclusao logica; sem tabela de auditoria, decisao Q14).
-- * Responde-se apenas a comentario raiz ativo da mesma aula; resposta a
--   resposta e erro 'invalid_input'. Quem nao participa recebe 'forbidden'
--   antes de qualquer validacao do pai (sem enumeracao de comentarios).
-- * Exclusao: autor ou equipe, desde que ainda participe da aula. Comentario
--   inexistente ou de terceiro = 'forbidden'. Repetir a exclusao e no-op e nao
--   sobrescreve quem excluiu primeiro.
-- * Listagem: a pagina e de raizes (20 + 1 sinalizando mais); as respostas vivas
--   das 20 raizes exibidas vem junto. Raiz excluida so aparece, esvaziada, se
--   tiver resposta viva; excluida sem respostas vivas nao ocupa vaga na pagina.
-- * Excluidos continuam contando para o limite de taxa (contagem nas linhas, e
--   respostas contam como qualquer criacao).

alter table public.lesson_comments
  add column parent_id uuid references public.lesson_comments (id) on delete cascade,
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users (id) on delete set null,
  add constraint lesson_comments_deleted_by_requires_deleted_at
    check (deleted_by is null or deleted_at is not null);

create index lesson_comments_parent_idx
  on public.lesson_comments (parent_id, created_at, id)
  where parent_id is not null;

comment on column public.lesson_comments.parent_id is
  'Comentario raiz respondido; NULL para raiz. Um nivel apenas (garantido pela RPC).';
comment on column public.lesson_comments.deleted_at is
  'Exclusao logica: quando. O corpo permanece guardado, mas nunca e devolvido pelas RPCs.';
comment on column public.lesson_comments.deleted_by is
  'Exclusao logica: quem (autor ou equipe). NULL se o usuario foi removido depois.';

drop function app.list_lesson_comments(uuid, timestamptz, uuid);
drop function app.create_lesson_comment(uuid, text);

create function app.list_lesson_comments(
  p_lesson_id uuid,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  parent_id uuid,
  author_first_name text,
  is_staff_author boolean,
  body text,
  created_at timestamptz,
  is_own boolean,
  is_deleted boolean,
  can_delete boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_page_size constant integer := 20;
  v_is_staff boolean;
begin
  -- Cursor pela metade e erro do cliente; ignorar reenviaria a primeira pagina.
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;

  if not app_private.can_comment_on_lesson(p_lesson_id) then
    return;
  end if;

  v_is_staff := app.is_staff();

  return query
  with ranked_roots as (
    select r.id as root_id,
           row_number() over (order by r.created_at desc, r.id desc) as rn
    from (
      select c.id, c.created_at
      from public.lesson_comments c
      where c.lesson_id = p_lesson_id
        and c.parent_id is null
        and (
          p_cursor_created_at is null
          or (c.created_at, c.id) < (p_cursor_created_at, p_cursor_id)
        )
        and (
          c.deleted_at is null
          or exists (
            select 1
            from public.lesson_comments live
            where live.parent_id = c.id and live.deleted_at is null
          )
        )
      order by c.created_at desc, c.id desc
      limit c_page_size + 1
    ) r
  )
  select c.id,
         c.parent_id,
         case when c.deleted_at is null then app_private.comment_author_first_name(c.user_id) else ''::text end,
         case when c.deleted_at is null then app_private.is_staff_user(c.user_id) else false end,
         case when c.deleted_at is null then c.body else ''::text end,
         c.created_at,
         c.deleted_at is null and c.user_id = auth.uid(),
         c.deleted_at is not null,
         c.deleted_at is null and (v_is_staff or c.user_id = auth.uid())
  from public.lesson_comments c
  join ranked_roots rr on rr.root_id = coalesce(c.parent_id, c.id)
  where (c.parent_id is null and rr.rn <= c_page_size + 1)
     or (c.parent_id is not null and rr.rn <= c_page_size and c.deleted_at is null)
  order by rr.rn, (c.parent_id is not null), c.created_at, c.id;
end;
$$;

create function app.create_lesson_comment(
  p_lesson_id uuid,
  p_body text,
  p_parent_id uuid default null
)
returns table (
  id uuid,
  parent_id uuid,
  author_first_name text,
  is_staff_author boolean,
  body text,
  created_at timestamptz,
  is_own boolean,
  is_deleted boolean,
  can_delete boolean
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

  -- Pai valido: raiz ativa da mesma aula. Depende do direito acima para nao
  -- revelar a existencia de comentarios a quem nao participa.
  -- FOR SHARE conflita com o FOR UPDATE da exclusao: uma exclusao concorrente do
  -- pai ou termina antes (e o pai deixa de casar) ou espera esta insercao.
  if p_parent_id is not null then
    perform 1
    from public.lesson_comments p
    where p.id = p_parent_id
      and p.lesson_id = p_lesson_id
      and p.parent_id is null
      and p.deleted_at is null
    for share;

    if not found then
      raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
    end if;
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

  insert into public.lesson_comments (lesson_id, user_id, body, parent_id)
  values (p_lesson_id, auth.uid(), v_body, p_parent_id)
  returning public.lesson_comments.id into v_new_id;

  return query
  select c.id,
         c.parent_id,
         app_private.comment_author_first_name(c.user_id),
         app_private.is_staff_user(c.user_id),
         c.body,
         c.created_at,
         true,
         false,
         true
  from public.lesson_comments c
  where c.id = v_new_id;
end;
$$;

create function app.delete_lesson_comment(p_comment_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_lesson_id uuid;
  v_author_id uuid;
  v_deleted_at timestamptz;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'unauthorized', hint = 'unauthorized';
  end if;

  if p_comment_id is null then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;

  select c.lesson_id, c.user_id, c.deleted_at
    into v_lesson_id, v_author_id, v_deleted_at
  from public.lesson_comments c
  where c.id = p_comment_id
  for update;

  -- Inexistente, sem direito na aula ou de terceiro: o mesmo 'forbidden'.
  if not found
     or not app_private.can_comment_on_lesson(v_lesson_id)
     or not (v_author_id = auth.uid() or app.is_staff()) then
    raise exception using errcode = '42501', message = 'forbidden', hint = 'forbidden';
  end if;

  if v_deleted_at is null then
    update public.lesson_comments
    set deleted_at = now(), deleted_by = auth.uid()
    where id = p_comment_id;
  end if;
end;
$$;

comment on function app.list_lesson_comments(uuid, timestamptz, uuid) is
  'Pagina de comentarios raiz da aula, mais recentes primeiro (created_at, id desc), ate 21 raizes (20 + 1 sinalizando mais) a partir do cursor (created_at, id) exclusivo, mais as respostas vivas das 20 primeiras (mais antigas primeiro, logo apos a raiz). Raiz excluida so aparece (is_deleted, sem autor nem corpo) se tiver resposta viva; resposta excluida nunca aparece. Zero linhas, sem erro, para quem nao participa. Sem e-mail nem user_id. GRANT TO authenticated apenas.';
comment on function app.create_lesson_comment(uuid, text, uuid) is
  'Publica comentario ou, com p_parent_id, resposta a um comentario raiz ativo da mesma aula (texto simples, 1 a 2.000 caracteres apos trim). Erros: unauthorized, invalid_input (inclui pai invalido ou resposta a resposta), forbidden (sem direito), rate_limited (10 por minuto contando excluidos e respostas, equipe isenta). Devolve a linha criada no formato de list_lesson_comments. GRANT TO authenticated apenas.';
comment on function app.delete_lesson_comment(uuid) is
  'Exclusao logica (deleted_at, deleted_by) pelo autor ou pela equipe, para quem ainda participa da aula. Erros: unauthorized, invalid_input (id nulo), forbidden (inexistente, de terceiro ou sem direito). Idempotente: repetir nao sobrescreve quem excluiu primeiro. GRANT TO authenticated apenas.';

revoke all on function app.list_lesson_comments(uuid, timestamptz, uuid) from public, anon;
revoke all on function app.create_lesson_comment(uuid, text, uuid) from public, anon;
revoke all on function app.delete_lesson_comment(uuid) from public, anon;
grant execute on function app.list_lesson_comments(uuid, timestamptz, uuid) to authenticated;
grant execute on function app.create_lesson_comment(uuid, text, uuid) to authenticated;
grant execute on function app.delete_lesson_comment(uuid) to authenticated;
