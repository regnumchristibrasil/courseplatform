-- A4: courses, lessons, and the courses_public view.
--
-- Money (price_cents) is integer cents everywhere -- never numeric/float --
-- the payment gateway adapter (Track B) is the only place that converts to
-- decimal, at the API boundary. access_duration_days is per-course:
-- NULL means lifetime access; a positive integer is days from grant to
-- expiry, and is the single source of truth app.confirm_payment (A10) reads
-- when computing enrollments.expires_at.
--
-- No admin content-management UI/RPC exists yet (deferred per this repo's
-- decisions log) -- for now, courses/lessons are written only via
-- service_role (Studio/dashboard/seed), never by an authenticated client.

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  access_duration_days integer check (access_duration_days is null or access_duration_days > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.courses.access_duration_days is
  'NULL = lifetime access. Positive integer = days from enrollments.granted_at to enrollments.expires_at. Read server-side by app.confirm_payment -- never accept this from a client request.';

alter table public.courses enable row level security;

create trigger set_courses_updated_at
  before update on public.courses
  for each row
  execute function app_private.set_updated_at();

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  position integer not null,
  duration_seconds integer,
  is_free_preview boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, position)
);

comment on table public.lessons is
  'Curriculum metadata only -- deliberately contains no video reference. See app_private.lesson_assets (A5) for provider/external_ref, reachable only through app.get_playable_ref.';

alter table public.lessons enable row level security;

create trigger set_lessons_updated_at
  before update on public.lessons
  for each row
  execute function app_private.set_updated_at();

-- RLS: public SELECT where published (courses) / parent course published
-- (lessons); no client writes anywhere -- matches the RLS access matrix's
-- "anon: S (published), owner: S, other user: S, service_role: all" row.
create policy courses_select_published
  on public.courses
  for select
  to anon, authenticated
  using (status = 'published');

create policy lessons_select_parent_published
  on public.lessons
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.courses c
      where c.id = lessons.course_id
        and c.status = 'published'
    )
  );

grant select on public.courses to anon, authenticated;
grant select on public.lessons to anon, authenticated;
grant select, insert, update, delete on public.courses to service_role;
grant select, insert, update, delete on public.lessons to service_role;

-- courses_public: explicit column list, the frontend catalog/detail page's
-- actual query target (per this repo's NFRs: catalog reads go straight to
-- PostgREST, never through an Edge Function). security_invoker means the
-- view runs under the CALLER's privileges/RLS, not the view creator's --
-- defense in depth on top of the WHERE clause below, so a future
-- internal-only column (cost basis, gateway account id) added to `courses`
-- doesn't leak through this view just because RLS on the base table
-- happens to allow it.
create view public.courses_public
with (security_invoker = true)
as
select
  id,
  title,
  description,
  price_cents,
  status,
  access_duration_days,
  created_at
from public.courses
where status = 'published';

comment on view public.courses_public is
  'Explicit, client-safe column list over public.courses. Add future internal-only columns (cost basis, gateway account id) to the base table, not to this view.';

grant select on public.courses_public to anon, authenticated;
grant select on public.courses_public to service_role;
