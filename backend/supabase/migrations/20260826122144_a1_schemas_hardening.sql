-- A1: dedicated schemas for the client-facing RPC surface (app) and for
-- service-role-only data (app_private), plus a hardening baseline that
-- flips Postgres's default-open GRANT posture to default-deny before any
-- table exists.
--
-- Rationale (technical): Postgres grants USAGE/CREATE on schema "public"
-- and EXECUTE on functions to the PUBLIC pseudo-role by default, and every
-- Supabase role (anon, authenticated, service_role) inherits PUBLIC. Left
-- at Postgres defaults, anything created later would be implicitly
-- reachable. Doing a revoke-first pass here, before any table/function
-- exists, means every later migration must GRANT explicitly (allow-list),
-- never rely on an accidental default grant.

create schema if not exists app;
create schema if not exists app_private;

comment on schema app is
  'Client-facing RPC surface (SECURITY DEFINER functions). Frozen signatures per prompt_course_platform.md "SQL RPC signatures (frozen)".';
comment on schema app_private is
  'Service-role-only data (payment_events, email_outbox, lesson_assets). No anon/authenticated GRANTs, ever -- see RLS access matrix in prompt_course_platform.md.';

-- Revoke the implicit PUBLIC grants Postgres creates schemas with.
revoke all on schema public from public;
revoke all on schema app from public;
revoke all on schema app_private from public;

-- Re-grant USAGE explicitly per role, allow-list style.
-- - public: anon/authenticated need it for courses_public/lessons reads;
--   service_role needs it for everything.
-- - app: only authenticated (policy-facing RPC wrappers) and service_role
--   (CAS/refund/reconciliation RPCs) call into this schema -- anon never
--   calls an RPC directly.
-- - app_private: service_role only, matching the RLS access matrix's
--   "anon: -, owner: -, other user: -, service_role: all" row for every
--   table in this schema.
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema app to authenticated, service_role;
grant usage on schema app_private to service_role;

-- Default privileges: anything the "postgres" role creates from now on
-- starts with zero PUBLIC grants (Postgres's built-in default is
-- EXECUTE-to-PUBLIC for functions), so every later migration must GRANT
-- explicitly instead of inheriting a default.
--
-- Deliberately GLOBAL (no "IN SCHEMA"), not per-schema: verified against a
-- vanilla Postgres 17 instance that "ALTER DEFAULT PRIVILEGES IN SCHEMA x
-- REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC" does NOT override the built-in
-- PUBLIC-EXECUTE default for functions/procedures -- a function created
-- afterwards still ends up with an "=X/<owner>" (PUBLIC) ACL entry, even
-- though pg_default_acl correctly records the narrower ACL. The
-- schema-unscoped form does not have this quirk and reliably produces a
-- function with no PUBLIC entry. Table/sequence default privileges behave
-- correctly either way; using the global form for all three object types
-- keeps this block uniform and avoids relying on the narrower form working
-- by coincidence on future Postgres versions.
alter default privileges revoke all on tables from public;
alter default privileges revoke all on functions from public;
alter default privileges revoke all on sequences from public;
