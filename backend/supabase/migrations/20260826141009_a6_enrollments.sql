-- A6: enrollments + app.has_active_enrollment (both frozen overloads).
--
-- status is deliberately just 'active' | 'refunded': time-based expiry is
-- computed dynamically from expires_at, not modeled as a third status
-- value, so there is exactly one place ("active" per the shared function
-- below) that decides whether access is currently granted.

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'refunded')),
  granted_at timestamptz not null default now(),
  expires_at timestamptz
);

comment on table public.enrollments is
  'expires_at: NULL = lifetime access, else granted_at + courses.access_duration_days. Set once, on creation, by app.confirm_payment -- never by a client.';

-- Partial unique index, not a plain unique: a refunded user must be able to
-- re-enroll (new order -> new active row), so uniqueness is scoped to
-- "currently active", not to the (user, course) pair for all time.
create unique index enrollments_one_active_per_user_course
  on public.enrollments (user_id, course_id)
  where status = 'active';

alter table public.enrollments enable row level security;

-- RLS: SELECT restricted to the owning user; no client writes at all, ever
-- -- enrollment creation/revocation happens exclusively through
-- app.confirm_payment / app.refund_order (both SECURITY DEFINER, both
-- service_role-only), matching this repo's "no client INSERT/UPDATE on
-- enrollments or orders" non-negotiable.
create policy enrollments_select_own
  on public.enrollments
  for select
  to authenticated
  using (user_id = (select auth.uid()));

grant select on public.enrollments to authenticated;
grant select, insert, update, delete on public.enrollments to service_role;

-- Shared implementation of "active enrollment". Both frozen overloads
-- exist so RLS policies and future SECURITY DEFINER RPCs elsewhere have a
-- single boolean definition to call -- duplicating this predicate in two
-- places is exactly how these systems drift apart over time.
create function app.has_active_enrollment(p_user_id uuid, p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.enrollments e
    where e.user_id = p_user_id
      and e.course_id = p_course_id
      and e.status = 'active'
      and (e.expires_at is null or e.expires_at > now())
  );
$$;

comment on function app.has_active_enrollment(uuid, uuid) is
  'Shared "is this user currently entitled to this course" predicate. service_role only -- called internally by the (p_course_id) wrapper and by app.get_playable_ref (A11). search_path = '''' per this repo''s SECURITY DEFINER convention.';

-- Explicit, even though A1''s default-privilege hardening already means
-- this function has zero PUBLIC/anon/authenticated grants unless
-- explicitly added -- kept as documentation that this must never change,
-- per the frozen RPC signature list.
revoke all on function app.has_active_enrollment(uuid, uuid) from public, anon, authenticated;
grant execute on function app.has_active_enrollment(uuid, uuid) to service_role;

-- Policy-facing wrapper: what RLS policies and authenticated clients
-- actually call. Delegates to the shared implementation above under the
-- caller's own auth.uid() -- a user can only ever ask "am I entitled?",
-- never "is this other user entitled?".
create function app.has_active_enrollment(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_active_enrollment(auth.uid(), p_course_id);
$$;

comment on function app.has_active_enrollment(uuid) is
  'Policy-facing wrapper over app.has_active_enrollment(uuid, uuid), scoped to the caller''s own auth.uid(). GRANT TO authenticated only.';

grant execute on function app.has_active_enrollment(uuid) to authenticated;
