-- A29 -- app.staff_get_course(uuid): arvore completa (curso, modulos, aulas e
-- video ativo por aula) para a equipe ativa. Inclui itens arquivados.
-- Contrato de erro: SQLSTATE 42501 + message 'forbidden'; curso inexistente
-- = SQLSTATE P0002 + message 'not_found'.
BEGIN;
SELECT plan(28);

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'superadmin@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'admin@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'tutor@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'student@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'inactivetutor@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'buyer1@example.com');

UPDATE app_private.user_access SET role = 'superadmin' WHERE user_id = '11111111-1111-1111-1111-111111111111';
UPDATE app_private.user_access SET role = 'admin' WHERE user_id = '22222222-2222-2222-2222-222222222222';
UPDATE app_private.user_access SET role = 'tutor' WHERE user_id IN ('33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555');
UPDATE app_private.user_access SET is_active = false WHERE user_id = '55555555-5555-5555-5555-555555555555';

-- Curso P: 2 modulos (o primeiro ativo, o segundo arquivado) + modulo vazio.
INSERT INTO public.courses (id, title, description, price_cents, status, access_duration_days) VALUES
  ('c0000000-0000-0000-0000-0000000000b1', 'Published P', 'Descricao P', 20000, 'published', 365),
  ('c0000000-0000-0000-0000-0000000000e1', 'Empty E', NULL, 0, 'draft', NULL);

-- O backfill so roda na migracao; modulos de fixtures sao criados aqui.
-- Posicoes inseridas fora de ordem para provar o ORDER BY.
INSERT INTO public.modules (id, course_id, title, position, archived_at) VALUES
  ('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000b1', 'Modulo 2 arquivado', 2, '2026-02-01 00:00:00+00'),
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000b1', 'Modulo 1', 1, NULL),
  ('a0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000b1', 'Modulo 3 vazio', 3, NULL);

INSERT INTO public.lessons (id, course_id, module_id, title, position, duration_seconds, is_free_preview, archived_at) VALUES
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-000000000001', 'Aula 2 sem video', 2, NULL, false, NULL),
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-000000000001', 'Aula 1 youtube', 1, 600, true, NULL),
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-000000000001', 'Aula 3 arquivada', 3, NULL, false, '2026-02-02 00:00:00+00'),
  ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-000000000002', 'Aula 4 panda', 1, 120, false, NULL);

-- Aula 1: asset antigo inativo + asset youtube ativo. Aula 4: panda ativo.
INSERT INTO app_private.lesson_assets (lesson_id, provider, external_ref, is_active) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'youtube', 'OLD_YT_ID_01', false),
  ('d0000000-0000-0000-0000-000000000001', 'youtube', 'dQw4w9WgXcQ', true),
  ('d0000000-0000-0000-0000-000000000004', 'panda', '3f1c9a52-0000-4000-8000-000000000001', true);

INSERT INTO public.enrollments (user_id, course_id, status, expires_at) VALUES
  ('66666666-6666-6666-6666-666666666666', 'c0000000-0000-0000-0000-0000000000b1', 'active', now() + interval '30 days');
INSERT INTO public.orders (user_id, course_id, amount_cents, provider, status, expires_at) VALUES
  ('44444444-4444-4444-4444-444444444444', 'c0000000-0000-0000-0000-0000000000b1', 20000, 'efi', 'pending', now() + interval '10 minutes');

-- Shape ---------------------------------------------------------------
SELECT has_function('app', 'staff_get_course', ARRAY['uuid'], 'app.staff_get_course exists');
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'app.staff_get_course(uuid)'::regprocedure),
  'staff_get_course is SECURITY DEFINER'
);
SELECT ok(
  (SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'app.staff_get_course(uuid)'::regprocedure),
  'staff_get_course pins search_path to empty'
);
SELECT ok(has_function_privilege('authenticated', 'app.staff_get_course(uuid)', 'EXECUTE'), 'authenticated can EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'app.staff_get_course(uuid)', 'EXECUTE'), 'anon cannot EXECUTE');
SELECT ok(NOT has_function_privilege('public', 'app.staff_get_course(uuid)', 'EXECUTE'), 'PUBLIC cannot EXECUTE');

-- Authorization -------------------------------------------------------
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT app.staff_get_course('c0000000-0000-0000-0000-0000000000b1') $$, '42501', NULL, 'anon denied by grants');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT throws_ok($$ SELECT app.staff_get_course('c0000000-0000-0000-0000-0000000000b1') $$, '42501', 'forbidden', 'student gets forbidden');
SET LOCAL "request.jwt.claim.sub" = '55555555-5555-5555-5555-555555555555';
SELECT throws_ok($$ SELECT app.staff_get_course('c0000000-0000-0000-0000-0000000000b1') $$, '42501', 'forbidden', 'inactive tutor gets forbidden');
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000000';
SELECT throws_ok($$ SELECT app.staff_get_course('c0000000-0000-0000-0000-0000000000b1') $$, '42501', 'forbidden', 'unknown uid gets forbidden');
SET LOCAL "request.jwt.claim.sub" = '';
SELECT throws_ok($$ SELECT app.staff_get_course('c0000000-0000-0000-0000-0000000000b1') $$, '42501', 'forbidden', 'authenticated without sub gets forbidden');
-- Nao vaza existencia: aluno recebe forbidden tambem para id inexistente.
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT throws_ok($$ SELECT app.staff_get_course('99999999-9999-9999-9999-999999999999') $$, '42501', 'forbidden', 'student gets forbidden (not not_found) for unknown course');

-- Equipe: cada papel ve a mesma arvore ----------------------------------
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT is((app.staff_get_course('c0000000-0000-0000-0000-0000000000b1') ->> 'title'), 'Published P', 'tutor reads the course');
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT is((app.staff_get_course('c0000000-0000-0000-0000-0000000000b1') ->> 'title'), 'Published P', 'admin reads the course');
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is((app.staff_get_course('c0000000-0000-0000-0000-0000000000b1') ->> 'title'), 'Published P', 'superadmin reads the course');

SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT throws_ok($$ SELECT app.staff_get_course('99999999-9999-9999-9999-999999999999') $$, 'P0002', 'not_found', 'unknown course gives not_found for staff');
SELECT throws_ok($$ SELECT app.staff_get_course(NULL) $$, 'P0002', 'not_found', 'null id gives not_found for staff');

-- Course fields -------------------------------------------------------
SELECT is(
  (SELECT (t - 'modules') FROM (SELECT app.staff_get_course('c0000000-0000-0000-0000-0000000000b1') AS t) s),
  jsonb_build_object(
    'id', 'c0000000-0000-0000-0000-0000000000b1',
    'title', 'Published P',
    'description', 'Descricao P',
    'status', 'published',
    'price_cents', 20000,
    'access_duration_days', 365,
    'created_at', (SELECT created_at FROM public.courses WHERE id = 'c0000000-0000-0000-0000-0000000000b1'),
    'updated_at', (SELECT updated_at FROM public.courses WHERE id = 'c0000000-0000-0000-0000-0000000000b1'),
    'enrollment_count', 1,
    'pending_order_count', 1
  ),
  'course scalar fields and counts'
);

-- Modules: ordered by position, archived included ---------------------
SELECT is(
  (SELECT jsonb_agg(m ->> 'title' ORDER BY ord) FROM jsonb_array_elements(app.staff_get_course('c0000000-0000-0000-0000-0000000000b1') -> 'modules') WITH ORDINALITY AS x(m, ord)),
  '["Modulo 1", "Modulo 2 arquivado", "Modulo 3 vazio"]'::jsonb,
  'modules ordered by position, archived module included'
);
SELECT is(
  (app.staff_get_course('c0000000-0000-0000-0000-0000000000b1') -> 'modules' -> 1 ->> 'archived_at') IS NOT NULL,
  true,
  'archived module carries archived_at'
);
SELECT is(
  app.staff_get_course('c0000000-0000-0000-0000-0000000000b1') -> 'modules' -> 2 -> 'lessons',
  '[]'::jsonb,
  'empty module has an empty lessons array'
);

-- Lessons: ordered, archived included, video per lesson ---------------
SELECT is(
  (SELECT jsonb_agg(l ->> 'title' ORDER BY ord) FROM jsonb_array_elements(app.staff_get_course('c0000000-0000-0000-0000-0000000000b1') -> 'modules' -> 0 -> 'lessons') WITH ORDINALITY AS x(l, ord)),
  '["Aula 1 youtube", "Aula 2 sem video", "Aula 3 arquivada"]'::jsonb,
  'lessons ordered by position, archived lesson included'
);
SELECT is(
  (app.staff_get_course('c0000000-0000-0000-0000-0000000000b1') -> 'modules' -> 0 -> 'lessons' -> 0) - 'created_at' - 'updated_at',
  jsonb_build_object(
    'id', 'd0000000-0000-0000-0000-000000000001',
    'title', 'Aula 1 youtube',
    'position', 1,
    'duration_seconds', 600,
    'is_free_preview', true,
    'archived_at', NULL,
    'video', jsonb_build_object('provider', 'youtube', 'external_ref', 'dQw4w9WgXcQ')
  ),
  'lesson fields with the ACTIVE video only (inactive asset ignored)'
);
SELECT is(
  app.staff_get_course('c0000000-0000-0000-0000-0000000000b1') -> 'modules' -> 0 -> 'lessons' -> 1 -> 'video',
  'null'::jsonb,
  'lesson without active asset has video = null'
);
SELECT is(
  app.staff_get_course('c0000000-0000-0000-0000-0000000000b1') -> 'modules' -> 1 -> 'lessons' -> 0 -> 'video',
  jsonb_build_object('provider', 'panda', 'external_ref', '3f1c9a52-0000-4000-8000-000000000001'),
  'panda video reference returned to staff'
);
SELECT is(
  (app.staff_get_course('c0000000-0000-0000-0000-0000000000b1') -> 'modules' -> 0 -> 'lessons' -> 2 ->> 'archived_at') IS NOT NULL,
  true,
  'archived lesson carries archived_at'
);

-- Course without modules ----------------------------------------------
SELECT is(
  app.staff_get_course('c0000000-0000-0000-0000-0000000000e1') -> 'modules',
  '[]'::jsonb,
  'course without modules has an empty modules array'
);
SELECT is(
  app.staff_get_course('c0000000-0000-0000-0000-0000000000e1') -> 'description',
  'null'::jsonb,
  'null description is preserved as json null'
);

SELECT * FROM finish();
ROLLBACK;
