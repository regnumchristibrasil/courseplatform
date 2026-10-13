-- A35 -- public.lesson_progress e app.my_courses() (ticket #23; ADR 0004).
-- Progresso pertence ao aluno e a aula (nao a matricula). "Meus cursos" lista
-- cursos com matricula 'active' (valida ou expirada); reembolsada nao aparece.
-- Percentual = aulas ativas concluidas / aulas ativas; arquivadas ficam fora.
-- Sem direito = zero linhas, nunca erro.
BEGIN;
SELECT plan(31);

-- Fixtures --------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'student@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'other@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'inactive@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'nocourses@example.com');

INSERT INTO public.courses (id, title, price_cents, status) VALUES
  ('c0000000-0000-0000-0000-0000000000a1', 'Valid A', 10000, 'published'),
  ('c0000000-0000-0000-0000-0000000000b1', 'Expired B', 10000, 'published'),
  ('c0000000-0000-0000-0000-0000000000c1', 'Refunded C', 10000, 'published'),
  ('c0000000-0000-0000-0000-0000000000d1', 'Draft D', 10000, 'draft'),
  ('c0000000-0000-0000-0000-0000000000e1', 'Expired Archived E', 10000, 'archived'),
  ('c0000000-0000-0000-0000-0000000000f1', 'Not enrolled F', 10000, 'published'),
  ('c0000000-0000-0000-0000-0000000000a2', 'Empty G', 10000, 'published');

INSERT INTO public.modules (id, course_id, title, position, archived_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'A / M1', 1, NULL),
  ('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000a1', 'A / M2 archived', 2, now()),
  ('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000b1', 'B / M1', 1, NULL),
  ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000c1', 'C / M1', 1, NULL),
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d1', 'D / M1', 1, NULL),
  ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000e1', 'E / M1', 1, NULL),
  ('f5000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000f1', 'F / M1', 1, NULL),
  ('a2000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a2', 'G / M1', 1, NULL);

-- A: 4 aulas ativas (A1..A4), 1 arquivada (A5), 1 em modulo arquivado (A6).
INSERT INTO public.lessons (id, course_id, module_id, title, position, archived_at) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A1', 1, NULL),
  ('a1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A2', 2, NULL),
  ('a1000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A3', 3, NULL),
  ('a1000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A4', 4, NULL),
  ('a1000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A5 archived', 5, now()),
  ('a1000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000002', 'A6 in archived module', 1, NULL),
  ('b1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'B1', 1, NULL),
  ('b1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'B2', 2, NULL),
  ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-000000000001', 'C1', 1, NULL),
  ('d1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-000000000001', 'D1', 1, NULL),
  ('e1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000e1', 'e0000000-0000-0000-0000-000000000001', 'E1', 1, NULL),
  ('f1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000f1', 'f5000000-0000-0000-0000-000000000001', 'F1', 1, NULL);

-- student: A valida; B expirada (recomprada abaixo e depois nao); C reembolsada;
-- D (rascunho) valida; E (arquivado) expirada; G sem aulas.
INSERT INTO public.enrollments (user_id, course_id, status, granted_at, expires_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a1', 'active', now() - interval '5 days', now() + interval '30 days'),
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000b1', 'active', now() - interval '60 days', now() - interval '1 day'),
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000c1', 'refunded', now() - interval '10 days', NULL),
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000d1', 'active', now() - interval '3 days', NULL),
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000e1', 'active', now() - interval '90 days', now() - interval '2 days'),
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a2', 'active', now() - interval '1 day', NULL),
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-0000000000a1', 'active', now(), NULL),
  ('33333333-3333-3333-3333-333333333333', 'c0000000-0000-0000-0000-0000000000a1', 'active', now(), NULL);
UPDATE app_private.user_access SET is_active = false
 WHERE user_id = '33333333-3333-3333-3333-333333333333';

-- Progresso (inserido como superuser, antes de trocar de papel).
-- student em A: A1, A2 concluidas; A3 aberta e nao concluida; A5 (arquivada) e
-- A6 (modulo arquivado) concluidas -- ficam fora do percentual. other: A1.
INSERT INTO public.lesson_progress (user_id, lesson_id, first_opened_at, completed_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', now(), now()),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000002', now(), now()),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000003', now(), NULL),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000005', now(), now()),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000006', now(), now()),
  ('11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000001', now(), now()),
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'a1000000-0000-0000-0000-000000000001', now(), now());

-- Shape ---------------------------------------------------------------
SELECT has_table('public', 'lesson_progress', 'lesson_progress exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lesson_progress'::regclass),
  'lesson_progress has RLS enabled'
);
SELECT is(
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lesson_progress'),
  0::bigint,
  'lesson_progress has no policies (RPC-only access, ADR 0004)'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.lesson_progress', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.lesson_progress', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.lesson_progress', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.lesson_progress', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.lesson_progress', 'SELECT'),
  'clients have no table privileges on lesson_progress'
);
SELECT has_function('app', 'my_courses', ARRAY[]::text[], 'app.my_courses exists');
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'app.my_courses()'::regprocedure),
  'my_courses is SECURITY DEFINER'
);
SELECT ok(
  (SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'app.my_courses()'::regprocedure),
  'my_courses pins search_path to empty'
);
SELECT ok(has_function_privilege('authenticated', 'app.my_courses()', 'EXECUTE'), 'authenticated can EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'app.my_courses()', 'EXECUTE'), 'anon cannot EXECUTE');
SELECT ok(NOT has_function_privilege('public', 'app.my_courses()', 'EXECUTE'), 'PUBLIC cannot EXECUTE');

-- Clients cannot touch the table directly -------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT throws_ok($$ SELECT * FROM public.lesson_progress $$, '42501', NULL, 'authenticated cannot read lesson_progress');
SELECT throws_ok(
  $$ INSERT INTO public.lesson_progress (user_id, lesson_id) VALUES ('11111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'authenticated cannot write lesson_progress'
);

-- Listing -------------------------------------------------------------
SELECT results_eq(
  $$ SELECT course_id FROM app.my_courses() $$,
  $$ VALUES ('c0000000-0000-0000-0000-0000000000a2'::uuid),
            ('c0000000-0000-0000-0000-0000000000d1'::uuid),
            ('c0000000-0000-0000-0000-0000000000a1'::uuid),
            ('c0000000-0000-0000-0000-0000000000b1'::uuid),
            ('c0000000-0000-0000-0000-0000000000e1'::uuid) $$,
  'lists valid then expired enrollments; refunded and non-enrolled are absent (valid first, newest grant first)'
);
SELECT is(
  (SELECT count(*) FROM app.my_courses() WHERE course_id = 'c0000000-0000-0000-0000-0000000000c1'),
  0::bigint,
  'refunded course does not appear'
);
SELECT is(
  (SELECT count(*) FROM app.my_courses() WHERE course_id = 'c0000000-0000-0000-0000-0000000000f1'),
  0::bigint,
  'course without enrollment does not appear'
);

-- Percentual: A tem 4 aulas ativas, 2 concluidas (A5/A6 fora) => 50%.
SELECT results_eq(
  $$ SELECT total_lessons, completed_lessons, progress_percent
     FROM app.my_courses() WHERE course_id = 'c0000000-0000-0000-0000-0000000000a1' $$,
  $$ VALUES (4::integer, 2::integer, 50::integer) $$,
  'progress counts only active lessons (archived lesson and archived module excluded)'
);
SELECT results_eq(
  $$ SELECT is_expired, expires_at IS NOT NULL
     FROM app.my_courses() WHERE course_id = 'c0000000-0000-0000-0000-0000000000a1' $$,
  $$ VALUES (false, true) $$,
  'valid enrollment is not expired'
);
SELECT results_eq(
  $$ SELECT is_expired, course_status, progress_percent
     FROM app.my_courses() WHERE course_id = 'c0000000-0000-0000-0000-0000000000b1' $$,
  $$ VALUES (true, 'published', 50::integer) $$,
  'expired enrollment is flagged, keeps progress and reports course status'
);
SELECT results_eq(
  $$ SELECT is_expired, course_status
     FROM app.my_courses() WHERE course_id = 'c0000000-0000-0000-0000-0000000000e1' $$,
  $$ VALUES (true, 'archived') $$,
  'expired archived course is flagged so the client cannot offer repurchase'
);
SELECT results_eq(
  $$ SELECT total_lessons, progress_percent
     FROM app.my_courses() WHERE course_id = 'c0000000-0000-0000-0000-0000000000a2' $$,
  $$ VALUES (0::integer, 0::integer) $$,
  'course without active lessons reports 0 percent (no division by zero)'
);
SELECT results_eq(
  $$ SELECT is_expired, course_status
     FROM app.my_courses() WHERE course_id = 'c0000000-0000-0000-0000-0000000000d1' $$,
  $$ VALUES (false, 'draft') $$,
  'valid enrollment in an unpublished course still lists (A26 rule)'
);

-- Isolation: another student sees only their own progress.
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT results_eq(
  $$ SELECT course_id, completed_lessons, progress_percent FROM app.my_courses() $$,
  $$ VALUES ('c0000000-0000-0000-0000-0000000000a1'::uuid, 1::integer, 25::integer) $$,
  'another student sees only own courses and own progress'
);

-- Zero rows, never error ----------------------------------------------
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT is((SELECT count(*) FROM app.my_courses()), 0::bigint, 'deactivated user gets zero rows');
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT is((SELECT count(*) FROM app.my_courses()), 0::bigint, 'user without enrollments gets zero rows');
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000000';
SELECT is((SELECT count(*) FROM app.my_courses()), 0::bigint, 'unknown uid gets zero rows');
SET LOCAL "request.jwt.claim.sub" = '';
SELECT is((SELECT count(*) FROM app.my_courses()), 0::bigint, 'authenticated without sub gets zero rows');
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT * FROM app.my_courses() $$, '42501', NULL, 'anon denied by grants');

-- Progress survives repurchase (new enrollment, same lessons) ----------
RESET ROLE;
UPDATE public.enrollments SET status = 'expired'
 WHERE user_id = '11111111-1111-1111-1111-111111111111'
   AND course_id = 'c0000000-0000-0000-0000-0000000000b1';
INSERT INTO public.enrollments (user_id, course_id, status, granted_at, expires_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000b1', 'active', now(), NULL);
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT results_eq(
  $$ SELECT is_expired, progress_percent
     FROM app.my_courses() WHERE course_id = 'c0000000-0000-0000-0000-0000000000b1' $$,
  $$ VALUES (false, 50::integer) $$,
  'repurchase after expiry: course valid again with progress preserved'
);
SELECT is(
  (SELECT count(*) FROM app.my_courses() WHERE course_id = 'c0000000-0000-0000-0000-0000000000b1'),
  1::bigint,
  'repurchase yields a single card per course'
);

-- Unarchiving restores archived completion (ADR 0004).
RESET ROLE;
UPDATE public.lessons SET archived_at = NULL WHERE id = 'a1000000-0000-0000-0000-000000000005';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT results_eq(
  $$ SELECT total_lessons, completed_lessons
     FROM app.my_courses() WHERE course_id = 'c0000000-0000-0000-0000-0000000000a1' $$,
  $$ VALUES (5::integer, 3::integer) $$,
  'unarchiving a lesson restores its recorded completion'
);

-- Reembolso da recompra esconde o curso mesmo com historico 'expired'.
RESET ROLE;
UPDATE public.enrollments SET status = 'refunded'
 WHERE user_id = '11111111-1111-1111-1111-111111111111'
   AND course_id = 'c0000000-0000-0000-0000-0000000000b1'
   AND status = 'active';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT count(*) FROM app.my_courses() WHERE course_id = 'c0000000-0000-0000-0000-0000000000b1'),
  0::bigint,
  'refund after an expired history hides the course'
);

SELECT * FROM finish();
ROLLBACK;
