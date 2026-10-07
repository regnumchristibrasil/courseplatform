-- A22: fixtures locais de seed.dev.sql (superadmin, admin, tutor, 2 students).
-- Fica FORA de supabase/tests/ de proposito: so faz sentido depois de
-- `deno task seed:dev`, e `supabase test db` (sem argumento) nao deve falhar
-- num banco sem o seed de desenvolvimento. Rodar com `deno task test:seed-dev`.
BEGIN;
SELECT plan(14);

SELECT is(
  (SELECT count(*)::int FROM auth.users WHERE email LIKE '%@example.test'),
  5,
  'five fixture accounts exist in auth.users'
);

SELECT is(
  (SELECT count(*)::int FROM public.users WHERE email LIKE '%@example.test'),
  5,
  'handle_new_user created a public.users row for every fixture'
);

SELECT is(
  (SELECT count(*)::int FROM auth.identities i JOIN auth.users u ON u.id = i.user_id
    WHERE u.email LIKE '%@example.test' AND i.provider = 'email'),
  5,
  'every fixture has an email identity (required by local GoTrue)'
);

SELECT is(
  (SELECT count(*)::int FROM auth.users
    WHERE email LIKE '%@example.test' AND email_confirmed_at IS NOT NULL),
  5,
  'every fixture email is confirmed'
);

SELECT is(
  (SELECT count(*)::int FROM auth.users
    WHERE email LIKE '%@example.test'
      AND encrypted_password = crypt('local-dev-only-123', encrypted_password)),
  5,
  'every fixture password is bcrypt-hashed and verifiable'
);

SELECT results_eq(
  $$ SELECT u.email::text, ua.role, ua.is_active
       FROM auth.users u JOIN app_private.user_access ua ON ua.user_id = u.id
      WHERE u.email LIKE '%@example.test' ORDER BY u.email $$,
  $$ VALUES
    ('admin@example.test'::text, 'admin'::text, true),
    ('student-inactive@example.test', 'student', false),
    ('student@example.test', 'student', true),
    ('superadmin@example.test', 'superadmin', true),
    ('tutor@example.test', 'tutor', true) $$,
  'roles and is_active match the documented fixture matrix'
);

SELECT is(
  (SELECT id FROM auth.users WHERE email = 'superadmin@example.test'),
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'superadmin has the deterministic UUID'
);

SELECT is(
  (SELECT count(*)::int FROM auth.users u
    WHERE u.email LIKE '%@example.test' AND u.aud = 'authenticated' AND u.role = 'authenticated'),
  5,
  'fixtures carry aud/role authenticated'
);

SELECT is(
  (SELECT count(*)::int FROM auth.users
    WHERE email LIKE '%@example.test'
      AND confirmation_token IS NOT NULL AND recovery_token IS NOT NULL
      AND email_change IS NOT NULL AND email_change_token_new IS NOT NULL),
  5,
  'token columns are empty strings, not NULL (GoTrue scan requirement)'
);

SELECT is(
  (SELECT count(*)::int FROM auth.users WHERE email LIKE '%@example.test'
     AND raw_app_meta_data ->> 'provider' = 'email'),
  5,
  'app metadata declares the email provider'
);

SELECT ok(
  (SELECT count(*) = 1 FROM auth.users WHERE email = 'student-inactive@example.test'),
  'inactive student fixture exists exactly once'
);

SELECT is(
  (SELECT count(*)::int FROM app_private.user_access ua JOIN auth.users u ON u.id = ua.user_id
    WHERE u.email LIKE '%@example.test' AND ua.role = 'student'),
  2,
  'two student fixtures'
);

SELECT is(
  (SELECT count(*)::int FROM auth.users WHERE email LIKE '%@example.test'
     AND id::text LIKE 'a0000000-0000-0000-0000-00000000000_'),
  5,
  'all fixture UUIDs are deterministic in the a000... range'
);

SELECT is(
  (SELECT count(*)::int FROM public.courses WHERE id::text LIKE 'd0000000-%'),
  3,
  'existing catalog seed is untouched'
);

SELECT * FROM finish();
ROLLBACK;
