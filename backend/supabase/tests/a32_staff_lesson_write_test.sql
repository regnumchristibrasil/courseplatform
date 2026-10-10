-- A32 -- staff lesson RPCs: add, update, reorder, move, archive/unarchive, delete (ticket #18).
BEGIN;
SELECT plan(58);

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'superadmin@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'tutor@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'student@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'inactivetutor@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'buyer@example.com');

UPDATE app_private.user_access SET role = 'superadmin' WHERE user_id = '11111111-1111-1111-1111-111111111111';
UPDATE app_private.user_access SET role = 'tutor' WHERE user_id IN ('33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555');
UPDATE app_private.user_access SET is_active = false WHERE user_id = '55555555-5555-5555-5555-555555555555';

-- D: draft sem vendas (2 modulos). E: outro curso. P: publicado sem vendas. S: publicado com matricula.
INSERT INTO public.courses (id, title, price_cents, status) VALUES
  ('c0000000-0000-0000-0000-0000000000d1', 'Draft D', 10000, 'draft'),
  ('c0000000-0000-0000-0000-0000000000e1', 'Other E', 10000, 'draft'),
  ('c0000000-0000-0000-0000-0000000000f1', 'Published P', 10000, 'published'),
  ('c0000000-0000-0000-0000-0000000000a1', 'Sales S', 10000, 'draft');

INSERT INTO public.modules (id, course_id, title, position) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d1', 'D1', 1),
  ('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000d1', 'D2', 2),
  ('a0000000-0000-0000-0000-0000000000e1', 'c0000000-0000-0000-0000-0000000000e1', 'E1', 1),
  ('a0000000-0000-0000-0000-0000000000f1', 'c0000000-0000-0000-0000-0000000000f1', 'P1', 1),
  ('a0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000a1', 'S1', 1);

-- D1: l1, l2, l3 (l3 arquivada). D2: l4.
INSERT INTO public.lessons (id, course_id, module_id, title, position, archived_at) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000001', 'L1', 1, NULL),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000001', 'L2', 2, NULL),
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000001', 'L3', 3, '2026-02-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000002', 'L4', 1, NULL),
  -- P: pa1 ativa com video, pa2 arquivada com video, pa3 arquivada sem video
  ('d0000000-0000-0000-0000-0000000000f1', 'c0000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f1', 'PA1', 1, NULL),
  ('d0000000-0000-0000-0000-0000000000f2', 'c0000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f1', 'PA2', 2, '2026-02-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-0000000000f3', 'c0000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f1', 'PA3', 3, '2026-02-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000b1', 'SA1', 1, NULL);

INSERT INTO app_private.lesson_assets (lesson_id, provider, external_ref) VALUES
  ('d0000000-0000-0000-0000-0000000000f1', 'youtube', 'dQw4w9WgXcQ'),
  ('d0000000-0000-0000-0000-0000000000f2', 'youtube', 'dQw4w9WgXcQ');

INSERT INTO public.enrollments (user_id, course_id, status, expires_at) VALUES
  ('66666666-6666-6666-6666-666666666666', 'c0000000-0000-0000-0000-0000000000a1', 'active', now() + interval '30 days');

-- RLS hides draft content from authenticated: read through postgres-owned views.
CREATE TEMP VIEW _lv AS SELECT * FROM public.lessons;
GRANT SELECT ON _lv TO authenticated;
CREATE TEMP VIEW _av AS SELECT * FROM app_private.course_audit;
GRANT SELECT ON _av TO authenticated;

-- Shape -----------------------------------------------------------------
SELECT has_function('app', 'staff_add_lesson', ARRAY['uuid', 'text', 'integer', 'boolean', 'boolean'], 'staff_add_lesson exists');
SELECT has_function('app', 'staff_update_lesson', ARRAY['uuid', 'timestamp with time zone', 'text', 'integer', 'boolean'], 'staff_update_lesson exists');
SELECT has_function('app', 'staff_reorder_lessons', ARRAY['uuid', 'uuid[]'], 'staff_reorder_lessons exists');
SELECT has_function('app', 'staff_move_lesson', ARRAY['uuid', 'timestamp with time zone', 'uuid'], 'staff_move_lesson exists');
SELECT has_function('app', 'staff_set_lesson_archived', ARRAY['uuid', 'timestamp with time zone', 'boolean'], 'staff_set_lesson_archived exists');
SELECT has_function('app', 'staff_delete_lesson', ARRAY['uuid', 'timestamp with time zone'], 'staff_delete_lesson exists');
SELECT ok(
  (SELECT bool_and(prosecdef AND proconfig @> ARRAY['search_path=""'])
   FROM pg_proc WHERE proname IN ('staff_add_lesson', 'staff_update_lesson', 'staff_reorder_lessons',
                                  'staff_move_lesson', 'staff_set_lesson_archived', 'staff_delete_lesson')),
  'all lesson RPCs are SECURITY DEFINER with an empty search_path'
);
SELECT ok(NOT has_function_privilege('anon', 'app.staff_delete_lesson(uuid, timestamp with time zone)', 'EXECUTE'), 'anon cannot delete');
SELECT ok(has_function_privilege('authenticated', 'app.staff_reorder_lessons(uuid, uuid[])', 'EXECUTE'), 'authenticated can reorder');

-- Authorization ---------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT throws_ok($$ SELECT * FROM app.staff_add_lesson('a0000000-0000-0000-0000-000000000001', 'X', NULL, false, false) $$, '42501', 'forbidden', 'student cannot add');
SELECT throws_ok($$ SELECT * FROM app.staff_add_lesson('a0000000-0000-0000-0000-00000000ffff', 'X', NULL, false, false) $$, '42501', 'forbidden', 'student gets forbidden (not not_found) for unknown module');
SET LOCAL "request.jwt.claim.sub" = '55555555-5555-5555-5555-555555555555';
SELECT throws_ok($$ SELECT * FROM app.staff_delete_lesson('d0000000-0000-0000-0000-000000000001', now()) $$, '42501', 'forbidden', 'inactive tutor cannot delete');

-- Add (tutor) -----------------------------------------------------------
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT throws_ok($$ SELECT * FROM app.staff_add_lesson('a0000000-0000-0000-0000-00000000ffff', 'X', NULL, false, false) $$, 'P0002', 'not_found', 'add to unknown module is not_found');
SELECT throws_ok($$ SELECT * FROM app.staff_add_lesson(NULL, 'X', NULL, false, false) $$, '22023', 'invalid_input', 'null module id is invalid');
SELECT throws_ok($$ SELECT * FROM app.staff_add_lesson('a0000000-0000-0000-0000-000000000001', E' \t\n', NULL, false, false) $$, '22023', 'invalid_input', 'blank title is invalid');
SELECT throws_ok($$ SELECT * FROM app.staff_add_lesson('a0000000-0000-0000-0000-000000000001', repeat('x', 201), NULL, false, false) $$, '22023', 'invalid_input', 'title above 200 chars is invalid');
SELECT throws_ok($$ SELECT * FROM app.staff_add_lesson('a0000000-0000-0000-0000-000000000001', 'X', -1, false, false) $$, '22023', 'invalid_input', 'negative duration is invalid');
SELECT throws_ok($$ SELECT * FROM app.staff_add_lesson('a0000000-0000-0000-0000-000000000001', 'X', 0, false, false) $$, '22023', 'invalid_input', 'zero duration is invalid');
SELECT throws_ok($$ SELECT * FROM app.staff_add_lesson('a0000000-0000-0000-0000-000000000001', 'X', NULL, NULL, false) $$, '22023', 'invalid_input', 'null free-preview flag is invalid');
SELECT lives_ok($$ SELECT * FROM app.staff_add_lesson('a0000000-0000-0000-0000-000000000001', '  Nova aula  ', 90, true, false) $$, 'tutor adds a lesson to a draft course');
SELECT is(
  (SELECT title || '@' || position || '/' || duration_seconds || '/' || is_free_preview FROM _lv
   WHERE module_id = 'a0000000-0000-0000-0000-000000000001' ORDER BY position DESC LIMIT 1),
  'Nova aula@4/90/true',
  'new lesson is trimmed and appended after archived ones'
);
SELECT lives_ok($$ SELECT * FROM app.staff_add_lesson('a0000000-0000-0000-0000-000000000002', 'Arquivada', NULL, false, true) $$, 'tutor adds an archived lesson');
SELECT isnt((SELECT archived_at FROM _lv WHERE title = 'Arquivada'), NULL, 'lesson created archived has archived_at set');

-- Publish gate: a new active lesson in a published course needs a video ---------------
SELECT throws_ok(
  $$ SELECT * FROM app.staff_add_lesson('a0000000-0000-0000-0000-0000000000f1', 'Sem video', NULL, false, false) $$,
  'CR004', 'publish_gate_violated', 'active lesson without video in a published course is rejected'
);
SELECT lives_ok($$ SELECT * FROM app.staff_add_lesson('a0000000-0000-0000-0000-0000000000f1', 'Rascunho de aula', NULL, false, true) $$, 'archived lesson can be created in a published course');

-- Update (optimistic lock) -----------------------------------------------
SELECT lives_ok(
  $$ SELECT * FROM app.staff_update_lesson('d0000000-0000-0000-0000-000000000001',
       (SELECT updated_at FROM _lv WHERE id = 'd0000000-0000-0000-0000-000000000001'), '  L1 editada ', 120, true) $$,
  'tutor updates a lesson with the updated_at it read'
);
SELECT is(
  (SELECT title || '/' || duration_seconds || '/' || is_free_preview FROM _lv WHERE id = 'd0000000-0000-0000-0000-000000000001'),
  'L1 editada/120/true', 'update trims title and stores duration and preview flag'
);
SELECT throws_ok(
  $$ SELECT * FROM app.staff_update_lesson('d0000000-0000-0000-0000-000000000001',
       (SELECT updated_at - interval '1 second' FROM _lv WHERE id = 'd0000000-0000-0000-0000-000000000001'), 'Outra', NULL, false) $$,
  'CR001', 'stale_target', 'stale updated_at is stale_target'
);
SELECT is((SELECT title FROM _lv WHERE id = 'd0000000-0000-0000-0000-000000000001'), 'L1 editada', 'stale update writes nothing');
SELECT throws_ok($$ SELECT * FROM app.staff_update_lesson('d0000000-0000-0000-0000-000000000001', NULL, 'X', NULL, false) $$, '22023', 'invalid_input', 'null expected updated_at is invalid');
SELECT throws_ok($$ SELECT * FROM app.staff_update_lesson('d0000000-0000-0000-0000-00000000ffff', now(), 'X', NULL, false) $$, 'P0002', 'not_found', 'update unknown lesson is not_found');
SELECT lives_ok(
  $$ SELECT * FROM app.staff_update_lesson('d0000000-0000-0000-0000-000000000001',
       (SELECT updated_at FROM _lv WHERE id = 'd0000000-0000-0000-0000-000000000001'), 'L1', NULL, false) $$,
  'update can clear the duration'
);

-- Reorder ---------------------------------------------------------------
SELECT lives_ok(
  $$ SELECT * FROM app.staff_reorder_lessons('a0000000-0000-0000-0000-000000000001',
       ARRAY['d0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002',
             'd0000000-0000-0000-0000-000000000001', (SELECT id FROM _lv WHERE title = 'Nova aula')]::uuid[]) $$,
  'tutor reorders with the full list (archived included)'
);
SELECT is(
  (SELECT array_agg(title ORDER BY position) FROM _lv WHERE module_id = 'a0000000-0000-0000-0000-000000000001'),
  ARRAY['L3', 'L2', 'L1', 'Nova aula'], 'positions are rewritten in the given order'
);
SELECT throws_ok(
  $$ SELECT * FROM app.staff_reorder_lessons('a0000000-0000-0000-0000-000000000001',
       ARRAY['d0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002']::uuid[]) $$,
  'CR001', 'stale_target', 'list missing lessons is stale_target'
);
SELECT throws_ok(
  $$ SELECT * FROM app.staff_reorder_lessons('a0000000-0000-0000-0000-000000000001',
       ARRAY['d0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003',
             'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002']::uuid[]) $$,
  '22023', 'invalid_input', 'duplicate ids are invalid_input'
);
SELECT throws_ok(
  $$ SELECT * FROM app.staff_reorder_lessons('a0000000-0000-0000-0000-000000000001',
       ARRAY['d0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000002',
             'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003']::uuid[]) $$,
  'CR001', 'stale_target', 'lesson of another module in the list is stale_target'
);
SELECT throws_ok($$ SELECT * FROM app.staff_reorder_lessons('a0000000-0000-0000-0000-00000000ffff', ARRAY[]::uuid[]) $$, 'P0002', 'not_found', 'reorder in unknown module is not_found');

-- Move across modules -----------------------------------------------------
SELECT lives_ok(
  $$ SELECT * FROM app.staff_move_lesson('d0000000-0000-0000-0000-000000000002',
       (SELECT updated_at FROM _lv WHERE id = 'd0000000-0000-0000-0000-000000000002'),
       'a0000000-0000-0000-0000-000000000002') $$,
  'tutor moves a lesson to another module of the same course'
);
SELECT is(
  (SELECT module_id::text || '@' || position FROM _lv WHERE id = 'd0000000-0000-0000-0000-000000000002'),
  'a0000000-0000-0000-0000-000000000002@3', 'moved lesson is appended to the target module'
);
SELECT is(
  (SELECT array_agg(position ORDER BY position) FROM _lv WHERE module_id = 'a0000000-0000-0000-0000-000000000001'),
  ARRAY[1, 2, 3], 'source module positions are compacted'
);
SELECT throws_ok(
  $$ SELECT * FROM app.staff_move_lesson('d0000000-0000-0000-0000-000000000001',
       (SELECT updated_at FROM _lv WHERE id = 'd0000000-0000-0000-0000-000000000001'),
       'a0000000-0000-0000-0000-0000000000e1') $$,
  '22023', 'invalid_input', 'moving to a module of another course is impossible'
);
SELECT throws_ok(
  $$ SELECT * FROM app.staff_move_lesson('d0000000-0000-0000-0000-000000000001',
       (SELECT updated_at FROM _lv WHERE id = 'd0000000-0000-0000-0000-000000000001'),
       'a0000000-0000-0000-0000-000000000001') $$,
  '22023', 'invalid_input', 'moving to the same module is invalid_input'
);
SELECT throws_ok(
  $$ SELECT * FROM app.staff_move_lesson('d0000000-0000-0000-0000-000000000001',
       (SELECT updated_at - interval '1 second' FROM _lv WHERE id = 'd0000000-0000-0000-0000-000000000001'),
       'a0000000-0000-0000-0000-000000000002') $$,
  'CR001', 'stale_target', 'stale move is stale_target'
);
SELECT throws_ok(
  $$ SELECT * FROM app.staff_move_lesson('d0000000-0000-0000-0000-000000000001', now(), 'a0000000-0000-0000-0000-00000000ffff') $$,
  'P0002', 'not_found', 'move to unknown module is not_found'
);

-- Archive / unarchive -----------------------------------------------------
SELECT lives_ok(
  $$ SELECT * FROM app.staff_set_lesson_archived('d0000000-0000-0000-0000-000000000001',
       (SELECT updated_at FROM _lv WHERE id = 'd0000000-0000-0000-0000-000000000001'), true) $$,
  'tutor archives a lesson'
);
SELECT is((SELECT position FROM _lv WHERE id = 'd0000000-0000-0000-0000-000000000001'), 2, 'archived lesson keeps its position');
SELECT throws_ok(
  $$ SELECT * FROM app.staff_set_lesson_archived('d0000000-0000-0000-0000-000000000001',
       (SELECT updated_at - interval '1 second' FROM _lv WHERE id = 'd0000000-0000-0000-0000-000000000001'), false) $$,
  'CR001', 'stale_target', 'stale archive toggle is stale_target'
);
SELECT lives_ok(
  $$ SELECT * FROM app.staff_set_lesson_archived('d0000000-0000-0000-0000-0000000000f2',
       (SELECT updated_at FROM _lv WHERE id = 'd0000000-0000-0000-0000-0000000000f2'), false) $$,
  'unarchiving a lesson that has a video in a published course is allowed'
);
SELECT throws_ok(
  $$ SELECT * FROM app.staff_set_lesson_archived('d0000000-0000-0000-0000-0000000000f3',
       (SELECT updated_at FROM _lv WHERE id = 'd0000000-0000-0000-0000-0000000000f3'), false) $$,
  'CR004', 'publish_gate_violated', 'unarchiving a lesson without video in a published course is rejected'
);
SELECT isnt((SELECT archived_at FROM _lv WHERE id = 'd0000000-0000-0000-0000-0000000000f3'), NULL, 'rejected unarchive leaves the lesson archived');
SELECT lives_ok(
  $$ SELECT * FROM app.staff_set_lesson_archived('d0000000-0000-0000-0000-0000000000b1',
       (SELECT updated_at FROM _lv WHERE id = 'd0000000-0000-0000-0000-0000000000b1'), true) $$,
  'archiving is allowed in a course with sales'
);

-- Delete -------------------------------------------------------------------
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT throws_ok(
  $$ SELECT * FROM app.staff_delete_lesson('d0000000-0000-0000-0000-0000000000b1',
       (SELECT updated_at FROM _lv WHERE id = 'd0000000-0000-0000-0000-0000000000b1')) $$,
  'CR003', 'course_has_sales', 'course with an enrollment blocks delete'
);
SELECT throws_ok($$ SELECT * FROM app.staff_delete_lesson('d0000000-0000-0000-0000-00000000ffff', now()) $$, 'P0002', 'not_found', 'delete unknown lesson is not_found');
SELECT throws_ok(
  $$ SELECT * FROM app.staff_delete_lesson('d0000000-0000-0000-0000-000000000001',
       (SELECT updated_at - interval '1 second' FROM _lv WHERE id = 'd0000000-0000-0000-0000-000000000001')) $$,
  'CR001', 'stale_target', 'stale delete is stale_target'
);
SELECT lives_ok(
  $$ SELECT * FROM app.staff_delete_lesson('d0000000-0000-0000-0000-000000000001',
       (SELECT updated_at FROM _lv WHERE id = 'd0000000-0000-0000-0000-000000000001')) $$,
  'lesson in a course without sales is deleted'
);
SELECT is(
  (SELECT array_agg(position ORDER BY position) FROM _lv WHERE module_id = 'a0000000-0000-0000-0000-000000000001'),
  ARRAY[1, 2], 'positions are compacted after delete'
);
SELECT is((SELECT count(*)::int FROM _av), 0, 'lesson operations write no course_audit rows');

SELECT * FROM finish();
ROLLBACK;
