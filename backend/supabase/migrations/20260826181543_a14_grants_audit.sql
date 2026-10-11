-- A14: grants audit -- and a real remediation this audit uncovered.
--
-- Finding (discovered by writing this migration's own DO block below, and
-- reproduced independently by re-running `supabase db reset` from a true
-- clean slate): every table this project's migrations create in the
-- `public` schema is silently granted TRUNCATE, REFERENCES, and TRIGGER on
-- anon and authenticated -- e.g. `TRUNCATE public.orders;` succeeds as
-- anon today, RLS notwithstanding (TRUNCATE is not row-filtered by RLS at
-- all). Root cause: Supabase's local bootstrap (`roles.sql`, applied
-- before any migration in this repo runs) pre-seeds a SCHEMA-SCOPED
-- default-privilege entry for `FOR ROLE postgres IN SCHEMA public`
-- granting anon/authenticated/service_role "Dxtm" (TRUNCATE/REFERENCES/
-- TRIGGER/MAINTAIN) on every future table postgres creates there. A1's own
-- default-privilege hardening (`ALTER DEFAULT PRIVILEGES REVOKE ALL ...
-- FROM PUBLIC`, no schema clause) never touched this: that statement only
-- clears what the literal PUBLIC pseudo-role was granted, and this
-- pre-existing entry names anon/authenticated/service_role directly, not
-- via PUBLIC. This class of bug is exactly why A14 exists as a real
-- migration-time gate, not just a passing pgTAP suite -- fixed below,
-- for both future tables (the default-privilege entry) and the five
-- tables that already exist (users, courses, lessons, enrollments,
-- orders).

-- Future public.* tables created by postgres: clear the pre-existing
-- schema-scoped default so anon/authenticated get nothing beyond whatever
-- this repo's migrations explicitly GRANT afterward.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

-- Existing public.* relations: the statement above only affects tables
-- created AFTER it runs, so reset every relation this project has created
-- so far to its intended grants. This is a RESET (revoke ALL, then re-grant
-- exactly what A2/A4/A6/A7 intend), not a partial revoke, so the result is
-- the same no matter what the environment's bootstrap handed out:
--   * local Supabase seeds a schema-scoped default of TRUNCATE/REFERENCES/
--     TRIGGER/MAINTAIN only;
--   * hosted Supabase seeds ALL privileges (SELECT/INSERT/UPDATE/DELETE
--     included) for anon/authenticated/service_role, so a partial revoke of
--     the four DDL-ish privileges left full client write grants in place
--     and made the audit below fail on the first production `db push`.
-- courses_public is a VIEW, but the default-privilege "TABLES" category also
-- covers views, so it is reset together with the base tables.
-- REVOKE on a table also drops column-level grants, hence the explicit
-- re-grant of the users column UPDATE.
-- service_role is not touched here: its full access is intended and
-- granted explicitly by each table's own migration.
revoke all on
  public.users,
  public.courses,
  public.lessons,
  public.enrollments,
  public.orders,
  public.courses_public
from anon, authenticated;

grant select on public.users to authenticated;
grant update (full_name, avatar_url) on public.users to authenticated;
grant select on public.courses, public.lessons, public.courses_public to anon, authenticated;
grant select on public.enrollments, public.orders to authenticated;

-- Two more parts:
-- 1. app_private.audit_privileges(): a small, permanently-available
--    diagnostic view over pg_catalog for manual review (Studio/psql) of
--    exactly which grantee has which privilege on which relation, across
--    public/app/app_private -- useful the next time a table is added and
--    someone wants to sanity-check its grants by eye.
-- 2. A one-shot DO block that RAISES EXCEPTION (aborting this migration,
--    and therefore `supabase db reset`/deploy) if the schema as it exists
--    RIGHT NOW deviates from this repo's non-negotiables: every public
--    table has RLS enabled, every app_private table has RLS enabled with
--    zero policies, and no anon/authenticated grant exists on the two
--    money/access-bearing tables (enrollments, orders) beyond SELECT. This
--    is a point-in-time proof baked into migration history, not a live
--    trigger -- the corresponding pgTAP suite
--    (supabase/tests/a14_grants_audit_test.sql) is what re-verifies this on
--    every `supabase test db` run going forward.

create view app_private.audit_privileges
with (security_invoker = true)
as
select
  table_schema,
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema in ('public', 'app', 'app_private')
order by table_schema, table_name, grantee, privilege_type;

comment on view app_private.audit_privileges is
  'Diagnostic-only: every (schema, table, grantee, privilege) grant across public/app/app_private, for manual review. service_role only, same as every other app_private object.';

grant select on app_private.audit_privileges to service_role;

do $$
declare
  v_rec record;
  v_violations text[] := array[]::text[];
begin
  -- Every table in `public` must have RLS enabled -- no exceptions, per
  -- this repo's default posture.
  for v_rec in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
  loop
    v_violations := v_violations || format('public.%I has RLS disabled', v_rec.relname);
  end loop;

  -- Every table in `app_private` must have RLS enabled AND zero policies
  -- -- this schema is reachable only via service_role or a narrow
  -- SECURITY DEFINER RPC, never via a client-facing RLS policy.
  for v_rec in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app_private'
      and c.relkind = 'r'
      and not c.relrowsecurity
  loop
    v_violations := v_violations || format('app_private.%I has RLS disabled', v_rec.relname);
  end loop;

  for v_rec in
    select c.relname, count(p.polname) as policy_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_policy p on p.polrelid = c.oid
    where n.nspname = 'app_private'
      and c.relkind = 'r'
    group by c.relname
    having count(p.polname) > 0
  loop
    v_violations := v_violations || format('app_private.%I has %s RLS polic(y/ies), expected zero', v_rec.relname, v_rec.policy_count);
  end loop;

  -- No public.* table may grant TRUNCATE/REFERENCES/TRIGGER/MAINTAIN to
  -- anon/authenticated, ever, regardless of what SELECT/UPDATE access that
  -- table otherwise legitimately has -- this is the exact class of leak
  -- this migration exists to close (see the top-of-file comment): a
  -- schema-scoped Supabase bootstrap default that predates this repo's own
  -- migrations and survives a schema-unqualified `REVOKE ... FROM PUBLIC`.
  for v_rec in
    select table_name, grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
  loop
    v_violations := v_violations || format('public.%I grants %s to %s (structural/DDL privilege, never allowed for a client role)', v_rec.table_name, v_rec.privilege_type, v_rec.grantee);
  end loop;

  -- app_private tables must have zero anon/authenticated grants of any kind.
  for v_rec in
    select table_name, grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'app_private'
      and grantee in ('anon', 'authenticated')
  loop
    v_violations := v_violations || format('app_private.%I grants %s to %s (expected none)', v_rec.table_name, v_rec.privilege_type, v_rec.grantee);
  end loop;

  -- enrollments/orders: anon/authenticated may only ever have SELECT --
  -- no INSERT/UPDATE/DELETE grant may exist, matching "no client writes,
  -- ever" for these two money/access-bearing tables.
  for v_rec in
    select table_name, grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('enrollments', 'orders')
      and grantee in ('anon', 'authenticated')
      and privilege_type != 'SELECT'
  loop
    v_violations := v_violations || format('public.%I grants %s to %s (only SELECT is allowed)', v_rec.table_name, v_rec.privilege_type, v_rec.grantee);
  end loop;

  -- anon must have NO grant at all on enrollments/orders (not even
  -- SELECT) -- these are owner-only-read tables, unlike courses/lessons.
  for v_rec in
    select table_name, grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('enrollments', 'orders')
      and grantee = 'anon'
  loop
    v_violations := v_violations || format('public.%I grants %s to anon (expected none -- owner-only read)', v_rec.table_name, v_rec.privilege_type);
  end loop;

  if array_length(v_violations, 1) > 0 then
    raise exception 'A14 grants audit failed: %', array_to_string(v_violations, '; ');
  end if;
end;
$$;
