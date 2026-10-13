-- A36 -- app.my_course_tree(course_id) (ticket #24; ADR 0004).
-- Arvore do curso para o aluno: modulos ativos, aulas ativas, estado por aula,
-- percentual e aula de "Continuar". Sem direito (expirado, reembolsado,
-- inexistente, sem matricula, so pre-visualizacao, desativado) = zero linhas.
BEGIN;
SELECT plan(29);

-- Fixtures --------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'student@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'other@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'inactive@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'tutor@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'inactivetutor@example.com');
UPDATE app_private.user_access SET role = 'tutor'
 WHERE user_id IN ('44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555');
UPDATE app_private.user_access SET is_active = false
 WHERE user_id IN ('33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555');

INSERT INTO public.courses (id, title, description, price_cents, status) VALUES
  ('c0000000-0000-0000-0000-0000000000a1', 'Valid A', 'Descricao A', 10000, 'published'),
  ('c0000000-0000-0000-0000-0000000000b1', 'Expired B', NULL, 10000, 'published'),
  ('c0000000-0000-0000-0000-0000000000c1', 'Refunded C', NULL, 10000, 'published'),
  ('c0000000-0000-0000-0000-0000000000d1', 'Draft D', NULL, 10000, 'draft'),
  ('c0000000-0000-0000-0000-0000000000f1', 'Not enrolled F', NULL, 10000, 'published'),
  ('c0000000-0000-0000-0000-0000000000a2', 'Empty G', NULL, 10000, 'published');

INSERT INTO public.modules (id, course_id, title, position, archived_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'A / M1', 1, NULL),
  ('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000a1', 'A / M2 archived', 2, now()),
  ('a0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000a1', 'A / M3', 3, NULL),
  ('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000b1', 'B / M1', 1, NULL),
  ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000c1', 'C / M1', 1, NULL),
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d1', 'D / M1', 1, NULL),
  ('f5000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000f1', 'F / M1', 1, NULL),
  ('a2000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a2', 'G / M1', 1, NULL);

-- A: M1 = A1 (60s), A2 (120s), A3 (sem duracao), A4 (30s), A5 arquivada;
--    M2 (arquivado) = A6; M3 = A7 (10s).
INSERT INTO public.lessons (id, course_id, module_id, title, position, duration_seconds, archived_at) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A1', 1, 60, NULL),
  ('a1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A2', 2, 120, NULL),
  ('a1000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A3', 3, NULL, NULL),
  ('a1000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A4', 4, 30, NULL),
  ('a1000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A5 archived', 5, 999, now()),
  ('a1000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000002', 'A6 in archived module', 1, 999, NULL),
  ('a1000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000003', 'A7', 1, 10, NULL),
  ('b1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'B1', 1, NULL, NULL),
  ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-000000000001', 'C1', 1, NULL, NULL),
  ('d1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-000000000001', 'D1', 1, NULL, NULL),
  ('f1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000f1', 'f5000000-0000-0000-0000-000000000001', 'F1', 1, NULL, NULL);

INSERT INTO public.enrollments (user_id, course_id, status, granted_at, expires_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a1', 'active', now() - interval '5 days', now() + interval '30 days'),
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000b1', 'active', now() - interval '60 days', now() - interval '1 day'),
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000c1', 'refunded', now() - interval '10 days', NULL),
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000d1', 'active', now() - interval '3 days', NULL),
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a2', 'active', now() - interval '1 day', NULL),
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-0000000000a1', 'active', now(), NULL),
  ('33333333-3333-3333-3333-333333333333', 'c0000000-0000-0000-0000-0000000000a1', 'active', now(), NULL);

-- student em A: A1 e A2 concluidas, A3 aberta (em andamento), A4 e A7 nao
-- iniciadas; A5/A6 (arquivadas) concluidas ficam fora. other: A1 concluida.
INSERT INTO public.lesson_progress (user_id, lesson_id, first_opened_at, completed_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', now(), now()),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000002', now(), now()),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000003', now(), NULL),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000005', now(), now()),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000006', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'a1000000-0000-0000-0000-000000000001', now(), now());

-- Shape ---------------------------------------------------------------
SELECT has_function('app', 'my_course_tree', ARRAY['uuid'], 'app.my_course_tree exists');
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'app.my_course_tree(uuid)'::regprocedure),
  'my_course_tree is SECURITY DEFINER'
);
SELECT ok(
  (SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'app.my_course_tree(uuid)'::regprocedure),
  'my_course_tree pins search_path to empty'
);
SELECT ok(has_function_privilege('authenticated', 'app.my_course_tree(uuid)', 'EXECUTE'), 'authenticated can EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'app.my_course_tree(uuid)', 'EXECUTE'), 'anon cannot EXECUTE');
SELECT ok(NOT has_function_privilege('public', 'app.my_course_tree(uuid)', 'EXECUTE'), 'PUBLIC cannot EXECUTE');

-- Aluno matriculado ------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

SELECT results_eq(
  $$ SELECT title, description, course_status, is_staff
     FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000a1') $$,
  $$ VALUES ('Valid A', 'Descricao A', 'published', false) $$,
  'enrolled student gets the course header'
);
SELECT results_eq(
  $$ SELECT total_lessons, completed_lessons, progress_percent, total_duration_seconds
     FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000a1') $$,
  $$ VALUES (5::integer, 2::integer, 40::integer, 220::integer) $$,
  'totals count only active lessons; duration sums active lessons, ignoring NULL'
);
SELECT is(
  (SELECT count(*) FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000a1')),
  1::bigint,
  'returns exactly one row'
);
SELECT results_eq(
  $$ SELECT m ->> 'title'
     FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000a1') t,
          jsonb_array_elements(t.modules) WITH ORDINALITY AS e(m, ord)
     ORDER BY ord $$,
  $$ VALUES ('A / M1'), ('A / M3') $$,
  'archived module is hidden; modules come in position order'
);
SELECT results_eq(
  $$ SELECT l ->> 'title', l ->> 'state', (l ->> 'duration_seconds')::integer
     FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000a1') t,
          jsonb_array_elements(t.modules -> 0 -> 'lessons') WITH ORDINALITY AS e(l, ord)
     ORDER BY ord $$,
  $$ VALUES ('A1', 'completed', 60),
            ('A2', 'completed', 120),
            ('A3', 'in_progress', NULL),
            ('A4', 'not_started', 30) $$,
  'archived lesson is hidden; lessons are ordered and carry state and duration'
);
SELECT is(
  (SELECT t.modules -> 1 -> 'lessons' -> 0 ->> 'id'
   FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000a1') t),
  'a1000000-0000-0000-0000-000000000007',
  'lessons of the second visible module follow the first'
);
SELECT is(
  (SELECT continue_lesson_id FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000a1')),
  'a1000000-0000-0000-0000-000000000003'::uuid,
  'continue points to the first active lesson not completed (in progress counts)'
);

-- Todas concluidas -> "Revisar": continue = primeira aula ativa.
RESET ROLE;
INSERT INTO public.lesson_progress (user_id, lesson_id, first_opened_at, completed_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000004', now(), now()),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000007', now(), now())
ON CONFLICT DO NOTHING;
UPDATE public.lesson_progress SET completed_at = now()
 WHERE user_id = '11111111-1111-1111-1111-111111111111'
   AND lesson_id = 'a1000000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT results_eq(
  $$ SELECT progress_percent, continue_lesson_id
     FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000a1') $$,
  $$ VALUES (100::integer, 'a1000000-0000-0000-0000-000000000001'::uuid) $$,
  'everything completed: 100 percent and continue falls back to the first active lesson'
);

-- Curso valido sem aulas ativas: uma linha, sem continuar.
SELECT results_eq(
  $$ SELECT total_lessons, progress_percent, continue_lesson_id IS NULL, jsonb_array_length(modules)
     FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000a2') $$,
  $$ VALUES (0::integer, 0::integer, true, 1) $$,
  'course without active lessons returns one row, 0 percent and no continue lesson'
);

-- Matricula valida em curso nao publicado ainda abre (regra A26).
SELECT is(
  (SELECT count(*) FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000d1')),
  1::bigint,
  'valid enrollment in a draft course still opens'
);

-- Sem direito = zero linhas ------------------------------------------------
SELECT is((SELECT count(*) FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000b1')), 0::bigint,
  'expired enrollment: zero rows');
SELECT is((SELECT count(*) FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000c1')), 0::bigint,
  'refunded enrollment: zero rows');
SELECT is((SELECT count(*) FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000f1')), 0::bigint,
  'not enrolled: zero rows');
SELECT is((SELECT count(*) FROM app.my_course_tree('99999999-9999-9999-9999-999999999999')), 0::bigint,
  'unknown course: zero rows');
SELECT is((SELECT count(*) FROM app.my_course_tree(NULL)), 0::bigint, 'NULL course id: zero rows');

-- Preview gratuito sozinho nao da direito.
RESET ROLE;
UPDATE public.lessons SET is_free_preview = true WHERE id = 'f1000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*) FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000f1')), 0::bigint,
  'free preview alone gives no access: zero rows');

-- Isolamento: o progresso de outro aluno nao vaza.
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT results_eq(
  $$ SELECT completed_lessons, continue_lesson_id
     FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000a1') $$,
  $$ VALUES (1::integer, 'a1000000-0000-0000-0000-000000000002'::uuid) $$,
  'another student sees only their own progress'
);

-- Usuario desativado e sem sessao.
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT is((SELECT count(*) FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000a1')), 0::bigint,
  'deactivated user: zero rows');
SET LOCAL "request.jwt.claim.sub" = '';
SELECT is((SELECT count(*) FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000a1')), 0::bigint,
  'no session: zero rows');

-- Equipe: acessa qualquer curso (inclusive sem matricula), sem progresso.
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT results_eq(
  $$ SELECT is_staff, completed_lessons, total_lessons
     FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000f1') $$,
  $$ VALUES (true, 0::integer, 1::integer) $$,
  'active staff opens a course without enrollment, flagged is_staff'
);
SELECT is((SELECT count(*) FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000b1')), 1::bigint,
  'staff opens a course the student lost access to');
SET LOCAL "request.jwt.claim.sub" = '55555555-5555-5555-5555-555555555555';
SELECT is((SELECT count(*) FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000f1')), 0::bigint,
  'deactivated staff: zero rows');

-- Reembolso mais recente que o ultimo acesso fecha o curso mesmo com 'active' antigo.
RESET ROLE;
UPDATE public.enrollments SET status = 'refunded'
 WHERE user_id = '11111111-1111-1111-1111-111111111111'
   AND course_id = 'c0000000-0000-0000-0000-0000000000a1';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*) FROM app.my_course_tree('c0000000-0000-0000-0000-0000000000a1')), 0::bigint,
  'enrollment refunded after the tree was readable: zero rows');

SELECT * FROM finish();
ROLLBACK;
