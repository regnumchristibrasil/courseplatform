-- A4 -- courses, lessons, courses_public: RLS access matrix row
-- "anon: S (published), owner: S, other user: S, service_role: all", with
-- explicit denial of every write path for anon/authenticated.
BEGIN;
SELECT plan(33);

SELECT has_table('public', 'courses', 'public.courses exists');
SELECT has_table('public', 'lessons', 'public.lessons exists');
SELECT has_view('public', 'courses_public', 'public.courses_public view exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.courses'::regclass),
  'RLS is enabled on public.courses'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lessons'::regclass),
  'RLS is enabled on public.lessons'
);
SELECT hasnt_column('public', 'lessons', 'video_ref', 'public.lessons has no video reference column');
SELECT hasnt_column('public', 'lessons', 'provider', 'public.lessons has no provider column');

-- courses_public exposes an explicit, exhaustive column list -- pins the
-- contract so a future internal-only column added to `courses` (cost
-- basis, gateway account id) does not silently leak through this view.
SELECT columns_are(
  'public', 'courses_public',
  ARRAY['id', 'title', 'description', 'price_cents', 'status', 'access_duration_days', 'created_at'],
  'courses_public exposes exactly the documented column list'
);

-- Fixtures: one draft, one published, one archived course; lessons on each.
INSERT INTO public.courses (id, title, price_cents, status, access_duration_days) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'Draft Course', 10000, 'draft', NULL),
  ('c0000000-0000-0000-0000-000000000002', 'Published Course', 20000, 'published', 365),
  ('c0000000-0000-0000-0000-000000000003', 'Archived Course', 30000, 'archived', NULL);

INSERT INTO public.lessons (course_id, title, position) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'Draft Lesson 1', 1),
  ('c0000000-0000-0000-0000-000000000002', 'Published Lesson 1', 1),
  ('c0000000-0000-0000-0000-000000000002', 'Published Lesson 2', 2),
  ('c0000000-0000-0000-0000-000000000003', 'Archived Lesson 1', 1);

-- anon: SELECT sees only published courses/lessons. Counts are scoped to
-- this test's own fixture ids (via a WHERE/IN filter) rather than the bare
-- table, since seed.sql (A16) also inserts published catalog rows that
-- would otherwise inflate an unscoped count(*).
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.courses WHERE id IN (
    'c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003'
  )),
  1,
  'anon SELECT on public.courses sees only the published course among this test''s fixtures'
);
SELECT is(
  (SELECT status FROM public.courses WHERE id IN (
    'c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003'
  )),
  'published',
  'anon SELECT on public.courses returns the published row'
);
SELECT is(
  (SELECT count(*)::int FROM public.courses_public WHERE id IN (
    'c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003'
  )),
  1,
  'anon SELECT on courses_public sees only the published course among this test''s fixtures'
);
SELECT is(
  (SELECT count(*)::int FROM public.lessons WHERE course_id IN (
    'c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003'
  )),
  2,
  'anon SELECT on public.lessons sees only lessons of the published course among this test''s fixtures'
);
SELECT throws_ok(
  $$ INSERT INTO public.courses (title, price_cents) VALUES ('x', 100) $$,
  NULL, NULL,
  'anon INSERT on public.courses is denied'
);
SELECT throws_ok(
  $$ UPDATE public.courses SET title = 'x' $$,
  NULL, NULL,
  'anon UPDATE on public.courses is denied'
);
SELECT throws_ok(
  $$ DELETE FROM public.courses $$,
  NULL, NULL,
  'anon DELETE on public.courses is denied'
);
SELECT throws_ok(
  $$ INSERT INTO public.lessons (course_id, title, position) VALUES ('c0000000-0000-0000-0000-000000000002', 'x', 3) $$,
  NULL, NULL,
  'anon INSERT on public.lessons is denied'
);
RESET ROLE;

-- authenticated (no enrollment, no special ownership of courses/lessons):
-- identical read visibility to anon, identical write denial.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT count(*)::int FROM public.courses WHERE id IN (
    'c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003'
  )),
  1,
  'authenticated SELECT on public.courses sees only the published course among this test''s fixtures'
);
SELECT is(
  (SELECT count(*)::int FROM public.lessons WHERE course_id IN (
    'c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003'
  )),
  2,
  'authenticated SELECT on public.lessons sees only lessons of the published course among this test''s fixtures'
);
SELECT throws_ok(
  $$ INSERT INTO public.courses (title, price_cents) VALUES ('x', 100) $$,
  NULL, NULL,
  'authenticated INSERT on public.courses is denied'
);
SELECT throws_ok(
  $$ UPDATE public.courses SET title = 'x' $$,
  NULL, NULL,
  'authenticated UPDATE on public.courses is denied'
);
SELECT throws_ok(
  $$ DELETE FROM public.courses $$,
  NULL, NULL,
  'authenticated DELETE on public.courses is denied'
);
SELECT throws_ok(
  $$ INSERT INTO public.lessons (course_id, title, position) VALUES ('c0000000-0000-0000-0000-000000000002', 'x', 3) $$,
  NULL, NULL,
  'authenticated INSERT on public.lessons is denied'
);
SELECT throws_ok(
  $$ UPDATE public.lessons SET title = 'x' $$,
  NULL, NULL,
  'authenticated UPDATE on public.lessons is denied'
);
SELECT throws_ok(
  $$ DELETE FROM public.lessons $$,
  NULL, NULL,
  'authenticated DELETE on public.lessons is denied'
);
RESET ROLE;

-- service_role: sees and can write everything (bypasses RLS + full grants).
SET LOCAL ROLE service_role;
SELECT is(
  (SELECT count(*)::int FROM public.courses WHERE id IN (
    'c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003'
  )),
  3,
  'service_role SELECT on public.courses sees draft, published, and archived among this test''s fixtures'
);
SELECT is(
  (SELECT count(*)::int FROM public.lessons WHERE course_id IN (
    'c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003'
  )),
  4,
  'service_role SELECT on public.lessons sees lessons of every course among this test''s fixtures'
);
INSERT INTO public.courses (id, title, price_cents, status) VALUES
  ('c0000000-0000-0000-0000-000000000004', 'Service-role-created course', 5000, 'draft');
SELECT is(
  (SELECT count(*)::int FROM public.courses WHERE id = 'c0000000-0000-0000-0000-000000000004'),
  1,
  'service_role can INSERT a course'
);
INSERT INTO public.lessons (course_id, title, position) VALUES
  ('c0000000-0000-0000-0000-000000000004', 'Service-role-created lesson', 1);
SELECT is(
  (SELECT count(*)::int FROM public.lessons WHERE course_id = 'c0000000-0000-0000-0000-000000000004'),
  1,
  'service_role can INSERT a lesson'
);
UPDATE public.courses SET status = 'published' WHERE id = 'c0000000-0000-0000-0000-000000000001';
SELECT is(
  (SELECT status FROM public.courses WHERE id = 'c0000000-0000-0000-0000-000000000001'),
  'published',
  'service_role can UPDATE any course'
);
DELETE FROM public.lessons WHERE course_id = 'c0000000-0000-0000-0000-000000000003';
SELECT is(
  (SELECT count(*)::int FROM public.lessons WHERE course_id = 'c0000000-0000-0000-0000-000000000003'),
  0,
  'service_role can DELETE any lesson'
);
RESET ROLE;

-- Data integrity: price_cents/access_duration_days constraints.
SELECT throws_ok(
  $$ INSERT INTO public.courses (title, price_cents) VALUES ('bad price', -1) $$,
  NULL, NULL,
  'negative price_cents is rejected'
);
SELECT throws_ok(
  $$ INSERT INTO public.courses (title, price_cents, access_duration_days) VALUES ('bad duration', 100, 0) $$,
  NULL, NULL,
  'zero access_duration_days is rejected (NULL = lifetime, must be positive otherwise)'
);
SELECT throws_ok(
  $$ INSERT INTO public.courses (title, price_cents, status) VALUES ('bad status', 100, 'not_a_status') $$,
  NULL, NULL,
  'an unrecognized courses.status value is rejected'
);

SELECT * FROM finish();
ROLLBACK;
