-- A37 -- app.start_lesson(lesson_id) (ticket #25; ADR 0004).
-- Registra "em andamento" (first_opened_at gravado uma vez, idempotente).
-- Sem direito, equipe, aula/modulo arquivado, desativado, sem sessao ou aula
-- inexistente = zero linhas e nenhum efeito, nunca erro.
BEGIN;
SELECT plan(23);

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'student@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'other@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'inactive@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'tutor@example.com');
UPDATE app_private.user_access SET role = 'tutor' WHERE user_id = '44444444-4444-4444-4444-444444444444';
UPDATE app_private.user_access SET is_active = false WHERE user_id = '33333333-3333-3333-3333-333333333333';

INSERT INTO public.courses (id, title, price_cents, status) VALUES
  ('c0000000-0000-0000-0000-0000000000a1', 'Valid A', 10000, 'published'),
  ('c0000000-0000-0000-0000-0000000000b1', 'Expired B', 10000, 'published'),
  ('c0000000-0000-0000-0000-0000000000c1', 'Refunded C', 10000, 'published'),
  ('c0000000-0000-0000-0000-0000000000f1', 'Preview only F', 10000, 'published');
INSERT INTO public.modules (id, course_id, title, position, archived_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'A / M1', 1, NULL),
  ('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000a1', 'A / M2 archived', 2, now()),
  ('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000b1', 'B / M1', 1, NULL),
  ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000c1', 'C / M1', 1, NULL),
  ('f5000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000f1', 'F / M1', 1, NULL);
INSERT INTO public.lessons (id, course_id, module_id, title, position, is_free_preview, archived_at) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A1', 1, false, NULL),
  ('a1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A2 archived', 2, false, now()),
  ('a1000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000002', 'A3 in archived module', 1, false, NULL),
  ('a1000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A4', 3, false, NULL),
  ('b1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'B1', 1, false, NULL),
  ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-000000000001', 'C1', 1, false, NULL),
  ('f1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000f1', 'f5000000-0000-0000-0000-000000000001', 'F1', 1, true, NULL);
INSERT INTO public.enrollments (user_id, course_id, status, granted_at, expires_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a1', 'active', now() - interval '5 days', now() + interval '30 days'),
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000b1', 'active', now() - interval '60 days', now() - interval '1 day'),
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000c1', 'refunded', now() - interval '10 days', NULL),
  ('33333333-3333-3333-3333-333333333333', 'c0000000-0000-0000-0000-0000000000a1', 'active', now(), NULL);

-- Shape ---------------------------------------------------------------
SELECT has_function('app', 'start_lesson', ARRAY['uuid'], 'app.start_lesson exists');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'app.start_lesson(uuid)'::regprocedure), 'start_lesson is SECURITY DEFINER');
SELECT ok((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'app.start_lesson(uuid)'::regprocedure), 'start_lesson pins search_path to empty');
SELECT ok(has_function_privilege('authenticated', 'app.start_lesson(uuid)', 'EXECUTE'), 'authenticated can EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'app.start_lesson(uuid)', 'EXECUTE'), 'anon cannot EXECUTE');
SELECT ok(NOT has_function_privilege('public', 'app.start_lesson(uuid)', 'EXECUTE'), 'PUBLIC cannot EXECUTE');

-- Aluno matriculado -------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

SELECT results_eq(
  $$ SELECT lesson_id FROM app.start_lesson('a1000000-0000-0000-0000-000000000001') $$,
  $$ VALUES ('a1000000-0000-0000-0000-000000000001'::uuid) $$,
  'enrolled student starts a lesson: one row'
);
RESET ROLE;
SELECT results_eq(
  $$ SELECT completed_at IS NULL FROM public.lesson_progress
     WHERE user_id = '11111111-1111-1111-1111-111111111111' AND lesson_id = 'a1000000-0000-0000-0000-000000000001' $$,
  $$ VALUES (true) $$,
  'a progress row exists, in progress (not completed)'
);
-- Idempotencia: first_opened_at nao muda na segunda chamada.
UPDATE public.lesson_progress SET first_opened_at = '2020-01-01T00:00:00Z'
 WHERE user_id = '11111111-1111-1111-1111-111111111111' AND lesson_id = 'a1000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT results_eq(
  $$ SELECT lesson_id FROM app.start_lesson('a1000000-0000-0000-0000-000000000001') $$,
  $$ VALUES ('a1000000-0000-0000-0000-000000000001'::uuid) $$,
  'starting again still returns the row'
);
RESET ROLE;
SELECT results_eq(
  $$ SELECT count(*)::integer, min(first_opened_at) FROM public.lesson_progress
     WHERE user_id = '11111111-1111-1111-1111-111111111111' AND lesson_id = 'a1000000-0000-0000-0000-000000000001' $$,
  $$ VALUES (1, '2020-01-01T00:00:00Z'::timestamptz) $$,
  'idempotent: still one row and first_opened_at is kept'
);

-- Nao rebaixa uma aula ja concluida.
UPDATE public.lesson_progress SET completed_at = now()
 WHERE user_id = '11111111-1111-1111-1111-111111111111' AND lesson_id = 'a1000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*) FROM app.start_lesson('a1000000-0000-0000-0000-000000000001')), 1::bigint,
  'starting a completed lesson is accepted');
RESET ROLE;
SELECT ok(
  (SELECT completed_at IS NOT NULL FROM public.lesson_progress
   WHERE user_id = '11111111-1111-1111-1111-111111111111' AND lesson_id = 'a1000000-0000-0000-0000-000000000001'),
  'starting does not clear a recorded completion'
);

-- Sem efeito ---------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*) FROM app.start_lesson('a1000000-0000-0000-0000-000000000002')), 0::bigint, 'archived lesson: zero rows');
SELECT is((SELECT count(*) FROM app.start_lesson('a1000000-0000-0000-0000-000000000003')), 0::bigint, 'lesson in archived module: zero rows');
SELECT is((SELECT count(*) FROM app.start_lesson('b1000000-0000-0000-0000-000000000001')), 0::bigint, 'expired enrollment: zero rows');
SELECT is((SELECT count(*) FROM app.start_lesson('c1000000-0000-0000-0000-000000000001')), 0::bigint, 'refunded enrollment: zero rows');
SELECT is((SELECT count(*) FROM app.start_lesson('f1000000-0000-0000-0000-000000000001')), 0::bigint, 'free preview alone: zero rows');
SELECT is((SELECT count(*) FROM app.start_lesson('99999999-9999-9999-9999-999999999999')), 0::bigint, 'unknown lesson: zero rows');
SELECT is((SELECT count(*) FROM app.start_lesson(NULL)), 0::bigint, 'NULL lesson id: zero rows');

SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT is((SELECT count(*) FROM app.start_lesson('a1000000-0000-0000-0000-000000000004')), 0::bigint, 'deactivated user: zero rows');
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT is((SELECT count(*) FROM app.start_lesson('a1000000-0000-0000-0000-000000000004')), 0::bigint, 'staff: zero rows (progress is hidden for staff)');
SET LOCAL "request.jwt.claim.sub" = '';
SELECT is((SELECT count(*) FROM app.start_lesson('a1000000-0000-0000-0000-000000000004')), 0::bigint, 'no session: zero rows');

RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.lesson_progress WHERE lesson_id IN (
     'a1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000003','b1000000-0000-0000-0000-000000000001',
     'c1000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000004')),
  0::bigint,
  'none of the rejected calls wrote a progress row'
);

SELECT * FROM finish();
ROLLBACK;
