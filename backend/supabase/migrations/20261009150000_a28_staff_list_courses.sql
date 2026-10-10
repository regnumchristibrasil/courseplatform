-- A28: app.is_staff() e app.staff_list_courses() -- listagem de cursos para a
-- equipe (ADR 0002, decisoes 3 e 4; ticket #14).
--
-- Equipe = tutor, admin ou superadmin ATIVO, resolvido via auth.uid().
-- Formato de erro (mesmo contrato de A19): a MESSAGE da excecao e o codigo
-- estavel ('forbidden'), o HINT o repete; SQLSTATE 42501.
--
-- Contagens: enrollment_count = matriculas 'active' e nao expiradas;
-- pending_order_count = pedidos 'pending' ainda dentro da janela (expires_at). Sem paginacao: o
-- catalogo e pequeno e o ticket pede todos os cursos.

create function app.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.user_access ua
    where ua.user_id = auth.uid()
      and ua.is_active
      and ua.role in ('tutor', 'admin', 'superadmin')
  );
$$;

comment on function app.is_staff() is
  'True se o usuario chamador (auth.uid()) e tutor, admin ou superadmin ativo. search_path = '''' conforme convencao SECURITY DEFINER do repo.';

revoke all on function app.is_staff() from public, anon;
grant execute on function app.is_staff() to authenticated;

create function app.staff_list_courses()
returns table (
  id uuid,
  title text,
  status text,
  price_cents integer,
  access_duration_days integer,
  created_at timestamptz,
  updated_at timestamptz,
  enrollment_count bigint,
  pending_order_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_staff() then
    raise exception using errcode = '42501', message = 'forbidden', hint = 'forbidden';
  end if;

  return query
  select c.id, c.title, c.status, c.price_cents, c.access_duration_days,
         c.created_at, c.updated_at,
         (select count(*) from public.enrollments e
           where e.course_id = c.id and e.status = 'active'
              and (e.expires_at is null or e.expires_at > now())) as enrollment_count,
         (select count(*) from public.orders o
           where o.course_id = c.id and o.status = 'pending'
              and (o.expires_at is null or o.expires_at > now())) as pending_order_count
  from public.courses c
  order by c.created_at desc, c.id;
end;
$$;

comment on function app.staff_list_courses() is
  'Todos os cursos (qualquer status) com contagem de matriculas ativas e pedidos pendentes, para equipe ativa. Erros: message = codigo estavel (forbidden 42501).';

revoke all on function app.staff_list_courses() from public, anon;
grant execute on function app.staff_list_courses() to authenticated;
