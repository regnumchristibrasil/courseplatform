-- A5 -- app_private.lesson_assets: zero-policy default deny, and the
-- partial unique index that enables the per-lesson YouTube->Panda
-- migration (one active provider row per lesson, at most).
BEGIN;
SELECT plan(19);

SELECT has_table('app_private', 'lesson_assets', 'app_private.lesson_assets exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'app_private.lesson_assets'::regclass),
  'RLS is enabled on app_private.lesson_assets'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'app_private' AND tablename = 'lesson_assets'),
  0,
  'app_private.lesson_assets has zero RLS policies (default deny even for the owning/enrolled user)'
);
SELECT hasnt_column('public', 'lessons', 'external_ref', 'public.lessons carries no video reference column');

-- Fixtures: a published course with one lesson.
INSERT INTO public.courses (id, title, price_cents, status) VALUES
  ('c0000000-0000-0000-0000-000000000009', 'Video Course', 10000, 'published');
INSERT INTO public.lessons (id, course_id, title, position) VALUES
  ('11111111-2222-3333-4444-555555555501', 'c0000000-0000-0000-0000-000000000009', 'Lesson 1', 1);

INSERT INTO app_private.lesson_assets (lesson_id, provider, external_ref, is_active) VALUES
  ('11111111-2222-3333-4444-555555555501', 'youtube', 'yt-abc123', true);

-- Partial unique index: a second ACTIVE row for the same lesson is
-- rejected, but a second INACTIVE row (the Panda backfill, pre-cutover)
-- is allowed to coexist.
SELECT throws_ok(
  $$ INSERT INTO app_private.lesson_assets (lesson_id, provider, external_ref, is_active)
     VALUES ('11111111-2222-3333-4444-555555555501', 'panda', 'panda-xyz', true) $$,
  NULL, NULL,
  'a second ACTIVE lesson_assets row for the same lesson is rejected'
);
INSERT INTO app_private.lesson_assets (lesson_id, provider, external_ref, is_active) VALUES
  ('11111111-2222-3333-4444-555555555501', 'panda', 'panda-xyz', false);
SELECT is(
  (SELECT count(*)::int FROM app_private.lesson_assets WHERE lesson_id = '11111111-2222-3333-4444-555555555501'),
  2,
  'an inactive backfill row can coexist alongside the active one'
);

-- anon: fully denied, all four operations.
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT count(*) FROM app_private.lesson_assets $$,
  NULL, NULL,
  'anon SELECT on app_private.lesson_assets is denied'
);
SELECT throws_ok(
  $$ INSERT INTO app_private.lesson_assets (lesson_id, provider, external_ref)
     VALUES ('11111111-2222-3333-4444-555555555501', 'youtube', 'hijack') $$,
  NULL, NULL,
  'anon INSERT on app_private.lesson_assets is denied'
);
SELECT throws_ok(
  $$ UPDATE app_private.lesson_assets SET external_ref = 'hijack' $$,
  NULL, NULL,
  'anon UPDATE on app_private.lesson_assets is denied'
);
SELECT throws_ok(
  $$ DELETE FROM app_private.lesson_assets $$,
  NULL, NULL,
  'anon DELETE on app_private.lesson_assets is denied'
);
RESET ROLE;

-- authenticated, including a user with an active enrollment to the parent
-- course: still fully denied -- there is no owner-shaped policy on this
-- table at all, by design.
INSERT INTO auth.users (id, email) VALUES ('66666666-6666-6666-6666-666666666666', 'enrolled@example.com');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '66666666-6666-6666-6666-666666666666';
SELECT throws_ok(
  $$ SELECT count(*) FROM app_private.lesson_assets $$,
  NULL, NULL,
  'authenticated SELECT on app_private.lesson_assets is denied (even for an enrolled user)'
);
SELECT throws_ok(
  $$ INSERT INTO app_private.lesson_assets (lesson_id, provider, external_ref)
     VALUES ('11111111-2222-3333-4444-555555555501', 'youtube', 'hijack') $$,
  NULL, NULL,
  'authenticated INSERT on app_private.lesson_assets is denied'
);
SELECT throws_ok(
  $$ UPDATE app_private.lesson_assets SET external_ref = 'hijack' $$,
  NULL, NULL,
  'authenticated UPDATE on app_private.lesson_assets is denied'
);
SELECT throws_ok(
  $$ DELETE FROM app_private.lesson_assets $$,
  NULL, NULL,
  'authenticated DELETE on app_private.lesson_assets is denied'
);
RESET ROLE;

-- service_role: full access (bypasses RLS + explicit grants). This is the
-- per-lesson migration cutover: flip is_active from youtube to panda.
-- UPDATEs are scoped to this test's own lesson_id so they do not disturb
-- unrelated rows from seed.sql (A16).
SET LOCAL ROLE service_role;
SELECT is(
  (SELECT count(*)::int FROM app_private.lesson_assets WHERE lesson_id = '11111111-2222-3333-4444-555555555501'),
  2,
  'service_role SELECT sees every lesson_assets row for this test''s lesson, active or not'
);
UPDATE app_private.lesson_assets SET is_active = false WHERE lesson_id = '11111111-2222-3333-4444-555555555501' AND provider = 'youtube';
UPDATE app_private.lesson_assets SET is_active = true WHERE lesson_id = '11111111-2222-3333-4444-555555555501' AND provider = 'panda';
SELECT is(
  (SELECT provider FROM app_private.lesson_assets WHERE lesson_id = '11111111-2222-3333-4444-555555555501' AND is_active),
  'panda',
  'service_role can cut over the active provider with a plain UPDATE (no destructive backfill)'
);
INSERT INTO app_private.lesson_assets (lesson_id, provider, external_ref, is_active) VALUES
  ('11111111-2222-3333-4444-555555555501', 'youtube', 'yt-re-inserted', false);
SELECT is(
  (SELECT count(*)::int FROM app_private.lesson_assets WHERE lesson_id = '11111111-2222-3333-4444-555555555501' AND external_ref = 'yt-re-inserted'),
  1,
  'service_role can INSERT a lesson_assets row'
);
DELETE FROM app_private.lesson_assets WHERE lesson_id = '11111111-2222-3333-4444-555555555501' AND external_ref = 'yt-re-inserted';
SELECT is(
  (SELECT count(*)::int FROM app_private.lesson_assets WHERE lesson_id = '11111111-2222-3333-4444-555555555501' AND external_ref = 'yt-re-inserted'),
  0,
  'service_role can DELETE a lesson_assets row'
);
RESET ROLE;

-- provider is constrained to the known set (typo/garbage rejected).
SELECT throws_ok(
  $$ INSERT INTO app_private.lesson_assets (lesson_id, provider, external_ref)
     VALUES ('11111111-2222-3333-4444-555555555501', 'vimeo', 'x') $$,
  NULL, NULL,
  'an unrecognized provider value is rejected'
);

SELECT * FROM finish();
ROLLBACK;
