-- A31 -- staff module RPCs: add, rename, reorder, archive/unarchive, delete (ticket #17).
BEGIN;
SELECT plan(46);

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

-- D: draft sem vendas. S: publicado com matricula (vendas). O: curso com pedido apenas.
INSERT INTO public.courses (id, title, price_cents, status) VALUES
  ('c0000000-0000-0000-0000-0000000000d1', 'Draft D', 10000, 'draft'),
  ('c0000000-0000-0000-0000-0000000000a1', 'Sales S', 10000, 'draft'),
  ('c0000000-0000-0000-0000-0000000000a2', 'Order only O', 10000, 'draft');

INSERT INTO public.modules (id, course_id, title, position, archived_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d1', 'D1', 1, NULL),
  ('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000d1', 'D2', 2, NULL),
  ('a0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000d1', 'D3 arquivado', 3, '2026-02-01 00:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-0000000000d1', 'D4', 4, NULL),
  ('a0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000a1', 'S1', 1, NULL),
  ('a0000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-0000000000a2', 'O1', 1, NULL);

INSERT INTO public.lessons (id, course_id, module_id, title, position) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000002', 'Aula em D2', 1);

INSERT INTO public.enrollments (user_id, course_id, status, expires_at) VALUES
  ('66666666-6666-6666-6666-666666666666', 'c0000000-0000-0000-0000-0000000000a1', 'active', now() + interval '30 days');
INSERT INTO public.orders (user_id, course_id, amount_cents, provider, status, expires_at) VALUES
  ('44444444-4444-4444-4444-444444444444', 'c0000000-0000-0000-0000-0000000000a2', 10000, 'efi', 'expired', now() - interval '1 day');

-- RLS hides draft content from authenticated: read through postgres-owned views.
CREATE TEMP VIEW _mv AS SELECT * FROM public.modules;
GRANT SELECT ON _mv TO authenticated;
CREATE TEMP VIEW _av AS SELECT * FROM app_private.course_audit;
GRANT SELECT ON _av TO authenticated;

-- Shape -----------------------------------------------------------------
SELECT has_function('app', 'staff_add_module', ARRAY['uuid', 'text'], 'staff_add_module exists');
SELECT has_function('app', 'staff_rename_module', ARRAY['uuid', 'text'], 'staff_rename_module exists');
SELECT has_function('app', 'staff_reorder_modules', ARRAY['uuid', 'uuid[]'], 'staff_reorder_modules exists');
SELECT has_function('app', 'staff_set_module_archived', ARRAY['uuid', 'boolean'], 'staff_set_module_archived exists');
SELECT has_function('app', 'staff_delete_module', ARRAY['uuid'], 'staff_delete_module exists');
SELECT ok(
  (SELECT bool_and(prosecdef AND proconfig @> ARRAY['search_path=""'])
   FROM pg_proc WHERE oid IN (
     'app.staff_add_module(uuid, text)'::regprocedure,
     'app.staff_rename_module(uuid, text)'::regprocedure,
     'app.staff_reorder_modules(uuid, uuid[])'::regprocedure,
     'app.staff_set_module_archived(uuid, boolean)'::regprocedure,
     'app.staff_delete_module(uuid)'::regprocedure)),
  'all module RPCs are SECURITY DEFINER with an empty search_path'
);
SELECT ok(NOT has_function_privilege('anon', 'app.staff_delete_module(uuid)', 'EXECUTE'), 'anon cannot delete');
SELECT ok(NOT has_function_privilege('public', 'app.staff_add_module(uuid, text)', 'EXECUTE'), 'PUBLIC cannot add');
SELECT ok(has_function_privilege('authenticated', 'app.staff_reorder_modules(uuid, uuid[])', 'EXECUTE'), 'authenticated can reorder');

-- Authorization ---------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT throws_ok($$ SELECT * FROM app.staff_add_module('c0000000-0000-0000-0000-0000000000d1', 'X') $$, '42501', 'forbidden', 'student cannot add');
SELECT throws_ok($$ SELECT * FROM app.staff_delete_module('a0000000-0000-0000-0000-000000000001') $$, '42501', 'forbidden', 'student cannot delete');
SET LOCAL "request.jwt.claim.sub" = '55555555-5555-5555-5555-555555555555';
SELECT throws_ok($$ SELECT * FROM app.staff_rename_module('a0000000-0000-0000-0000-000000000001', 'X') $$, '42501', 'forbidden', 'inactive tutor cannot rename');
-- forbidden is checked before existence, so ids are not leaked to non-staff
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT throws_ok($$ SELECT * FROM app.staff_add_module('c0000000-0000-0000-0000-00000000ffff', 'X') $$, '42501', 'forbidden', 'student gets forbidden (not not_found) for unknown course');

-- Add (tutor) -----------------------------------------------------------
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT throws_ok($$ SELECT * FROM app.staff_add_module('c0000000-0000-0000-0000-00000000ffff', 'X') $$, 'P0002', 'not_found', 'add to unknown course is not_found');
SELECT throws_ok($$ SELECT * FROM app.staff_add_module(NULL, 'X') $$, '22023', 'invalid_input', 'null course id is invalid');
SELECT throws_ok($$ SELECT * FROM app.staff_add_module('c0000000-0000-0000-0000-0000000000d1', E' \t\n') $$, '22023', 'invalid_input', 'blank title is invalid');
SELECT throws_ok($$ SELECT * FROM app.staff_add_module('c0000000-0000-0000-0000-0000000000d1', repeat('x', 201)) $$, '22023', 'invalid_input', 'title above 200 chars is invalid');
SELECT lives_ok($$ SELECT * FROM app.staff_add_module('c0000000-0000-0000-0000-0000000000d1', '  Novo modulo  ') $$, 'tutor adds a module');
SELECT is(
  (SELECT title || '@' || position FROM _mv WHERE course_id = 'c0000000-0000-0000-0000-0000000000d1' ORDER BY position DESC LIMIT 1),
  'Novo modulo@5',
  'new module is trimmed and appended after archived ones (position 5)'
);

-- Rename ----------------------------------------------------------------
SELECT lives_ok($$ SELECT * FROM app.staff_rename_module('a0000000-0000-0000-0000-000000000001', '  Renomeado ') $$, 'tutor renames');
SELECT is((SELECT title FROM _mv WHERE id = 'a0000000-0000-0000-0000-000000000001'), 'Renomeado', 'rename trims the title');
SELECT throws_ok($$ SELECT * FROM app.staff_rename_module('a0000000-0000-0000-0000-000000000001', '') $$, '22023', 'invalid_input', 'empty rename is invalid');
SELECT throws_ok($$ SELECT * FROM app.staff_rename_module('a0000000-0000-0000-0000-00000000ffff', 'X') $$, 'P0002', 'not_found', 'rename unknown module is not_found');

-- Reorder (admin) -------------------------------------------------------
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT lives_ok(
  $$ SELECT * FROM app.staff_reorder_modules(
       'c0000000-0000-0000-0000-0000000000d1',
       ARRAY['a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003',
             'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001',
             (SELECT id FROM _mv WHERE title = 'Novo modulo')]::uuid[]) $$,
  'admin reorders with the full list (archived included)'
);
SELECT is(
  (SELECT array_agg(left(title, 2) ORDER BY position) FROM _mv WHERE course_id = 'c0000000-0000-0000-0000-0000000000d1' AND position <= 4),
  ARRAY['D4', 'D3', 'D2', 'Re'],
  'positions are rewritten in the given order'
);
SELECT is(
  (SELECT array_agg(position ORDER BY position) FROM _mv WHERE course_id = 'c0000000-0000-0000-0000-0000000000d1'),
  ARRAY[1, 2, 3, 4, 5],
  'positions stay dense 1..N'
);
SELECT throws_ok(
  $$ SELECT * FROM app.staff_reorder_modules('c0000000-0000-0000-0000-0000000000d1',
       ARRAY['a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003']::uuid[]) $$,
  'CR001', 'stale_target', 'list missing modules is stale_target'
);
SELECT throws_ok(
  $$ SELECT * FROM app.staff_reorder_modules('c0000000-0000-0000-0000-0000000000d1',
       ARRAY['a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003',
             'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-00000000ffff']::uuid[]) $$,
  'CR001', 'stale_target', 'list with an unknown module is stale_target'
);
SELECT throws_ok(
  $$ SELECT * FROM app.staff_reorder_modules('c0000000-0000-0000-0000-0000000000d1',
       ARRAY['a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004',
             'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-000000000003']::uuid[]) $$,
  '22023', 'invalid_input', 'duplicate ids are invalid_input'
);
SELECT throws_ok($$ SELECT * FROM app.staff_reorder_modules('c0000000-0000-0000-0000-0000000000d1', NULL) $$, '22023', 'invalid_input', 'null list is invalid_input');
SELECT throws_ok($$ SELECT * FROM app.staff_reorder_modules('c0000000-0000-0000-0000-00000000ffff', ARRAY[]::uuid[]) $$, 'P0002', 'not_found', 'reorder on unknown course is not_found');

-- Archive / unarchive (superadmin) -------------------------------------------
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT lives_ok($$ SELECT * FROM app.staff_set_module_archived('a0000000-0000-0000-0000-000000000002', true) $$, 'superadmin archives a module with lessons');
SELECT isnt((SELECT archived_at FROM _mv WHERE id = 'a0000000-0000-0000-0000-000000000002'), NULL, 'archived_at is set');
SELECT is((SELECT position FROM _mv WHERE id = 'a0000000-0000-0000-0000-000000000002'), 3, 'archived module keeps its position');
SELECT lives_ok($$ SELECT * FROM app.staff_set_module_archived('a0000000-0000-0000-0000-000000000002', false) $$, 'superadmin unarchives');
SELECT is((SELECT archived_at FROM _mv WHERE id = 'a0000000-0000-0000-0000-000000000002'), NULL, 'archived_at is cleared');
SELECT lives_ok($$ SELECT * FROM app.staff_set_module_archived('a0000000-0000-0000-0000-0000000000b1', true) $$, 'archiving is allowed in a course with sales');

-- Archived modules disappear from the public curriculum ----------------
SET LOCAL ROLE postgres;
UPDATE public.courses SET status = 'published' WHERE id = 'c0000000-0000-0000-0000-0000000000d1';
SET LOCAL ROLE anon;
SELECT is((SELECT count(*)::int FROM public.modules WHERE id = 'a0000000-0000-0000-0000-000000000003'), 0, 'anon cannot see an archived module of a published course');
SELECT is((SELECT count(*)::int FROM public.lessons WHERE module_id = 'a0000000-0000-0000-0000-000000000003'), 0, 'anon sees no lessons of an archived module');
SET LOCAL ROLE postgres;
UPDATE public.courses SET status = 'draft' WHERE id = 'c0000000-0000-0000-0000-0000000000d1';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

-- Delete ----------------------------------------------------------------
SELECT throws_ok($$ SELECT * FROM app.staff_delete_module('a0000000-0000-0000-0000-000000000002') $$, 'CR002', 'module_not_empty', 'module with lessons cannot be deleted');
SELECT throws_ok($$ SELECT * FROM app.staff_delete_module('a0000000-0000-0000-0000-0000000000b1') $$, 'CR003', 'course_has_sales', 'course with an enrollment blocks delete');
SELECT throws_ok($$ SELECT * FROM app.staff_delete_module('a0000000-0000-0000-0000-0000000000c1') $$, 'CR003', 'course_has_sales', 'course with only an expired order blocks delete');
SELECT throws_ok($$ SELECT * FROM app.staff_delete_module('a0000000-0000-0000-0000-00000000ffff') $$, 'P0002', 'not_found', 'delete unknown module is not_found');
SELECT lives_ok($$ SELECT * FROM app.staff_delete_module('a0000000-0000-0000-0000-000000000004') $$, 'empty module in a course without sales is deleted');
SELECT is(
  (SELECT array_agg(position ORDER BY position) FROM _mv WHERE course_id = 'c0000000-0000-0000-0000-0000000000d1'),
  ARRAY[1, 2, 3, 4],
  'positions are compacted after delete'
);
SELECT is((SELECT count(*)::int FROM _av), 0, 'module operations write no course_audit rows');

SELECT * FROM finish();
ROLLBACK;
