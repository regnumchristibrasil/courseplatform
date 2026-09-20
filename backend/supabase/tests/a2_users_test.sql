-- A2 -- public.users: signup trigger, email-sync trigger, and the RLS
-- access matrix row "anon: -, owner: S+U (own row), other user: -,
-- service_role: all" (prompt_course_platform.md "RLS access matrix").
BEGIN;
SELECT plan(23);

-- Table + RLS shape.
SELECT has_table('public', 'users', 'public.users exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.users'::regclass),
  'RLS is enabled on public.users'
);
SELECT hasnt_column('public', 'users', 'role', 'public.users has NO role column (self-promotion guard)');
SELECT hasnt_column('public', 'users', 'is_admin', 'public.users has NO is_admin column (self-promotion guard)');

-- Fixtures: two distinct auth.users rows, inserted as postgres (bypasses
-- RLS) so the AFTER INSERT trigger populates public.users for each.
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'user-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'user-b@example.com');

SELECT is(
  (SELECT count(*)::int FROM public.users WHERE id = '11111111-1111-1111-1111-111111111111'),
  1,
  'signup trigger populates public.users for user A'
);
SELECT is(
  (SELECT count(*)::int FROM public.users WHERE id = '22222222-2222-2222-2222-222222222222'),
  1,
  'signup trigger populates public.users for user B'
);

-- Email-sync trigger: changing auth.users.email propagates to public.users.
UPDATE auth.users SET email = 'user-a-new@example.com' WHERE id = '11111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT email FROM public.users WHERE id = '11111111-1111-1111-1111-111111111111'),
  'user-a-new@example.com',
  'email-change trigger syncs public.users.email'
);

-- anon: fully denied (RLS access matrix "-" cell, including writes). There
-- is no SELECT grant for anon at all on public.users, so this fails at the
-- privilege-check layer (before RLS even runs), not just via row filtering.
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT count(*) FROM public.users $$,
  '42501',
  NULL,
  'anon SELECT on public.users is denied'
);
SELECT throws_ok(
  $$ INSERT INTO public.users (id, email) VALUES ('33333333-3333-3333-3333-333333333333', 'x@example.com') $$,
  '42501',
  NULL,
  'anon INSERT on public.users is denied'
);
SELECT throws_ok(
  $$ UPDATE public.users SET full_name = 'x' $$,
  '42501',
  NULL,
  'anon UPDATE on public.users is denied'
);
SELECT throws_ok(
  $$ DELETE FROM public.users $$,
  '42501',
  NULL,
  'anon DELETE on public.users is denied'
);
RESET ROLE;

-- owner (authenticated, sub = user A): S + U on own row only.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

SELECT is(
  (SELECT count(*)::int FROM public.users),
  1,
  'owner SELECT sees exactly their own row, not user B''s'
);
SELECT is(
  (SELECT id FROM public.users LIMIT 1),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'owner SELECT returns their own id'
);

UPDATE public.users SET full_name = 'User A' WHERE id = auth.uid();
SELECT is(
  (SELECT full_name FROM public.users WHERE id = '11111111-1111-1111-1111-111111111111'),
  'User A',
  'owner can UPDATE their own full_name'
);

SELECT throws_ok(
  $$ UPDATE public.users SET email = 'hijacked@example.com' WHERE id = auth.uid() $$,
  '42501',
  NULL,
  'owner cannot UPDATE their own email column (server-managed, synced from auth.users)'
);

-- RLS silently filters rows the owner doesn't own -- an UPDATE targeting
-- another user's row affects zero rows, it does not error.
UPDATE public.users SET full_name = 'hijacked' WHERE id = '22222222-2222-2222-2222-222222222222';
SELECT is(
  (SELECT full_name FROM public.users WHERE id = '22222222-2222-2222-2222-222222222222'),
  NULL,
  'owner UPDATE against another user''s row affects zero rows (RLS-filtered, not an error)'
);

SELECT throws_ok(
  $$ INSERT INTO public.users (id, email) VALUES ('44444444-4444-4444-4444-444444444444', 'x@example.com') $$,
  '42501',
  NULL,
  'owner INSERT on public.users is denied (no client INSERT path -- trigger-only)'
);
SELECT throws_ok(
  $$ DELETE FROM public.users WHERE id = auth.uid() $$,
  '42501',
  NULL,
  'owner DELETE on public.users is denied'
);
RESET ROLE;

-- other user (authenticated, sub = user B): cannot see or touch user A's row.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT is(
  (SELECT count(*)::int FROM public.users WHERE id = '11111111-1111-1111-1111-111111111111'),
  0,
  'other user cannot SELECT user A''s row'
);
RESET ROLE;

-- service_role: unrestricted (bypasses RLS + has full table grants).
-- (auth.users insert done as postgres first -- public.users.id has an FK to
-- auth.users.id, and this probe intentionally exercises a direct
-- service_role INSERT into public.users, bypassing the signup trigger.)
INSERT INTO auth.users (id, email) VALUES ('55555555-5555-5555-5555-555555555555', 'service-fk-fixture@example.com');
DELETE FROM public.users WHERE id = '55555555-5555-5555-5555-555555555555';

SET LOCAL ROLE service_role;
SELECT is(
  (SELECT count(*)::int FROM public.users),
  2,
  'service_role SELECT sees all rows'
);
INSERT INTO public.users (id, email) VALUES ('55555555-5555-5555-5555-555555555555', 'service-created@example.com');
SELECT is(
  (SELECT count(*)::int FROM public.users WHERE id = '55555555-5555-5555-5555-555555555555'),
  1,
  'service_role can INSERT directly into public.users'
);
UPDATE public.users SET full_name = 'svc' WHERE id = '55555555-5555-5555-5555-555555555555';
SELECT is(
  (SELECT full_name FROM public.users WHERE id = '55555555-5555-5555-5555-555555555555'),
  'svc',
  'service_role can UPDATE any row, any column'
);
DELETE FROM public.users WHERE id = '55555555-5555-5555-5555-555555555555';
SELECT is(
  (SELECT count(*)::int FROM public.users WHERE id = '55555555-5555-5555-5555-555555555555'),
  0,
  'service_role can DELETE any row'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
