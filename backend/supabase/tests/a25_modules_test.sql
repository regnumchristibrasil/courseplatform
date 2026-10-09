-- A25 -- modules: tabela, vinculo obrigatorio aula -> modulo do mesmo curso,
-- posicoes deferiveis (troca atomica), leituras publicas e arquivamento.
-- ADR 0002, decisoes 1 e 2. O backfill do modulo padrao nao e coberto aqui
-- (a migration roda uma vez); foi ensaiado aplicando a migration em uma
-- transacao com ROLLBACK sobre dados de formato antigo (curso sem aulas e
-- aulas com posicoes esparsas), ver o cabecalho da migration A25.
BEGIN;
SELECT plan(34);

-- Estrutura ------------------------------------------------------------
SELECT has_table('public', 'modules', 'public.modules exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.modules'::regclass),
  'RLS is enabled on public.modules'
);
SELECT columns_are(
  'public', 'modules',
  ARRAY['id', 'course_id', 'title', 'position', 'archived_at', 'created_at', 'updated_at'],
  'modules has exactly the documented columns'
);
SELECT col_not_null('public', 'lessons', 'module_id', 'lessons.module_id is required');
SELECT has_column('public', 'lessons', 'archived_at', 'lessons has archived_at');
SELECT has_trigger('public', 'modules', 'set_modules_updated_at', 'modules maintains updated_at');

-- Fixtures --------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'enrolled@example.com');

INSERT INTO public.courses (id, title, price_cents, status) VALUES
  ('c0000000-0000-0000-0000-0000000000a1', 'Published A', 10000, 'published'),
  ('c0000000-0000-0000-0000-0000000000b1', 'Published B', 10000, 'published'),
  ('c0000000-0000-0000-0000-0000000000d1', 'Draft D', 10000, 'draft'),
  ('c0000000-0000-0000-0000-0000000000e1', 'Disposable E', 10000, 'draft');

INSERT INTO public.modules (id, course_id, title, position, archived_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'A / M1', 1, NULL),
  ('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000a1', 'A / M2', 2, NULL),
  ('a0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000a1', 'A / M3 archived', 3, now()),
  ('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000b1', 'B / M1', 1, NULL),
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d1', 'D / M1', 1, NULL),
  ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000e1', 'E / M1', 1, NULL);

INSERT INTO public.lessons (id, course_id, module_id, title, position, archived_at) VALUES
  ('11111111-2222-3333-4444-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A1 first', 1, NULL),
  ('11111111-2222-3333-4444-000000000002', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A1 second', 2, NULL),
  ('11111111-2222-3333-4444-000000000003', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000002', 'A2 first', 1, NULL),
  ('11111111-2222-3333-4444-000000000004', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000002', 'A2 archived', 2, now()),
  ('11111111-2222-3333-4444-000000000005', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000003', 'A3 in archived module', 1, NULL),
  ('11111111-2222-3333-4444-0000000000d1', 'c0000000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-000000000001', 'D1 first', 1, NULL),
  ('11111111-2222-3333-4444-0000000000e1', 'c0000000-0000-0000-0000-0000000000e1', 'e0000000-0000-0000-0000-000000000001', 'E1 first', 1, NULL);

-- Integridade -----------------------------------------------------------
SELECT throws_ok(
  $$ INSERT INTO public.lessons (course_id, module_id, title, position)
     VALUES ('c0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-000000000001', 'cross-course', 9) $$,
  '23503', NULL,
  'a lesson cannot reference a module of another course'
);
SELECT throws_ok(
  $$ UPDATE public.lessons SET module_id = 'b0000000-0000-0000-0000-000000000001'
     WHERE id = '11111111-2222-3333-4444-000000000001' $$,
  '23503', NULL,
  'moving a lesson to a module of another course is rejected'
);
SELECT throws_ok(
  $$ INSERT INTO public.lessons (course_id, title, position)
     VALUES ('c0000000-0000-0000-0000-0000000000a1', 'orphan', 9) $$,
  '23502', NULL,
  'a lesson without module is rejected'
);
SELECT throws_ok(
  $$ INSERT INTO public.modules (course_id, title, position)
     VALUES ('c0000000-0000-0000-0000-0000000000a1', 'zero', 0) $$,
  '23514', NULL,
  'module position must be >= 1'
);
SELECT throws_ok(
  $$ INSERT INTO public.lessons (course_id, module_id, title, position)
     VALUES ('c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'zero', 0) $$,
  '23514', NULL,
  'lesson position must be >= 1'
);
SELECT is(
  (SELECT count(*)::int FROM public.lessons l
     JOIN public.modules m ON m.id = l.module_id
    WHERE m.course_id <> l.course_id),
  0,
  'invariant: no lesson sits in a module of a different course'
);
SELECT throws_ok(
  $$ DELETE FROM public.modules WHERE id = 'a0000000-0000-0000-0000-000000000001' $$,
  '23503', NULL,
  'a module that still has lessons cannot be deleted'
);
DELETE FROM public.courses WHERE id = 'c0000000-0000-0000-0000-0000000000e1';
SELECT is(
  (SELECT count(*)::int FROM public.modules WHERE course_id = 'c0000000-0000-0000-0000-0000000000e1')
  + (SELECT count(*)::int FROM public.lessons WHERE course_id = 'c0000000-0000-0000-0000-0000000000e1'),
  0,
  'deleting a course cascades to its modules and lessons'
);

-- Posicoes deferiveis -----------------------------------------------------
SELECT throws_ok(
  $$ INSERT INTO public.lessons (course_id, module_id, title, position)
       VALUES ('c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'dup', 1);
     SET CONSTRAINTS ALL IMMEDIATE $$,
  '23505', NULL,
  'duplicate lesson position inside one module is rejected'
);
SELECT throws_ok(
  $$ INSERT INTO public.modules (course_id, title, position)
       VALUES ('c0000000-0000-0000-0000-0000000000a1', 'dup', 1);
     SET CONSTRAINTS ALL IMMEDIATE $$,
  '23505', NULL,
  'duplicate module position inside one course is rejected'
);
SELECT is(
  (SELECT count(*)::int FROM public.lessons
    WHERE course_id = 'c0000000-0000-0000-0000-0000000000a1' AND position = 1
      AND module_id IN ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002')),
  2,
  'the same lesson position is allowed in different modules of one course'
);

SELECT lives_ok(
  $$ UPDATE public.lessons SET position = 2 WHERE id = '11111111-2222-3333-4444-000000000001';
     UPDATE public.lessons SET position = 1 WHERE id = '11111111-2222-3333-4444-000000000002';
     SET CONSTRAINTS ALL IMMEDIATE $$,
  'two lessons swap positions in one transaction'
);
SELECT is(
  (SELECT position FROM public.lessons WHERE id = '11111111-2222-3333-4444-000000000001'),
  2,
  'swap persisted: first lesson is now second'
);
SELECT lives_ok(
  $$ UPDATE public.modules SET position = 3 - position
     WHERE id IN ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002');
     SET CONSTRAINTS ALL IMMEDIATE $$,
  'two modules swap positions in a single statement'
);
SELECT is(
  (SELECT position FROM public.modules WHERE id = 'a0000000-0000-0000-0000-000000000001'),
  2,
  'swap persisted: first module is now second'
);

-- Leitura publica ---------------------------------------------------------
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.modules
    WHERE course_id IN ('c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000d1')),
  3,
  'anon sees non-archived modules of published courses only (A1, A2, B1)'
);
SELECT is(
  (SELECT count(*)::int FROM public.modules WHERE id = 'd0000000-0000-0000-0000-000000000001'),
  0,
  'anon does not see modules of a draft course'
);
SELECT is(
  (SELECT count(*)::int FROM public.modules WHERE id = 'a0000000-0000-0000-0000-000000000003'),
  0,
  'anon does not see an archived module'
);
SELECT is(
  (SELECT count(*)::int FROM public.lessons WHERE course_id = 'c0000000-0000-0000-0000-0000000000a1'),
  3,
  'anon sees only active lessons of active modules (archived lesson and lesson of archived module hidden)'
);
SELECT is(
  (SELECT count(*)::int FROM public.lessons WHERE course_id = 'c0000000-0000-0000-0000-0000000000d1'),
  0,
  'anon does not see lessons of a draft course'
);
SELECT throws_ok(
  $$ INSERT INTO public.modules (course_id, title, position)
     VALUES ('c0000000-0000-0000-0000-0000000000a1', 'x', 9) $$,
  NULL, NULL,
  'anon INSERT on public.modules is denied'
);
SELECT throws_ok(
  $$ UPDATE public.modules SET title = 'x' $$,
  NULL, NULL,
  'anon UPDATE on public.modules is denied'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT throws_ok(
  $$ DELETE FROM public.modules $$,
  NULL, NULL,
  'authenticated DELETE on public.modules is denied'
);
RESET ROLE;

SELECT is(
  (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'modules' AND grantee IN ('anon', 'authenticated')
      AND privilege_type <> 'SELECT'),
  NULL,
  'anon and authenticated hold SELECT only on public.modules'
);

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$ INSERT INTO public.modules (course_id, title, position)
     VALUES ('c0000000-0000-0000-0000-0000000000b1', 'service-created', 2) $$,
  'service_role can INSERT a module'
);
RESET ROLE;

-- get_playable_ref ignora arquivados -------------------------------------
INSERT INTO app_private.lesson_assets (lesson_id, provider, external_ref, is_active) VALUES
  ('11111111-2222-3333-4444-000000000001', 'youtube', 'yt-active', true),
  ('11111111-2222-3333-4444-000000000004', 'youtube', 'yt-archived-lesson', true),
  ('11111111-2222-3333-4444-000000000005', 'youtube', 'yt-archived-module', true);
INSERT INTO public.enrollments (user_id, course_id, status, granted_at, expires_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a1', 'active', now(), NULL);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT results_eq(
  $$ SELECT external_ref FROM app.get_playable_ref('11111111-2222-3333-4444-000000000001'::uuid) $$,
  $$ VALUES ('yt-active'::text) $$,
  'an enrolled user still resolves an active lesson of an active module'
);
SELECT is(
  (SELECT count(*)::int FROM app.get_playable_ref('11111111-2222-3333-4444-000000000004'::uuid)),
  0,
  'an archived lesson resolves to zero rows even for an enrolled user'
);
SELECT is(
  (SELECT count(*)::int FROM app.get_playable_ref('11111111-2222-3333-4444-000000000005'::uuid)),
  0,
  'a lesson of an archived module resolves to zero rows even for an enrolled user'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
