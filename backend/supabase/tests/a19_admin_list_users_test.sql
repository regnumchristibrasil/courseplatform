-- A19 -- app.admin_list_users(): paged, filtered user listing for admins.
-- Error contract asserted here: SQLSTATE 42501 + message 'forbidden' for
-- authorization failures, SQLSTATE 22023 + message 'invalid_input' for bad
-- filters. The message is the stable code the client parses.
BEGIN;
SELECT plan(39);

-- Fixtures (auth inserts fire handle_new_user -> public.users + student row).
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'superadmin@example.com', '{"full_name":"Sue Super"}'),
  ('22222222-2222-2222-2222-222222222222', 'admin@example.com', '{"full_name":"Adam Admin"}'),
  ('33333333-3333-3333-3333-333333333333', 'tutor@example.com', '{"full_name":"Tina Tutor"}'),
  ('44444444-4444-4444-4444-444444444444', 'student@example.com', '{"full_name":"Stan Student"}'),
  ('55555555-5555-5555-5555-555555555555', 'inactiveadmin@example.com', '{"full_name":"Ina Inactive"}'),
  ('66666666-6666-6666-6666-666666666666', 'pct%user@example.com', '{"full_name":"Percent 100%"}'),
  ('77777777-7777-7777-7777-777777777777', 'under_score@example.com', '{"full_name":"Under Score"}'),
  ('88888888-8888-8888-8888-888888888888', 'underXscore@example.com', '{"full_name":"Under X"}'),
  ('99999999-9999-9999-9999-999999999999', 'back\slash@example.com', '{"full_name":"Back Slash"}');

UPDATE app_private.user_access SET role = 'superadmin' WHERE user_id = '11111111-1111-1111-1111-111111111111';
UPDATE app_private.user_access SET role = 'admin' WHERE user_id IN ('22222222-2222-2222-2222-222222222222', '55555555-5555-5555-5555-555555555555');
UPDATE app_private.user_access SET role = 'tutor' WHERE user_id = '33333333-3333-3333-3333-333333333333';
UPDATE app_private.user_access SET is_active = false WHERE user_id IN ('55555555-5555-5555-5555-555555555555', '88888888-8888-8888-8888-888888888888');

-- Deterministic created_at: ids ending in 1..9 get day 1..9 of 2026-01.
UPDATE public.users SET created_at = ('2026-01-0' || left(id::text, 1) || ' 00:00:00+00')::timestamptz;

-- Shape: grants, definer, search_path, exact columns.
SELECT has_function('app', 'admin_list_users', ARRAY['text', 'text', 'boolean', 'integer', 'integer'], 'app.admin_list_users exists');
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'app.admin_list_users(text,text,boolean,integer,integer)'::regprocedure),
  'admin_list_users is SECURITY DEFINER'
);
SELECT ok(
  (SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'app.admin_list_users(text,text,boolean,integer,integer)'::regprocedure),
  'admin_list_users pins search_path to empty'
);
SELECT ok(
  has_function_privilege('authenticated', 'app.admin_list_users(text,text,boolean,integer,integer)', 'EXECUTE'),
  'authenticated can EXECUTE'
);
SELECT ok(
  NOT has_function_privilege('anon', 'app.admin_list_users(text,text,boolean,integer,integer)', 'EXECUTE'),
  'anon cannot EXECUTE'
);
SELECT ok(
  NOT has_function_privilege('public', 'app.admin_list_users(text,text,boolean,integer,integer)', 'EXECUTE'),
  'PUBLIC cannot EXECUTE'
);
-- Authorization.
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT * FROM app.admin_list_users(NULL, NULL, NULL, 10, 0) $$,
  '42501', NULL, 'anon denied by grants'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT throws_ok($$ SELECT * FROM app.admin_list_users(NULL, NULL, NULL, 10, 0) $$, '42501', 'forbidden', 'student gets forbidden');
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT throws_ok($$ SELECT * FROM app.admin_list_users(NULL, NULL, NULL, 10, 0) $$, '42501', 'forbidden', 'tutor gets forbidden');
SET LOCAL "request.jwt.claim.sub" = '55555555-5555-5555-5555-555555555555';
SELECT throws_ok($$ SELECT * FROM app.admin_list_users(NULL, NULL, NULL, 10, 0) $$, '42501', 'forbidden', 'inactive admin gets forbidden');
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000000';
SELECT throws_ok($$ SELECT * FROM app.admin_list_users(NULL, NULL, NULL, 10, 0) $$, '42501', 'forbidden', 'unknown uid gets forbidden');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '';
SELECT throws_ok($$ SELECT * FROM app.admin_list_users(NULL, NULL, NULL, 10, 0) $$, '42501', 'forbidden', 'authenticated without sub gets forbidden');

SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT is((SELECT count(*)::int FROM app.admin_list_users(NULL, NULL, NULL, 50, 0)), 9, 'admin allowed, sees all 9 users');
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*)::int FROM app.admin_list_users(NULL, NULL, NULL, 50, 0)), 9, 'superadmin allowed, sees all 9 users');

-- Returned columns are exact (no last_sign_in_at, no confirmation, no metadata).
SELECT is(
  (SELECT array_agg(c ORDER BY n) FROM (
     SELECT (row_to_json(r)::jsonb) AS j FROM app.admin_list_users(NULL, NULL, NULL, 1, 0) r
   ) s, LATERAL (SELECT k AS c, k AS n FROM jsonb_object_keys(s.j) k) keys),
  ARRAY['created_at', 'email', 'full_name', 'id', 'is_active', 'role', 'total_count'],
  'returned columns are exactly the contract set'
);

-- Search: literal escaping.
SELECT is((SELECT count(*)::int FROM app.admin_list_users('%', NULL, NULL, 50, 0)), 1, 'search "%" matches only the literal percent row (once, even if email and name both match)');
SELECT is((SELECT email FROM app.admin_list_users('%', NULL, NULL, 50, 0) LIMIT 1), 'pct%user@example.com', 'search "%" returns the percent user');
SELECT is((SELECT count(*)::int FROM app.admin_list_users('under_score', NULL, NULL, 50, 0)), 1, 'search "_" is literal: under_score does not match underXscore');
SELECT is((SELECT count(*)::int FROM app.admin_list_users('_', NULL, NULL, 50, 0)), 1, 'search "_" alone matches only the literal underscore');
SELECT is((SELECT count(*)::int FROM app.admin_list_users('\', NULL, NULL, 50, 0)), 1, 'search backslash is literal');
SELECT is((SELECT count(*)::int FROM app.admin_list_users('STAN', NULL, NULL, 50, 0)), 1, 'search is case-insensitive on full_name');
SELECT is((SELECT count(*)::int FROM app.admin_list_users('tutor@', NULL, NULL, 50, 0)), 1, 'search matches email');
SELECT is((SELECT count(*)::int FROM app.admin_list_users('   ', NULL, NULL, 50, 0)), 9, 'blank search is no filter');
SELECT throws_ok(
  $$ SELECT * FROM app.admin_list_users(repeat('a', 101), NULL, NULL, 50, 0) $$,
  '22023', 'invalid_input', 'search longer than 100 chars is rejected'
);

-- Filters.
SELECT throws_ok($$ SELECT * FROM app.admin_list_users(NULL, 'owner', NULL, 50, 0) $$, '22023', 'invalid_input', 'invalid role rejected');
SELECT is((SELECT count(*)::int FROM app.admin_list_users(NULL, 'admin', NULL, 50, 0)), 2, 'role filter admin');
SELECT is((SELECT count(*)::int FROM app.admin_list_users(NULL, NULL, false, 50, 0)), 2, 'active=false filter');
SELECT is((SELECT count(*)::int FROM app.admin_list_users(NULL, 'admin', true, 50, 0)), 1, 'role + active combined');

-- Limit / offset clamp.
SELECT is((SELECT count(*)::int FROM app.admin_list_users(NULL, NULL, NULL, 0, 0)), 1, 'limit 0 clamps to 1');
SELECT is((SELECT count(*)::int FROM app.admin_list_users(NULL, NULL, NULL, 1000, 0)), 9, 'limit 1000 clamps to 50 (all 9 rows)');
SELECT is((SELECT count(*)::int FROM app.admin_list_users(NULL, NULL, NULL, NULL, NULL)), 9, 'null limit/offset use defaults');
SELECT is((SELECT count(*)::int FROM app.admin_list_users(NULL, NULL, NULL, 50, -5)), 9, 'negative offset clamps to 0');

SELECT is((SELECT count(*)::int FROM app.admin_list_users(NULL, NULL, NULL, 50, 2147483647)), 0, 'huge offset does not error and returns no rows');
SELECT ok(
  (SELECT prosrc LIKE '%least(greatest(coalesce(p_offset, 0), 0), c_max_offset)%' AND prosrc LIKE '%c_max_offset constant int := 100000%'
     FROM pg_proc WHERE oid = 'app.admin_list_users(text,text,boolean,int,int)'::regprocedure),
  'offset is clamped to 100000 (c_max_offset)'
);

-- Paging, total_count and stable ordering (created_at desc, id).
SELECT is(
  (SELECT array_agg(left(id::text, 1) ORDER BY ord) FROM (SELECT id, row_number() OVER () AS ord FROM app.admin_list_users(NULL, NULL, NULL, 3, 0)) p),
  ARRAY['9', '8', '7'],
  'page 1 ordered by created_at desc'
);
SELECT is(
  (SELECT array_agg(left(id::text, 1) ORDER BY ord) FROM (SELECT id, row_number() OVER () AS ord FROM app.admin_list_users(NULL, NULL, NULL, 3, 3)) p),
  ARRAY['6', '5', '4'],
  'page 2 continues without overlap'
);
SELECT is((SELECT DISTINCT total_count FROM app.admin_list_users(NULL, NULL, NULL, 3, 6)), 9::bigint, 'total_count is full match count under paging');
SELECT is((SELECT count(*)::int FROM app.admin_list_users(NULL, NULL, NULL, 3, 100)), 0, 'offset past the end returns no rows');

RESET ROLE;
-- Tie on created_at is broken by id.
UPDATE public.users SET created_at = '2026-02-01 00:00:00+00' WHERE id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT array_agg(left(id::text, 1) ORDER BY ord) FROM (SELECT id, row_number() OVER () AS ord FROM app.admin_list_users(NULL, NULL, NULL, 2, 0)) p),
  ARRAY['1', '2'],
  'created_at ties are broken by id ascending'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
