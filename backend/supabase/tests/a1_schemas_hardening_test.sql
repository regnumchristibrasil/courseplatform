-- A1 -- schemas + hardening baseline.
-- Covers: schema existence, allow-listed USAGE grants per role, and that
-- ALTER DEFAULT PRIVILEGES actually blocks PUBLIC on objects created after
-- this migration (not just objects that happen to exist today).
BEGIN;
SELECT plan(15);

-- Schemas exist.
SELECT has_schema('app', 'app schema exists');
SELECT has_schema('app_private', 'app_private schema exists');

-- public: anon/authenticated/service_role all have USAGE (existing tables
-- will be scoped further by RLS in later A-numbers).
SELECT ok(has_schema_privilege('anon', 'public', 'USAGE'), 'anon has USAGE on public');
SELECT ok(has_schema_privilege('authenticated', 'public', 'USAGE'), 'authenticated has USAGE on public');
SELECT ok(has_schema_privilege('service_role', 'public', 'USAGE'), 'service_role has USAGE on public');

-- app: authenticated + service_role only, anon never calls an RPC directly.
SELECT ok(NOT has_schema_privilege('anon', 'app', 'USAGE'), 'anon has NO USAGE on app');
SELECT ok(has_schema_privilege('authenticated', 'app', 'USAGE'), 'authenticated has USAGE on app');
SELECT ok(has_schema_privilege('service_role', 'app', 'USAGE'), 'service_role has USAGE on app');

-- app_private: service_role only -- matches the RLS access matrix's
-- "anon: -, owner: -, other user: -, service_role: all" row.
SELECT ok(NOT has_schema_privilege('anon', 'app_private', 'USAGE'), 'anon has NO USAGE on app_private');
SELECT ok(NOT has_schema_privilege('authenticated', 'app_private', 'USAGE'), 'authenticated has NO USAGE on app_private');
SELECT ok(has_schema_privilege('service_role', 'app_private', 'USAGE'), 'service_role has USAGE on app_private');

-- ALTER DEFAULT PRIVILEGES: a table created *after* this migration, by the
-- same role that ran the migration, should not be auto-granted to anon or
-- authenticated. This is the actual behavior under test, not just the
-- ACL row -- so create a throwaway table (rolled back at the end of this
-- test transaction) and check its grants directly.
CREATE TABLE app_private.a1_default_priv_probe (id int);

SELECT ok(
  NOT has_table_privilege('anon', 'app_private.a1_default_priv_probe', 'SELECT'),
  'anon has NO default SELECT on a table created after A1 hardening'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'app_private.a1_default_priv_probe', 'SELECT'),
  'authenticated has NO default SELECT on a table created after A1 hardening'
);

CREATE FUNCTION app.a1_default_priv_probe_fn() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;

SELECT ok(
  NOT has_function_privilege('anon', 'app.a1_default_priv_probe_fn()', 'EXECUTE'),
  'anon has NO default EXECUTE on a function created after A1 hardening'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'app.a1_default_priv_probe_fn()', 'EXECUTE'),
  'authenticated has NO default EXECUTE on a function created after A1 hardening'
);

SELECT * FROM finish();
ROLLBACK;
