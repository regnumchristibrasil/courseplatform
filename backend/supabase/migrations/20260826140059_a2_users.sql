-- A2: public.users profile table, populated from auth.users via triggers.
--
-- Deliberately has NO role/admin column here, ever: a self-UPDATE RLS
-- policy plus a role column on the same row is a self-promotion
-- vulnerability (a user could UPDATE their own row and set role='admin').
-- Roles live in the separate app_private.user_roles table (A3), which has
-- zero client GRANTs, so this table can never become that vector.

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.users is
  'Profile mirror of auth.users. No role/admin column by design -- see app_private.user_roles (A3).';

alter table public.users enable row level security;

-- Generic "touch updated_at" trigger utility, reused by every table that
-- carries an updated_at column in later migrations.
create function app_private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function app_private.set_updated_at() is
  'Shared BEFORE UPDATE trigger: stamps updated_at = now(). search_path = '''' per this repo''s SECURITY DEFINER convention (technical: prevents search_path hijacking from an object created earlier in a less-trusted schema).';

create trigger set_users_updated_at
  before update on public.users
  for each row
  execute function app_private.set_updated_at();

-- Populate public.users on signup (AFTER INSERT ON auth.users). SECURITY
-- DEFINER so the insert succeeds despite public.users' RLS (the function
-- owner, postgres, bypasses RLS as the table owner), and so it can be
-- attached to auth.users, a schema this migration's role does not own.
create function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name'
  );
  return new;
end;
$$;

comment on function app_private.handle_new_user() is
  'Populates public.users on auth.users signup. There is no client-callable INSERT path onto public.users -- this trigger is the only writer.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function app_private.handle_new_user();

-- Keep public.users.email in sync when a user changes their email via
-- Supabase Auth's own flow (double confirmation, etc.) -- without this,
-- public.users.email would silently drift from the auth.users source of
-- truth after the first email change.
create function app_private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.users set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update on auth.users
  for each row
  execute function app_private.handle_user_email_change();

-- RLS: owner-only SELECT/UPDATE, no client INSERT/DELETE anywhere (matches
-- the RLS access matrix: anon "-", owner "S, U (own row)", other user "-").
create policy users_select_own
  on public.users
  for select
  to authenticated
  using (id = (select auth.uid()));

create policy users_update_own
  on public.users
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

grant select on public.users to authenticated;
-- Column-level UPDATE grant: even for their own row, a client can only ever
-- touch profile fields -- "id" and "email" stay server-managed (email
-- follows auth.users via the sync trigger above, id is immutable).
grant update (full_name, avatar_url) on public.users to authenticated;

grant select, insert, update, delete on public.users to service_role;
