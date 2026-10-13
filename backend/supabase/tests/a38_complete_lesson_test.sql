-- A38 -- app.complete_lesson / app.uncomplete_lesson (ticket #26; ADR 0004).
-- Conclusao manual, alternavel e idempotente. Sem direito, equipe, aula/modulo
-- arquivado, desativado, sem sessao ou aula inexistente = zero linhas e nenhum
-- efeito, nunca erro. Progresso preservado em expiracao, reembolso, recompra e
-- arquivamento.
BEGIN;
SELECT plan(54);

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'student@example.com'),
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
SELECT has_function('app', 'complete_lesson', ARRAY['uuid'], 'app.complete_lesson exists');
SELECT has_function('app', 'uncomplete_lesson', ARRAY['uuid'], 'app.uncomplete_lesson exists');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'app.complete_lesson(uuid)'::regprocedure), 'complete_lesson is SECURITY DEFINER');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'app.uncomplete_lesson(uuid)'::regprocedure), 'uncomplete_lesson is SECURITY DEFINER');
SELECT ok((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'app.complete_lesson(uuid)'::regprocedure), 'complete_lesson pins search_path to empty');
SELECT ok((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'app.uncomplete_lesson(uuid)'::regprocedure), 'uncomplete_lesson pins search_path to empty');
SELECT ok(has_function_privilege('authenticated', 'app.complete_lesson(uuid)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'app.uncomplete_lesson(uuid)', 'EXECUTE'), 'authenticated can EXECUTE both');
SELECT ok(NOT has_function_privilege('anon', 'app.complete_lesson(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'app.uncomplete_lesson(uuid)', 'EXECUTE'), 'anon cannot EXECUTE');
SELECT ok(NOT has_function_privilege('public', 'app.complete_lesson(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('public', 'app.uncomplete_lesson(uuid)', 'EXECUTE'), 'PUBLIC cannot EXECUTE');

-- Concluir ----------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

SELECT results_eq(
  $$ SELECT lesson_id FROM app.complete_lesson('a1000000-0000-0000-0000-000000000001') $$,
  $$ VALUES ('a1000000-0000-0000-0000-000000000001'::uuid) $$,
  'enrolled student completes a lesson never started: one row'
);
RESET ROLE;
SELECT results_eq(
  $$ SELECT count(*)::integer, bool_and(completed_at IS NOT NULL) FROM public.lesson_progress
     WHERE user_id = '11111111-1111-1111-1111-111111111111' AND lesson_id = 'a1000000-0000-0000-0000-000000000001' $$,
  $$ VALUES (1, true) $$,
  'completing without starting creates the progress row, completed'
);

-- Idempotencia: completed_at e first_opened_at nao mudam na segunda chamada.
UPDATE public.lesson_progress
   SET completed_at = '2020-01-02T00:00:00Z', first_opened_at = '2020-01-01T00:00:00Z'
 WHERE user_id = '11111111-1111-1111-1111-111111111111' AND lesson_id = 'a1000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*) FROM app.complete_lesson('a1000000-0000-0000-0000-000000000001')), 1::bigint,
  'completing again still returns the row');
RESET ROLE;
SELECT results_eq(
  $$ SELECT count(*)::integer, min(completed_at), min(first_opened_at) FROM public.lesson_progress
     WHERE user_id = '11111111-1111-1111-1111-111111111111' AND lesson_id = 'a1000000-0000-0000-0000-000000000001' $$,
  $$ VALUES (1, '2020-01-02T00:00:00Z'::timestamptz, '2020-01-01T00:00:00Z'::timestamptz) $$,
  'idempotent: one row, completed_at and first_opened_at are kept'
);

-- Concluir uma aula ja iniciada preserva first_opened_at.
INSERT INTO public.lesson_progress (user_id, lesson_id, first_opened_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000004', '2020-03-01T00:00:00Z');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*) FROM app.complete_lesson('a1000000-0000-0000-0000-000000000004')), 1::bigint, 'completing a started lesson');
RESET ROLE;
SELECT results_eq(
  $$ SELECT completed_at IS NOT NULL, first_opened_at FROM public.lesson_progress
     WHERE user_id = '11111111-1111-1111-1111-111111111111' AND lesson_id = 'a1000000-0000-0000-0000-000000000004' $$,
  $$ VALUES (true, '2020-03-01T00:00:00Z'::timestamptz) $$,
  'completing keeps first_opened_at'
);

-- Percentual e Continuar refletem a conclusao (leitura da arvore).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT results_eq(
  $$ SELECT completed_lessons, total_lessons, progress_percent FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000a1') $$,
  $$ VALUES (2, 2, 100) $$,
  'tree shows 2 of 2 active lessons completed (100%)'
);
SELECT results_eq(
  $$ SELECT continue_lesson_id FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000a1') $$,
  $$ VALUES ('a1000000-0000-0000-0000-000000000001'::uuid) $$,
  'everything completed: continue points at the first lesson (Revisar curso)'
);

-- Desmarcar ---------------------------------------------------------------
SELECT results_eq(
  $$ SELECT lesson_id FROM app.uncomplete_lesson('a1000000-0000-0000-0000-000000000004') $$,
  $$ VALUES ('a1000000-0000-0000-0000-000000000004'::uuid) $$,
  'student unmarks a completed lesson: one row'
);
RESET ROLE;
SELECT results_eq(
  $$ SELECT completed_at IS NULL, first_opened_at FROM public.lesson_progress
     WHERE user_id = '11111111-1111-1111-1111-111111111111' AND lesson_id = 'a1000000-0000-0000-0000-000000000004' $$,
  $$ VALUES (true, '2020-03-01T00:00:00Z'::timestamptz) $$,
  'unmarking clears completed_at and keeps the row and first_opened_at (back to in progress)'
);
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*) FROM app.uncomplete_lesson('a1000000-0000-0000-0000-000000000004')), 1::bigint, 'unmarking twice still returns the row');
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.lesson_progress
   WHERE user_id = '11111111-1111-1111-1111-111111111111' AND lesson_id = 'a1000000-0000-0000-0000-000000000004'),
  1::bigint, 'unmarking twice: still one row');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT results_eq(
  $$ SELECT continue_lesson_id FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000a1') $$,
  $$ VALUES ('a1000000-0000-0000-0000-000000000004'::uuid) $$,
  'after unmarking, continue points at the first non-completed lesson'
);

-- Desmarcar o que nunca foi aberto nao cria linha.
RESET ROLE;
DELETE FROM public.lesson_progress WHERE lesson_id = 'a1000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*) FROM app.uncomplete_lesson('a1000000-0000-0000-0000-000000000004')), 1::bigint, 'unmarking a never-opened lesson is accepted');
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.lesson_progress WHERE lesson_id = 'a1000000-0000-0000-0000-000000000004'),
  0::bigint, 'unmarking a never-opened lesson creates no row');

-- Arquivar e desarquivar preserva a conclusao ---------------------------------
UPDATE public.lessons SET archived_at = now() WHERE id = 'a1000000-0000-0000-0000-000000000001';
SELECT ok(
  (SELECT completed_at IS NOT NULL FROM public.lesson_progress
   WHERE user_id = '11111111-1111-1111-1111-111111111111' AND lesson_id = 'a1000000-0000-0000-0000-000000000001'),
  'archiving a lesson keeps its recorded completion');
UPDATE public.lessons SET archived_at = NULL WHERE id = 'a1000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT results_eq(
  $$ SELECT lo ->> 'state' FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000a1') t,
       jsonb_array_elements(t.modules) m, jsonb_array_elements(m -> 'lessons') lo
     WHERE lo ->> 'id' = 'a1000000-0000-0000-0000-000000000001' $$,
  $$ VALUES ('completed') $$,
  'unarchiving restores the completed state');

-- Expiracao e reembolso preservam o progresso -----------------------------------
RESET ROLE;
INSERT INTO public.lesson_progress (user_id, lesson_id, completed_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000001', now()),
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', now());
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT results_eq(
  $$ SELECT progress_percent FROM app.my_courses() WHERE course_id = 'c0000000-0000-0000-0000-0000000000b1' $$,
  $$ VALUES (100) $$,
  'expired course keeps its progress visible in My courses');
SELECT is((SELECT count(*) FROM app.uncomplete_lesson('b1000000-0000-0000-0000-000000000001')), 0::bigint, 'expired enrollment cannot change completion: zero rows');
RESET ROLE;
-- Recompra (ADR 0003): a matricula antiga vira 'expired' e uma nova valida e
-- criada; o progresso volta junto.
UPDATE public.enrollments SET status = 'expired'
 WHERE user_id = '11111111-1111-1111-1111-111111111111' AND course_id = 'c0000000-0000-0000-0000-0000000000b1';
INSERT INTO public.enrollments (user_id, course_id, status, granted_at, expires_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000b1', 'active', now(), now() + interval '90 days');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT results_eq(
  $$ SELECT completed_lessons FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000b1') $$,
  $$ VALUES (1) $$,
  'repurchase: earlier completion is still there');
RESET ROLE;
SELECT ok(
  (SELECT completed_at IS NOT NULL FROM public.lesson_progress
   WHERE user_id = '11111111-1111-1111-1111-111111111111' AND lesson_id = 'c1000000-0000-0000-0000-000000000001'),
  'refunded course: completion row is not deleted');

-- Sem efeito (ambas as RPCs) ------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*) FROM app.complete_lesson('a1000000-0000-0000-0000-000000000002')), 0::bigint, 'complete: archived lesson, zero rows');
SELECT is((SELECT count(*) FROM app.complete_lesson('a1000000-0000-0000-0000-000000000003')), 0::bigint, 'complete: lesson in archived module, zero rows');
SELECT is((SELECT count(*) FROM app.complete_lesson('c1000000-0000-0000-0000-000000000001')), 0::bigint, 'complete: refunded enrollment, zero rows');
SELECT is((SELECT count(*) FROM app.complete_lesson('f1000000-0000-0000-0000-000000000001')), 0::bigint, 'complete: free preview alone, zero rows');
SELECT is((SELECT count(*) FROM app.complete_lesson('99999999-9999-9999-9999-999999999999')), 0::bigint, 'complete: unknown lesson, zero rows');
SELECT is((SELECT count(*) FROM app.complete_lesson(NULL)), 0::bigint, 'complete: NULL id, zero rows');
SELECT is((SELECT count(*) FROM app.uncomplete_lesson('a1000000-0000-0000-0000-000000000002')), 0::bigint, 'uncomplete: archived lesson, zero rows');
SELECT is((SELECT count(*) FROM app.uncomplete_lesson(NULL)), 0::bigint, 'uncomplete: NULL id, zero rows');

SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT is((SELECT count(*) FROM app.complete_lesson('a1000000-0000-0000-0000-000000000004')), 0::bigint, 'complete: deactivated user, zero rows');
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT is((SELECT count(*) FROM app.complete_lesson('a1000000-0000-0000-0000-000000000004')), 0::bigint, 'complete: staff, zero rows (progress is hidden for staff)');
SET LOCAL "request.jwt.claim.sub" = '';
SELECT is((SELECT count(*) FROM app.complete_lesson('a1000000-0000-0000-0000-000000000004')), 0::bigint, 'complete: no session, zero rows');

RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.lesson_progress WHERE lesson_id IN (
     'a1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000003',
     'f1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000004')),
  0::bigint,
  'none of the rejected calls wrote a progress row'
);

-- Isolamento entre alunos (IDOR) e negacoes de uncomplete -----------------------------
RESET ROLE;
INSERT INTO auth.users (id, email) VALUES ('55555555-5555-5555-5555-555555555555', 'other@example.com');
INSERT INTO public.enrollments (user_id, course_id, status, granted_at, expires_at)
VALUES ('55555555-5555-5555-5555-555555555555', 'c0000000-0000-0000-0000-0000000000a1', 'active', now(), NULL);
INSERT INTO public.lesson_progress (user_id, lesson_id, first_opened_at, completed_at)
VALUES ('55555555-5555-5555-5555-555555555555', 'a1000000-0000-0000-0000-000000000004', '2020-05-01T00:00:00Z', '2020-05-02T00:00:00Z');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*) FROM app.complete_lesson('a1000000-0000-0000-0000-000000000004')), 1::bigint, 'student A completes the shared lesson');
SELECT is((SELECT count(*) FROM app.uncomplete_lesson('a1000000-0000-0000-0000-000000000004')), 1::bigint, 'student A unmarks the shared lesson');
RESET ROLE;
SELECT results_eq(
  $$ SELECT first_opened_at, completed_at FROM public.lesson_progress
     WHERE user_id = '55555555-5555-5555-5555-555555555555' AND lesson_id = 'a1000000-0000-0000-0000-000000000004' $$,
  $$ VALUES ('2020-05-01T00:00:00Z'::timestamptz, '2020-05-02T00:00:00Z'::timestamptz) $$,
  'student B row is untouched by student A (complete and uncomplete)');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*) FROM app.complete_lesson('b1000000-0000-0000-0000-000000000001')), 1::bigint, 'complete: repurchased enrollment is valid again, one row');
SELECT is((SELECT count(*) FROM app.uncomplete_lesson('c1000000-0000-0000-0000-000000000001')), 0::bigint, 'uncomplete: refunded enrollment, zero rows');
SELECT is((SELECT count(*) FROM app.uncomplete_lesson('f1000000-0000-0000-0000-000000000001')), 0::bigint, 'uncomplete: free preview alone, zero rows');
SELECT is((SELECT count(*) FROM app.uncomplete_lesson('a1000000-0000-0000-0000-000000000003')), 0::bigint, 'uncomplete: lesson in archived module, zero rows');
SELECT is((SELECT count(*) FROM app.uncomplete_lesson('99999999-9999-9999-9999-999999999999')), 0::bigint, 'uncomplete: unknown lesson, zero rows');
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT is((SELECT count(*) FROM app.uncomplete_lesson('a1000000-0000-0000-0000-000000000004')), 0::bigint, 'uncomplete: deactivated user, zero rows');
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT is((SELECT count(*) FROM app.uncomplete_lesson('a1000000-0000-0000-0000-000000000004')), 0::bigint, 'uncomplete: staff, zero rows');
SET LOCAL "request.jwt.claim.sub" = '';
SELECT is((SELECT count(*) FROM app.uncomplete_lesson('a1000000-0000-0000-0000-000000000004')), 0::bigint, 'uncomplete: no session, zero rows');
RESET ROLE;
SELECT ok(
  (SELECT completed_at IS NOT NULL FROM public.lesson_progress
   WHERE user_id = '11111111-1111-1111-1111-111111111111' AND lesson_id = 'c1000000-0000-0000-0000-000000000001'),
  'denied uncomplete left the refunded course completion intact');

SELECT * FROM finish();
ROLLBACK;
