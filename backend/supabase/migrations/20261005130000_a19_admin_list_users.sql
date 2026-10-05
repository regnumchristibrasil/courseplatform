-- A19: app.admin_list_users() -- listagem paginada de usuarios para admins
-- (ADR 0001, plano admin-user-management, invariantes I3 e I5).
--
-- Formato de erro (contrato parseavel pelo cliente): a MESSAGE da excecao e
-- o codigo estavel de AdminUsersErrorCode (ex.: 'forbidden', 'invalid_input'),
-- sem texto adicional; o HINT repete o codigo. SQLSTATE:
--   forbidden     -> 42501
--   invalid_input -> 22023
-- O cliente deve usar message (ou hint) como codigo, nunca texto livre.
--
-- Exposicao minima: sem last_sign_in_at, sem status de confirmacao de email,
-- sem raw_user_meta_data. Apenas colunas de public.users + user_access.

create function app.admin_list_users(
  p_search text,
  p_role text,
  p_active boolean,
  p_limit int,
  p_offset int
)
returns table (
  id uuid,
  email text,
  full_name text,
  role text,
  is_active boolean,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_max_limit constant int := 50;       -- MAX_LIST_LIMIT do contrato
  c_default_limit constant int := 20;
  c_max_search constant int := 100;
  c_max_offset constant int := 100000;  -- teto de paginacao (evita scans enormes)
  v_search text := nullif(btrim(p_search), '');
  v_pattern text;
  v_limit int := least(greatest(coalesce(p_limit, c_default_limit), 1), c_max_limit);
  v_offset int := least(greatest(coalesce(p_offset, 0), 0), c_max_offset);
begin
  -- I3/I5: apenas admin ou superadmin ATIVO, resolvido via auth.uid().
  if not app.is_admin() then
    raise exception using errcode = '42501', message = 'forbidden', hint = 'forbidden';
  end if;

  if p_role is not null
     and p_role not in ('superadmin', 'admin', 'tutor', 'student') then
    raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
  end if;

  if v_search is not null then
    if char_length(v_search) > c_max_search then
      raise exception using errcode = '22023', message = 'invalid_input', hint = 'invalid_input';
    end if;
    -- Escapa a barra primeiro, depois % e _, para a busca ser literal.
    v_pattern := '%'
      || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_')
      || '%';
  end if;

  return query
  select u.id, u.email, u.full_name, ua.role, ua.is_active, u.created_at,
         count(*) over () as total_count
  from public.users u
  join app_private.user_access ua on ua.user_id = u.id
  where (v_pattern is null or u.email ilike v_pattern or u.full_name ilike v_pattern)
    and (p_role is null or ua.role = p_role)
    and (p_active is null or ua.is_active = p_active)
  order by u.created_at desc, u.id
  limit v_limit offset v_offset;
end;
$$;

comment on function app.admin_list_users(text, text, boolean, int, int) is
  'Listagem paginada (limit 1..50, offset 0..100000) para admin/superadmin ativo. Erros: message = codigo estavel (forbidden 42501, invalid_input 22023).';

revoke all on function app.admin_list_users(text, text, boolean, int, int) from public, anon;
grant execute on function app.admin_list_users(text, text, boolean, int, int) to authenticated;
