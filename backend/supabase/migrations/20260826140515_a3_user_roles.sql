-- A3: app_private.user_roles + app.is_admin().
--
-- Roles live in a dedicated, client-write-free table -- never as a column
-- on public.users -- because a self-UPDATE RLS policy plus a role column
-- on the same row is a self-promotion vulnerability (see A2). RLS is
-- enabled with ZERO policies (default deny for every non-bypass role,
-- including the owning user), the same posture as app_private.lesson_assets
-- (A5): reachable only via service_role or a narrow SECURITY DEFINER RPC.

create table app_private.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin')),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

comment on table app_private.user_roles is
  'Role grants, separate from public.users so a self-UPDATE policy can never become a self-promotion vector. RLS enabled, zero policies: reachable only via service_role or app.is_admin().';

alter table app_private.user_roles enable row level security;

grant select, insert, update, delete on app_private.user_roles to service_role;

-- Policy-facing check, callable by any authenticated user to test their own
-- admin status (used inside RLS `using`/`with check` clauses on future
-- admin-gated tables). SECURITY DEFINER so it can read app_private, a
-- schema `authenticated` has no USAGE on (A1).
create function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'admin'
  );
$$;

comment on function app.is_admin() is
  'True if the calling user (auth.uid()) holds the admin role. search_path = '''' per this repo''s SECURITY DEFINER convention.';

grant execute on function app.is_admin() to authenticated;
