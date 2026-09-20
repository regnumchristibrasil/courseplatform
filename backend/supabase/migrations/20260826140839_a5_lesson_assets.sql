-- A5: app_private.lesson_assets -- the provider-specific video reference,
-- split out of public.lessons entirely (RLS is row-level, not column-level:
-- there is no way to expose a lessons row publicly while hiding a
-- video_ref column on that same row via RLS alone).
--
-- RLS enabled, ZERO policies: default deny even for the enrolled owning
-- user. Reachable only via service_role or app.get_playable_ref (A11), a
-- SECURITY DEFINER RPC that checks app.has_active_enrollment internally --
-- this makes the enrollment check structurally impossible to bypass from
-- client code, since there is no client-reachable read path at all.

create table app_private.lesson_assets (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  provider text not null check (provider in ('youtube', 'panda')),
  external_ref text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table app_private.lesson_assets is
  'Provider + external_ref per lesson. Not exposed via any client-reachable RLS policy -- see app.get_playable_ref (A11).';

-- Partial unique index (not a plain unique on lesson_id): lets the
-- YouTube -> Panda migration happen per-lesson -- backfill the new
-- provider's row as inactive, verify it plays, then flip is_active in one
-- UPDATE. Rollback is the same UPDATE in reverse, not a destructive
-- backfill/delete.
create unique index lesson_assets_one_active_per_lesson
  on app_private.lesson_assets (lesson_id)
  where is_active;

alter table app_private.lesson_assets enable row level security;

grant select, insert, update, delete on app_private.lesson_assets to service_role;
