-- A14 -- grants audit: a single, consolidated sweep of the ENTIRE frozen
-- RLS access matrix (prompt_course_platform.md, "RLS access matrix
-- (frozen)"), one row per table, checking every anon/authenticated/
-- service_role cell -- including every "-" (denied) cell explicitly, not
-- just the allowed reads. This complements (does not replace) the
-- per-table functional RLS tests in a2-a9_*_test.sql: those prove ROW-level
-- behavior (e.g. "an owner sees only their own row"); this file proves the
-- GRANT-level shape of the matrix, all in one place, so a future migration
-- that accidentally widens a grant on any table shows up here even if its
-- own test file's happy-path assertions still pass.
BEGIN;
SELECT plan(47);

-- RLS enabled on every actual table (not the courses_public view, which is
-- a security_invoker view over an RLS-protected base table, not RLS itself).
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.users'::regclass), 'RLS enabled: public.users');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.courses'::regclass), 'RLS enabled: public.courses');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lessons'::regclass), 'RLS enabled: public.lessons');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.enrollments'::regclass), 'RLS enabled: public.enrollments');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.orders'::regclass), 'RLS enabled: public.orders');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'app_private.lesson_assets'::regclass), 'RLS enabled: app_private.lesson_assets');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'app_private.payment_events'::regclass), 'RLS enabled: app_private.payment_events');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'app_private.email_outbox'::regclass), 'RLS enabled: app_private.email_outbox');

-- Zero-policy tables (app_private.user_roles is supplemental -- it is not
-- itself a row in the frozen matrix table, but follows the identical
-- zero-policy/service-role-only posture as the three that are).
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'app_private' AND tablename = 'lesson_assets'), 0, 'zero policies: app_private.lesson_assets');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'app_private' AND tablename = 'payment_events'), 0, 'zero policies: app_private.payment_events');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'app_private' AND tablename = 'email_outbox'), 0, 'zero policies: app_private.email_outbox');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'app_private' AND tablename = 'user_roles'), 0, 'zero policies: app_private.user_roles (supplemental, same posture)');

-- public.users -- matrix row "anon: -, owner: S+U (own row), other: -, service_role: all".
-- (RLS distinguishes "owner" from "other user" for the same authenticated
-- grantee; that row-level distinction is covered by a2_users_test.sql, not
-- re-tested here -- this file checks the GRANT shape only.)
SELECT is(
  (SELECT coalesce(array_agg(privilege_type::text ORDER BY privilege_type), ARRAY[]::text[]) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'users' AND grantee = 'anon'),
  ARRAY[]::text[],
  'public.users x anon: no grants'
);
-- UPDATE on users is a COLUMN-level grant (full_name, avatar_url only --
-- see A2), which does not appear in role_table_grants at all (that view
-- only reports table-level privileges); checked separately below via
-- has_column_privilege, alongside proof that id/email are NOT grantable.
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'users' AND grantee = 'authenticated'),
  ARRAY['SELECT'],
  'public.users x authenticated: SELECT at the table level (no INSERT/DELETE -- no client-created rows, ever)'
);
SELECT ok(
  has_column_privilege('authenticated', 'public.users', 'full_name', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.users', 'avatar_url', 'UPDATE'),
  'public.users x authenticated: column-level UPDATE on full_name/avatar_url (the "U (own row)" part of the matrix cell)'
);
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.users', 'email', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.users', 'id', 'UPDATE'),
  'public.users x authenticated: NO column-level UPDATE on id/email (server-managed)'
);
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'users' AND grantee = 'service_role'),
  ARRAY['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'],
  'public.users x service_role: all (plus the structural REFERENCES/TRIGGER/TRUNCATE privileges this repo leaves in place for its own trusted service role -- see this migration''s top-of-file comment)'
);

-- public.courses / courses_public -- matrix row "anon: S (published),
-- owner: S, other: S, service_role: all".
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'courses' AND grantee = 'anon'),
  ARRAY['SELECT'],
  'public.courses x anon: SELECT only'
);
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'courses' AND grantee = 'authenticated'),
  ARRAY['SELECT'],
  'public.courses x authenticated: SELECT only'
);
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'courses' AND grantee = 'service_role'),
  ARRAY['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'],
  'public.courses x service_role: all (plus structural REFERENCES/TRIGGER/TRUNCATE -- see this migration''s top-of-file comment)'
);
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'courses_public' AND grantee = 'anon'),
  ARRAY['SELECT'],
  'public.courses_public x anon: SELECT only'
);
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'courses_public' AND grantee = 'authenticated'),
  ARRAY['SELECT'],
  'public.courses_public x authenticated: SELECT only'
);
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'courses_public' AND grantee = 'service_role'),
  ARRAY['REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE'],
  'public.courses_public x service_role: SELECT (writes go through the base table, courses) plus structural REFERENCES/TRIGGER/TRUNCATE'
);

-- public.lessons -- matrix row "anon: S (parent published), owner: S,
-- other: S, service_role: all".
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'lessons' AND grantee = 'anon'),
  ARRAY['SELECT'],
  'public.lessons x anon: SELECT only'
);
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'lessons' AND grantee = 'authenticated'),
  ARRAY['SELECT'],
  'public.lessons x authenticated: SELECT only'
);
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'lessons' AND grantee = 'service_role'),
  ARRAY['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'],
  'public.lessons x service_role: all (plus structural REFERENCES/TRIGGER/TRUNCATE -- see this migration''s top-of-file comment)'
);

-- public.enrollments -- matrix row "anon: -, owner: S (own), other: -,
-- service_role: all".
SELECT is(
  (SELECT coalesce(array_agg(privilege_type::text ORDER BY privilege_type), ARRAY[]::text[]) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'enrollments' AND grantee = 'anon'),
  ARRAY[]::text[],
  'public.enrollments x anon: no grants'
);
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'enrollments' AND grantee = 'authenticated'),
  ARRAY['SELECT'],
  'public.enrollments x authenticated: SELECT only -- no client writes, ever'
);
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'enrollments' AND grantee = 'service_role'),
  ARRAY['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'],
  'public.enrollments x service_role: all (plus structural REFERENCES/TRIGGER/TRUNCATE -- see this migration''s top-of-file comment)'
);

-- public.orders -- matrix row "anon: -, owner: S (own), other: -,
-- service_role: all".
SELECT is(
  (SELECT coalesce(array_agg(privilege_type::text ORDER BY privilege_type), ARRAY[]::text[]) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'orders' AND grantee = 'anon'),
  ARRAY[]::text[],
  'public.orders x anon: no grants'
);
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'orders' AND grantee = 'authenticated'),
  ARRAY['SELECT'],
  'public.orders x authenticated: SELECT only -- amount_cents is never client-writable'
);
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'orders' AND grantee = 'service_role'),
  ARRAY['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'],
  'public.orders x service_role: all (plus structural REFERENCES/TRIGGER/TRUNCATE -- see this migration''s top-of-file comment)'
);

-- app_private.lesson_assets -- matrix row "anon: -, owner: -, other: -,
-- service_role: all".
SELECT is(
  (SELECT coalesce(array_agg(privilege_type::text ORDER BY privilege_type), ARRAY[]::text[]) FROM information_schema.role_table_grants WHERE table_schema = 'app_private' AND table_name = 'lesson_assets' AND grantee = 'anon'),
  ARRAY[]::text[],
  'app_private.lesson_assets x anon: no grants'
);
SELECT is(
  (SELECT coalesce(array_agg(privilege_type::text ORDER BY privilege_type), ARRAY[]::text[]) FROM information_schema.role_table_grants WHERE table_schema = 'app_private' AND table_name = 'lesson_assets' AND grantee = 'authenticated'),
  ARRAY[]::text[],
  'app_private.lesson_assets x authenticated: no grants (reachable only via app.get_playable_ref)'
);
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'app_private' AND table_name = 'lesson_assets' AND grantee = 'service_role'),
  ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  'app_private.lesson_assets x service_role: all'
);

-- app_private.payment_events -- matrix row "anon: -, owner: -, other: -,
-- service_role: all".
SELECT is(
  (SELECT coalesce(array_agg(privilege_type::text ORDER BY privilege_type), ARRAY[]::text[]) FROM information_schema.role_table_grants WHERE table_schema = 'app_private' AND table_name = 'payment_events' AND grantee = 'anon'),
  ARRAY[]::text[],
  'app_private.payment_events x anon: no grants'
);
SELECT is(
  (SELECT coalesce(array_agg(privilege_type::text ORDER BY privilege_type), ARRAY[]::text[]) FROM information_schema.role_table_grants WHERE table_schema = 'app_private' AND table_name = 'payment_events' AND grantee = 'authenticated'),
  ARRAY[]::text[],
  'app_private.payment_events x authenticated: no grants'
);
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'app_private' AND table_name = 'payment_events' AND grantee = 'service_role'),
  ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  'app_private.payment_events x service_role: all'
);

-- app_private.email_outbox -- matrix row "anon: -, owner: -, other: -,
-- service_role: all".
SELECT is(
  (SELECT coalesce(array_agg(privilege_type::text ORDER BY privilege_type), ARRAY[]::text[]) FROM information_schema.role_table_grants WHERE table_schema = 'app_private' AND table_name = 'email_outbox' AND grantee = 'anon'),
  ARRAY[]::text[],
  'app_private.email_outbox x anon: no grants'
);
SELECT is(
  (SELECT coalesce(array_agg(privilege_type::text ORDER BY privilege_type), ARRAY[]::text[]) FROM information_schema.role_table_grants WHERE table_schema = 'app_private' AND table_name = 'email_outbox' AND grantee = 'authenticated'),
  ARRAY[]::text[],
  'app_private.email_outbox x authenticated: no grants (no client-triggered send)'
);
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'app_private' AND table_name = 'email_outbox' AND grantee = 'service_role'),
  ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  'app_private.email_outbox x service_role: all'
);

-- app_private.user_roles -- supplemental, same posture, not itself a row
-- in the frozen matrix table (see A3).
SELECT is(
  (SELECT coalesce(array_agg(privilege_type::text ORDER BY privilege_type), ARRAY[]::text[]) FROM information_schema.role_table_grants WHERE table_schema = 'app_private' AND table_name = 'user_roles' AND grantee = 'anon'),
  ARRAY[]::text[],
  'app_private.user_roles x anon: no grants'
);
SELECT is(
  (SELECT coalesce(array_agg(privilege_type::text ORDER BY privilege_type), ARRAY[]::text[]) FROM information_schema.role_table_grants WHERE table_schema = 'app_private' AND table_name = 'user_roles' AND grantee = 'authenticated'),
  ARRAY[]::text[],
  'app_private.user_roles x authenticated: no grants (no self-granted admin)'
);
SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'app_private' AND table_name = 'user_roles' AND grantee = 'service_role'),
  ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  'app_private.user_roles x service_role: all'
);

-- The audit view itself: diagnostic-only, service_role only.
SELECT has_view('app_private', 'audit_privileges', 'app_private.audit_privileges diagnostic view exists');
SELECT ok(
  has_table_privilege('service_role', 'app_private.audit_privileges', 'SELECT'),
  'service_role can SELECT app_private.audit_privileges'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'app_private.audit_privileges', 'SELECT'),
  'authenticated cannot SELECT app_private.audit_privileges'
);

SELECT * FROM finish();
ROLLBACK;
