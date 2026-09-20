-- A11 -- app.get_playable_ref: the only client-reachable read path onto
-- app_private.lesson_assets. Covers entitled/not-entitled/free-preview/
-- expired/refunded/missing-lesson/inactive-asset, and proves "not
-- entitled" and "lesson missing" are observationally identical (zero rows).
BEGIN;
SELECT plan(15);

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'enrolled@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'not-enrolled@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'expired@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'refunded@example.com');

INSERT INTO public.courses (id, title, price_cents, status) VALUES
  ('c0000000-0000-0000-0000-00000000000a', 'Video Course', 10000, 'published');

INSERT INTO public.lessons (id, course_id, title, position, is_free_preview) VALUES
  ('11111111-2222-3333-4444-555555555501', 'c0000000-0000-0000-0000-00000000000a', 'Regular Lesson', 1, false),
  ('11111111-2222-3333-4444-555555555502', 'c0000000-0000-0000-0000-00000000000a', 'Free Preview Lesson', 2, true),
  ('11111111-2222-3333-4444-555555555503', 'c0000000-0000-0000-0000-00000000000a', 'Inactive-Asset-Only Lesson', 3, false);

INSERT INTO app_private.lesson_assets (lesson_id, provider, external_ref, is_active) VALUES
  ('11111111-2222-3333-4444-555555555501', 'youtube', 'yt-regular', true),
  ('11111111-2222-3333-4444-555555555502', 'youtube', 'yt-preview', true),
  ('11111111-2222-3333-4444-555555555503', 'youtube', 'yt-inactive', false);

INSERT INTO public.enrollments (user_id, course_id, status, granted_at, expires_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a', 'active', now(), NULL),
  ('33333333-3333-3333-3333-333333333333', 'c0000000-0000-0000-0000-00000000000a', 'active', now() - interval '40 days', now() - interval '1 day'),
  ('44444444-4444-4444-4444-444444444444', 'c0000000-0000-0000-0000-00000000000a', 'refunded', now() - interval '5 days', NULL);

-- Entitled user: resolves the active provider/external_ref.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT results_eq(
  $$ SELECT lesson_id, provider, external_ref FROM app.get_playable_ref('11111111-2222-3333-4444-555555555501'::uuid) $$,
  $$ VALUES ('11111111-2222-3333-4444-555555555501'::uuid, 'youtube'::text, 'yt-regular'::text) $$,
  'an enrolled user resolves the active lesson_assets row'
);
RESET ROLE;

-- Not entitled, not a free preview: zero rows.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT is(
  (SELECT count(*)::int FROM app.get_playable_ref('11111111-2222-3333-4444-555555555501'::uuid)),
  0,
  'a non-enrolled user gets zero rows for a non-preview lesson'
);

-- Not entitled, but the lesson is a free preview: resolves anyway.
SELECT results_eq(
  $$ SELECT provider, external_ref FROM app.get_playable_ref('11111111-2222-3333-4444-555555555502'::uuid) $$,
  $$ VALUES ('youtube'::text, 'yt-preview'::text) $$,
  'a non-enrolled user still resolves a free-preview lesson'
);

-- Lesson does not exist at all: zero rows, same shape as "not entitled".
SELECT is(
  (SELECT count(*)::int FROM app.get_playable_ref('99999999-9999-9999-9999-999999999999'::uuid)),
  0,
  'a nonexistent lesson_id returns zero rows, not an error'
);
RESET ROLE;

-- Expired enrollment: zero rows (has_active_enrollment's time check applies
-- identically here).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT is(
  (SELECT count(*)::int FROM app.get_playable_ref('11111111-2222-3333-4444-555555555501'::uuid)),
  0,
  'a user with an expired enrollment gets zero rows'
);
RESET ROLE;

-- Refunded enrollment: zero rows.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT is(
  (SELECT count(*)::int FROM app.get_playable_ref('11111111-2222-3333-4444-555555555501'::uuid)),
  0,
  'a user with a refunded enrollment gets zero rows'
);
RESET ROLE;

-- Entitled user, but the only lesson_assets row is inactive (mid-migration
-- backfill state): zero rows -- entitlement alone is not enough, an active
-- asset row must also exist.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT count(*)::int FROM app.get_playable_ref('11111111-2222-3333-4444-555555555503'::uuid)),
  0,
  'an entitled user gets zero rows when only an inactive asset row exists'
);
RESET ROLE;

-- No client read path onto app_private.lesson_assets is opened by this
-- function -- direct access is still fully denied (A5's zero-policy RLS).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT throws_ok(
  $$ SELECT count(*) FROM app_private.lesson_assets $$,
  NULL, NULL,
  'app.get_playable_ref does not open a direct SELECT path onto app_private.lesson_assets'
);
RESET ROLE;

-- Grant surface: authenticated only.
SELECT ok(
  has_function_privilege('authenticated', 'app.get_playable_ref(uuid)', 'EXECUTE'),
  'authenticated has EXECUTE on get_playable_ref'
);
SELECT ok(
  NOT has_function_privilege('anon', 'app.get_playable_ref(uuid)', 'EXECUTE'),
  'anon has NO EXECUTE on get_playable_ref'
);

-- Data sanity: exactly the fixtures we expect, no cross-contamination.
SELECT is(
  (SELECT count(*)::int FROM public.enrollments WHERE course_id = 'c0000000-0000-0000-0000-00000000000a'),
  3,
  'sanity: three enrollment fixtures exist for the video course'
);
SELECT is(
  (SELECT count(*)::int FROM app_private.lesson_assets WHERE lesson_id IN (
    '11111111-2222-3333-4444-555555555501', '11111111-2222-3333-4444-555555555502', '11111111-2222-3333-4444-555555555503'
  )),
  3,
  'sanity: three lesson_assets fixtures exist'
);
SELECT is(
  (SELECT count(*)::int FROM public.lessons WHERE course_id = 'c0000000-0000-0000-0000-00000000000a'),
  3,
  'sanity: three lesson fixtures exist'
);
SELECT is(
  (SELECT is_free_preview FROM public.lessons WHERE id = '11111111-2222-3333-4444-555555555502'),
  true,
  'sanity: the free-preview fixture lesson is actually flagged as such'
);
SELECT ok(
  NOT (SELECT is_free_preview FROM public.lessons WHERE id = '11111111-2222-3333-4444-555555555501'),
  'sanity: the regular fixture lesson is not flagged as a free preview'
);

SELECT * FROM finish();
ROLLBACK;
