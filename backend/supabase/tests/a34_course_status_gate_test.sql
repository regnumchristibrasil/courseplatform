-- A34 -- staff_set_course_status, staff_delete_course e portao de publicacao (ticket #20).
BEGIN;
SELECT plan(65);

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'superadmin@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'admin@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'tutor@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'student@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'inactivetutor@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'buyer@example.com');

UPDATE app_private.user_access SET role = 'superadmin' WHERE user_id = '11111111-1111-1111-1111-111111111111';
UPDATE app_private.user_access SET role = 'admin' WHERE user_id = '22222222-2222-2222-2222-222222222222';
UPDATE app_private.user_access SET role = 'tutor' WHERE user_id IN ('33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555');
UPDATE app_private.user_access SET is_active = false WHERE user_id = '55555555-5555-5555-5555-555555555555';

-- Cursos (ids terminam no codigo do cenario):
--   a1 rascunho pronto (preco, 1 aula com video)       a2 rascunho sem preco (aula com video)
--   a3 rascunho so com aula arquivada                   a4 rascunho com aula sem video (e outra com)
--   a5 rascunho com modulo arquivado (aula com video)   a6 rascunho sem modulos
--   b1 publicado: M1 {L1 video, L2 video, L3 arquivada sem video} + M2 {L4 video}
--   b2 publicado: M1 {L5 video} + M2 arquivado {L6 video}
--   c1 arquivado                                        d1 rascunho com pedido
--   e1 publicado com matricula
INSERT INTO public.courses (id, title, price_cents, status, updated_at) VALUES
  ('c0000000-0000-0000-0000-0000000000a1', 'Ready', 10000, 'draft', '2026-01-01 00:00:00+00'),
  ('c0000000-0000-0000-0000-0000000000a2', 'No price', NULL, 'draft', '2026-01-01 00:00:00+00'),
  ('c0000000-0000-0000-0000-0000000000a3', 'Only archived lesson', 10000, 'draft', '2026-01-01 00:00:00+00'),
  ('c0000000-0000-0000-0000-0000000000a4', 'Lesson without video', 10000, 'draft', '2026-01-01 00:00:00+00'),
  ('c0000000-0000-0000-0000-0000000000a5', 'Archived module only', 10000, 'draft', '2026-01-01 00:00:00+00'),
  ('c0000000-0000-0000-0000-0000000000a6', 'Empty', 10000, 'draft', '2026-01-01 00:00:00+00'),
  ('c0000000-0000-0000-0000-0000000000b1', 'Published B1', 10000, 'published', '2026-01-01 00:00:00+00'),
  ('c0000000-0000-0000-0000-0000000000b2', 'Published B2', 10000, 'published', '2026-01-01 00:00:00+00'),
  ('c0000000-0000-0000-0000-0000000000c1', 'Archived C1', 10000, 'archived', '2026-01-01 00:00:00+00'),
  ('c0000000-0000-0000-0000-0000000000d1', 'With order', 10000, 'draft', '2026-01-01 00:00:00+00'),
  ('c0000000-0000-0000-0000-0000000000e1', 'With sales', 10000, 'published', '2026-01-01 00:00:00+00');

INSERT INTO public.modules (id, course_id, title, position, archived_at) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a1', 'M', 1, NULL),
  ('a0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-0000000000a2', 'M', 1, NULL),
  ('a0000000-0000-0000-0000-0000000000a3', 'c0000000-0000-0000-0000-0000000000a3', 'M', 1, NULL),
  ('a0000000-0000-0000-0000-0000000000a4', 'c0000000-0000-0000-0000-0000000000a4', 'M', 1, NULL),
  ('a0000000-0000-0000-0000-0000000000a5', 'c0000000-0000-0000-0000-0000000000a5', 'M', 1, '2026-02-01 00:00:00+00'),
  ('a0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1', 'M1', 1, NULL),
  ('a0000000-0000-0000-0000-0000000000b9', 'c0000000-0000-0000-0000-0000000000b1', 'M2', 2, NULL),
  ('a0000000-0000-0000-0000-0000000000c2', 'c0000000-0000-0000-0000-0000000000b2', 'M1', 1, NULL),
  ('a0000000-0000-0000-0000-0000000000c3', 'c0000000-0000-0000-0000-0000000000b2', 'M2', 2, '2026-02-01 00:00:00+00'),
  ('a0000000-0000-0000-0000-0000000000e1', 'c0000000-0000-0000-0000-0000000000e1', 'M', 1, NULL),
  ('a0000000-0000-0000-0000-0000000000d1', 'c0000000-0000-0000-0000-0000000000d1', 'M', 1, NULL);

INSERT INTO public.lessons (id, course_id, module_id, title, position, archived_at, updated_at) VALUES
  ('d0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1', 'A1', 1, NULL, '2026-01-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000a2', 'A2', 1, NULL, '2026-01-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-0000000000a3', 'c0000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-0000000000a3', 'A3', 1, '2026-02-01 00:00:00+00', '2026-01-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-0000000000a4', 'c0000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-0000000000a4', 'A4 sem video', 1, NULL, '2026-01-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-0000000000a9', 'c0000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-0000000000a4', 'A4 com video', 2, NULL, '2026-01-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-0000000000a5', 'c0000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-0000000000a5', 'A5', 1, NULL, '2026-01-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'L1', 1, NULL, '2026-01-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-0000000000b2', 'c0000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'L2', 2, NULL, '2026-01-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-0000000000b3', 'c0000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'L3 arquivada', 3, '2026-02-01 00:00:00+00', '2026-01-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-0000000000b4', 'c0000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b9', 'L4', 1, NULL, '2026-01-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-0000000000c5', 'c0000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-0000000000c2', 'L5', 1, NULL, '2026-01-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-0000000000c6', 'c0000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-0000000000c3', 'L6', 1, NULL, '2026-01-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-0000000000e1', 'c0000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'E1', 1, NULL, '2026-01-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-0000000000d1', 'c0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'D1', 1, NULL, '2026-01-01 00:00:00+00');

INSERT INTO app_private.lesson_assets (lesson_id, provider, external_ref, is_active) VALUES
  ('d0000000-0000-0000-0000-0000000000a1', 'youtube', 'aaaaaaaaaa1', true),
  ('d0000000-0000-0000-0000-0000000000a2', 'youtube', 'aaaaaaaaaa2', true),
  ('d0000000-0000-0000-0000-0000000000a9', 'youtube', 'aaaaaaaaaa9', true),
  ('d0000000-0000-0000-0000-0000000000a4', 'youtube', 'aaaaaaaaaa4', false),  -- so historico: continua sem video ativo
  ('d0000000-0000-0000-0000-0000000000a5', 'youtube', 'aaaaaaaaaa5', true),
  ('d0000000-0000-0000-0000-0000000000b1', 'youtube', 'bbbbbbbbbb1', true),
  ('d0000000-0000-0000-0000-0000000000b2', 'youtube', 'bbbbbbbbbb2', true),
  ('d0000000-0000-0000-0000-0000000000b4', 'youtube', 'bbbbbbbbbb4', true),
  ('d0000000-0000-0000-0000-0000000000c5', 'youtube', 'cccccccccc5', true),
  ('d0000000-0000-0000-0000-0000000000c6', 'youtube', 'cccccccccc6', true),
  ('d0000000-0000-0000-0000-0000000000e1', 'youtube', 'eeeeeeeeee1', true);

INSERT INTO public.enrollments (user_id, course_id, status, expires_at) VALUES
  ('66666666-6666-6666-6666-666666666666', 'c0000000-0000-0000-0000-0000000000e1', 'active', now() + interval '30 days');
INSERT INTO public.orders (user_id, course_id, amount_cents, provider, status) VALUES
  ('66666666-6666-6666-6666-666666666666', 'c0000000-0000-0000-0000-0000000000d1', 10000, 'mercadopago', 'pending');

CREATE TEMP VIEW _cv AS SELECT * FROM public.courses;
GRANT SELECT ON _cv TO authenticated;
CREATE TEMP VIEW _lv AS SELECT * FROM public.lessons;
GRANT SELECT ON _lv TO authenticated;
CREATE TEMP VIEW _mv AS SELECT * FROM public.modules;
GRANT SELECT ON _mv TO authenticated;
CREATE TEMP VIEW _audit AS SELECT * FROM app_private.course_audit;
GRANT SELECT ON _audit TO authenticated;

-- Shape ---------------------------------------------------------------------
SELECT has_function('app', 'staff_set_course_status', ARRAY['uuid', 'timestamp with time zone', 'text'], 'staff_set_course_status exists');
SELECT has_function('app', 'staff_delete_course', ARRAY['uuid', 'timestamp with time zone'], 'staff_delete_course exists');
SELECT ok(
  (SELECT bool_and(prosecdef AND proconfig @> ARRAY['search_path=""'])
   FROM pg_proc WHERE proname IN ('staff_set_course_status', 'staff_delete_course')),
  'status and delete RPCs are SECURITY DEFINER with an empty search_path'
);
SELECT ok(NOT has_function_privilege('anon', 'app.staff_set_course_status(uuid, timestamp with time zone, text)', 'EXECUTE'), 'anon cannot change status');
SELECT ok(NOT has_function_privilege('anon', 'app.staff_delete_course(uuid, timestamp with time zone)', 'EXECUTE'), 'anon cannot delete a course');
SELECT ok(has_function_privilege('authenticated', 'app.staff_set_course_status(uuid, timestamp with time zone, text)', 'EXECUTE'), 'authenticated can call set_course_status');
SELECT ok(NOT has_function_privilege('authenticated', 'app_private.course_gate_violations(uuid)', 'EXECUTE'), 'gate helper is not exposed');

-- Gate function (as owner) ------------------------------------------------------
SELECT is(app_private.course_gate_violations('c0000000-0000-0000-0000-0000000000a1'), '[]'::jsonb, 'ready course has no violations');
SELECT is(app_private.course_gate_violations('c0000000-0000-0000-0000-0000000000a2'), '[{"code": "price_missing"}]'::jsonb, 'missing price is reported');
SELECT is(app_private.course_gate_violations('c0000000-0000-0000-0000-0000000000a3'), '[{"code": "no_active_lesson"}]'::jsonb, 'only archived lessons: no active lesson');
SELECT is(app_private.course_gate_violations('c0000000-0000-0000-0000-0000000000a5'), '[{"code": "no_active_lesson"}]'::jsonb, 'lessons of an archived module do not count');
SELECT is(app_private.course_gate_violations('c0000000-0000-0000-0000-0000000000a6'), '[{"code": "no_active_lesson"}]'::jsonb, 'course without modules: no active lesson');
SELECT is(
  app_private.course_gate_violations('c0000000-0000-0000-0000-0000000000a4'),
  '[{"code": "lesson_without_video", "lessonId": "d0000000-0000-0000-0000-0000000000a4"}]'::jsonb,
  'active lesson with only inactive history has no video'
);
SELECT is(app_private.course_gate_violations('c0000000-0000-0000-0000-0000000000b1'), '[]'::jsonb, 'archived lesson without video is ignored');
SELECT is(app_private.course_gate_violations('c0000000-0000-0000-0000-0000000000b2'), '[]'::jsonb, 'archived module is ignored');

-- Authorization ----------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT throws_ok($$ SELECT * FROM app.staff_set_course_status('c0000000-0000-0000-0000-0000000000a1', now(), 'published') $$, '42501', 'forbidden', 'student cannot change status');
SELECT throws_ok($$ SELECT * FROM app.staff_delete_course('c0000000-0000-0000-0000-0000000000a1', now()) $$, '42501', 'forbidden', 'student cannot delete');
SELECT throws_ok($$ SELECT * FROM app.staff_delete_course('c0000000-0000-0000-0000-00000000ffff', now()) $$, '42501', 'forbidden', 'student gets forbidden (not not_found) for unknown course');
SET LOCAL "request.jwt.claim.sub" = '55555555-5555-5555-5555-555555555555';
SELECT throws_ok($$ SELECT * FROM app.staff_set_course_status('c0000000-0000-0000-0000-0000000000a1', now(), 'published') $$, '42501', 'forbidden', 'inactive tutor cannot change status');

-- Input ------------------------------------------------------------------------
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT throws_ok($$ SELECT * FROM app.staff_set_course_status(NULL, now(), 'published') $$, '22023', 'invalid_input', 'null course id is invalid');
SELECT throws_ok($$ SELECT * FROM app.staff_set_course_status('c0000000-0000-0000-0000-0000000000a1', NULL, 'published') $$, '22023', 'invalid_input', 'null expected updated_at is invalid');
SELECT throws_ok($$ SELECT * FROM app.staff_set_course_status('c0000000-0000-0000-0000-0000000000a1', now(), 'bogus') $$, '22023', 'invalid_input', 'unknown status is invalid');
SELECT throws_ok($$ SELECT * FROM app.staff_set_course_status('c0000000-0000-0000-0000-0000000000a1', now(), NULL) $$, '22023', 'invalid_input', 'null status is invalid');
SELECT throws_ok($$ SELECT * FROM app.staff_set_course_status('c0000000-0000-0000-0000-00000000ffff', now(), 'published') $$, 'P0002', 'not_found', 'unknown course is not_found');
SELECT throws_ok($$ SELECT * FROM app.staff_set_course_status('c0000000-0000-0000-0000-0000000000a1', '2025-01-01 00:00:00+00', 'published') $$, 'CR001', 'stale_target', 'stale updated_at is stale_target');
SELECT is((SELECT status FROM _cv WHERE id = 'c0000000-0000-0000-0000-0000000000a1'), 'draft', 'stale request writes nothing');

-- Invalid transitions (distinct error) -----------------------------------------------
SELECT throws_ok($$ SELECT * FROM app.staff_set_course_status('c0000000-0000-0000-0000-0000000000a1', '2026-01-01 00:00:00+00', 'archived') $$, 'CR005', 'invalid_transition', 'draft -> archived is invalid');
SELECT throws_ok($$ SELECT * FROM app.staff_set_course_status('c0000000-0000-0000-0000-0000000000a1', '2026-01-01 00:00:00+00', 'draft') $$, 'CR005', 'invalid_transition', 'draft -> draft is invalid');
SELECT throws_ok($$ SELECT * FROM app.staff_set_course_status('c0000000-0000-0000-0000-0000000000c1', '2026-01-01 00:00:00+00', 'published') $$, 'CR005', 'invalid_transition', 'archived -> published is invalid');
SELECT throws_ok($$ SELECT * FROM app.staff_set_course_status('c0000000-0000-0000-0000-0000000000b1', '2026-01-01 00:00:00+00', 'published') $$, 'CR005', 'invalid_transition', 'published -> published is invalid');

-- Publish gate on the transition ------------------------------------------------------
SELECT throws_ok($$ SELECT * FROM app.staff_set_course_status('c0000000-0000-0000-0000-0000000000a2', '2026-01-01 00:00:00+00', 'published') $$, 'CR004', 'publish_gate_violated', 'tutor cannot publish a course with no price');
SELECT throws_ok($$ SELECT * FROM app.staff_set_course_status('c0000000-0000-0000-0000-0000000000a3', '2026-01-01 00:00:00+00', 'published') $$, 'CR004', 'publish_gate_violated', 'no active lesson blocks publishing');
SELECT throws_ok($$ SELECT * FROM app.staff_set_course_status('c0000000-0000-0000-0000-0000000000a4', '2026-01-01 00:00:00+00', 'published') $$, 'CR004', 'publish_gate_violated', 'lesson without video blocks publishing');
SELECT is((SELECT status FROM _cv WHERE id = 'c0000000-0000-0000-0000-0000000000a4'), 'draft', 'a rejected publish writes nothing');

-- The violation list travels in DETAIL
DO $$
DECLARE
  v_detail text;
BEGIN
  BEGIN
    PERFORM * FROM app.staff_set_course_status('c0000000-0000-0000-0000-0000000000a4', '2026-01-01 00:00:00+00', 'published');
  EXCEPTION WHEN SQLSTATE 'CR004' THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  END;
  PERFORM set_config('test.gate_detail', coalesce(v_detail, 'none'), true);
END;
$$;
SELECT is(
  current_setting('test.gate_detail')::jsonb,
  '[{"code": "lesson_without_video", "lessonId": "d0000000-0000-0000-0000-0000000000a4"}]'::jsonb,
  'the exception DETAIL carries the violation list'
);

-- Happy path: publish, unpublish, archive, unarchive ------------------------------------
SELECT lives_ok($$ SELECT * FROM app.staff_set_course_status('c0000000-0000-0000-0000-0000000000a1', '2026-01-01 00:00:00+00', 'published') $$, 'tutor publishes a ready course');
SELECT is((SELECT status FROM _cv WHERE id = 'c0000000-0000-0000-0000-0000000000a1'), 'published', 'course is published');
SELECT is(
  (SELECT previous_status FROM app.staff_set_course_status('c0000000-0000-0000-0000-0000000000a1', (SELECT updated_at FROM _cv WHERE id = 'c0000000-0000-0000-0000-0000000000a1'), 'draft')),
  'published', 'the result reports the previous status'
);
SELECT lives_ok($$ SELECT * FROM app.staff_set_course_status('c0000000-0000-0000-0000-0000000000b1', '2026-01-01 00:00:00+00', 'archived') $$, 'published -> archived');
SELECT lives_ok($$ SELECT * FROM app.staff_set_course_status('c0000000-0000-0000-0000-0000000000b1', (SELECT updated_at FROM _cv WHERE id = 'c0000000-0000-0000-0000-0000000000b1'), 'draft') $$, 'archived -> draft');
SELECT is(
  (SELECT array_agg(old_value || '>' || new_value ORDER BY id) FROM _audit WHERE course_id = 'c0000000-0000-0000-0000-0000000000a1' AND action = 'status_changed'),
  ARRAY['draft>published', 'published>draft'], 'every status change is audited with old and new value'
);
SELECT is((SELECT count(*)::int FROM _audit WHERE course_id = 'c0000000-0000-0000-0000-0000000000b1' AND action = 'status_changed'), 2, 'archive and unarchive are audited');

-- A published course cannot leave the gate through the tree RPCs ------------------------------
RESET ROLE;
UPDATE public.courses SET status = 'published' WHERE id = 'c0000000-0000-0000-0000-0000000000b1';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT throws_ok(
  $$ SELECT app.staff_set_lesson_archived('d0000000-0000-0000-0000-0000000000c5', '2026-01-01 00:00:00+00', true) $$,
  'CR004', 'publish_gate_violated', 'archiving the last active lesson of a published course is rejected'
);
SELECT is((SELECT archived_at FROM _lv WHERE id = 'd0000000-0000-0000-0000-0000000000c5'), NULL, 'a rejected tree change is rolled back');
SELECT lives_ok(
  $$ SELECT app.staff_set_lesson_archived('d0000000-0000-0000-0000-0000000000b1', '2026-01-01 00:00:00+00', true) $$,
  'archiving a lesson is fine while another active lesson remains'
);
SELECT throws_ok(
  $$ SELECT app.staff_delete_lesson('d0000000-0000-0000-0000-0000000000c5', '2026-01-01 00:00:00+00') $$,
  'CR004', 'publish_gate_violated', 'deleting the last active lesson of a published course is rejected'
);
SELECT throws_ok(
  $$ SELECT app.staff_set_module_archived('a0000000-0000-0000-0000-0000000000c2', true) $$,
  'CR004', 'publish_gate_violated', 'archiving the module of the last active lesson is rejected'
);
SELECT throws_ok(
  $$ SELECT app.staff_move_lesson('d0000000-0000-0000-0000-0000000000c5', '2026-01-01 00:00:00+00', 'a0000000-0000-0000-0000-0000000000c3') $$,
  'CR004', 'publish_gate_violated', 'moving the last active lesson into an archived module is rejected'
);
SELECT lives_ok(
  $$ SELECT app.staff_set_module_archived('a0000000-0000-0000-0000-0000000000c3', false) $$,
  'unarchiving a module whose lessons all have video is allowed'
);
SELECT lives_ok(
  $$ SELECT app.staff_set_module_archived('a0000000-0000-0000-0000-0000000000c2', true) $$,
  'archiving a module is fine once another module keeps an active lesson'
);
SELECT throws_ok(
  $$ SELECT * FROM app.staff_add_lesson('a0000000-0000-0000-0000-0000000000c3', 'Sem video', NULL, false, false) $$,
  'CR004', 'publish_gate_violated', 'adding an active lesson without video to a published course is rejected'
);

-- Delete course ------------------------------------------------------------------------------
SELECT throws_ok($$ SELECT app.staff_delete_course(NULL, now()) $$, '22023', 'invalid_input', 'delete with null id is invalid');
SELECT throws_ok($$ SELECT app.staff_delete_course('c0000000-0000-0000-0000-00000000ffff', now()) $$, 'P0002', 'not_found', 'delete unknown course is not_found');
SELECT throws_ok($$ SELECT app.staff_delete_course('c0000000-0000-0000-0000-0000000000e1', '2026-01-01 00:00:00+00') $$, 'CR003', 'course_has_sales', 'course with an enrollment cannot be deleted');
SELECT throws_ok($$ SELECT app.staff_delete_course('c0000000-0000-0000-0000-0000000000d1', '2026-01-01 00:00:00+00') $$, 'CR003', 'course_has_sales', 'course with an order cannot be deleted');
SELECT throws_ok($$ SELECT app.staff_delete_course('c0000000-0000-0000-0000-0000000000a6', '2025-01-01 00:00:00+00') $$, 'CR001', 'stale_target', 'stale delete is stale_target');
SELECT lives_ok($$ SELECT app.staff_delete_course('c0000000-0000-0000-0000-0000000000a6', '2026-01-01 00:00:00+00') $$, 'tutor deletes a course without sales');
SELECT is((SELECT count(*)::int FROM _cv WHERE id = 'c0000000-0000-0000-0000-0000000000a6'), 0, 'the course is gone');
SELECT is(
  (SELECT old_value || '>' || coalesce(new_value, 'null') FROM _audit WHERE course_id = 'c0000000-0000-0000-0000-0000000000a6' AND action = 'deleted'),
  'draft>null', 'the deletion is audited and survives the course'
);
SELECT lives_ok($$ SELECT app.staff_delete_course('c0000000-0000-0000-0000-0000000000a3', '2026-01-01 00:00:00+00') $$, 'delete cascades to modules, lessons and videos');
SELECT is((SELECT count(*)::int FROM _lv WHERE course_id = 'c0000000-0000-0000-0000-0000000000a3'), 0, 'its lessons are gone');
SELECT lives_ok($$ SELECT app.staff_delete_course('c0000000-0000-0000-0000-0000000000c1', '2026-01-01 00:00:00+00') $$, 'an archived course without sales can be deleted');

-- Admin and superadmin share the same status rules -----------------------------------------
RESET ROLE;
UPDATE public.courses SET price_cents = 5000 WHERE id = 'c0000000-0000-0000-0000-0000000000a2';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT lives_ok(
  $$ SELECT * FROM app.staff_set_course_status('c0000000-0000-0000-0000-0000000000a2',
       (SELECT updated_at FROM _cv WHERE id = 'c0000000-0000-0000-0000-0000000000a2'), 'published') $$,
  'admin publishes once the price is set'
);
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT throws_ok($$ SELECT * FROM app.staff_set_course_status('c0000000-0000-0000-0000-0000000000a5', '2026-01-01 00:00:00+00', 'published') $$, 'CR004', 'publish_gate_violated', 'superadmin is also stopped by the gate');
SELECT lives_ok($$ SELECT app.staff_delete_course('c0000000-0000-0000-0000-0000000000a5', '2026-01-01 00:00:00+00') $$, 'superadmin deletes a course without sales');

SELECT * FROM finish();
ROLLBACK;
