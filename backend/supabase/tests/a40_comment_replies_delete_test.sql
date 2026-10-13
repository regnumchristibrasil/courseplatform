-- A40 -- respostas de um nivel e exclusao logica de comentarios (ticket #28; ADR 0004).
-- Responde-se apenas a comentario raiz ativo da mesma aula. Autor exclui o proprio;
-- equipe exclui qualquer um; terceiros nao. Exclusao grava deleted_by/deleted_at.
-- Raiz excluida com respostas aparece como removida; sem respostas, some.
-- Comentarios excluidos continuam contando para o limite de taxa.
BEGIN;
SELECT plan(60);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'maria@example.com', '{"full_name": "Maria Souza"}'),
  ('22222222-2222-2222-2222-222222222222', 'joao@example.com', '{"full_name": "Joao Pedro"}'),
  ('44444444-4444-4444-4444-444444444444', 'tutor@example.com', '{"full_name": "Tutor Chefe"}'),
  ('55555555-5555-5555-5555-555555555555', 'outsider@example.com', '{"full_name": "Fora Souza"}'),
  ('66666666-6666-6666-6666-666666666666', 'expired@example.com', '{"full_name": "Expirado Souza"}'),
  ('33333333-3333-3333-3333-333333333333', 'inactive@example.com', '{"full_name": "Inativo Silva"}');
UPDATE app_private.user_access SET role = 'tutor' WHERE user_id = '44444444-4444-4444-4444-444444444444';
UPDATE app_private.user_access SET is_active = false WHERE user_id = '33333333-3333-3333-3333-333333333333';

INSERT INTO public.courses (id, title, price_cents, status) VALUES
  ('c0000000-0000-0000-0000-0000000000a1', 'Course A', 10000, 'published');
INSERT INTO public.modules (id, course_id, title, position) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'A / M1', 1);
INSERT INTO public.lessons (id, course_id, module_id, title, position) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A1', 1),
  ('a1000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A4', 2),
  ('a1000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A5', 3);
INSERT INTO public.enrollments (user_id, course_id, status, granted_at, expires_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a1', 'active', now() - interval '5 days', NULL),
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-0000000000a1', 'active', now() - interval '5 days', NULL),
  ('33333333-3333-3333-3333-333333333333', 'c0000000-0000-0000-0000-0000000000a1', 'active', now(), NULL),
  ('66666666-6666-6666-6666-666666666666', 'c0000000-0000-0000-0000-0000000000a1', 'active', now() - interval '60 days', now() + interval '1 day');

-- Comentarios raiz e uma resposta ja existentes (criados como superusuario, antes do prazo).
INSERT INTO public.lesson_comments (id, lesson_id, user_id, body, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'raiz da Maria', now() - interval '1 hour'),
  ('b0000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'raiz do Joao', now() - interval '50 minutes'),
  ('b0000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'raiz da Maria sem respostas', now() - interval '40 minutes'),
  ('b0000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'raiz em outra aula', now() - interval '30 minutes');

CREATE TEMP TABLE ids (name text PRIMARY KEY, id uuid);
GRANT SELECT ON ids TO authenticated;

-- Forma ------------------------------------------------------------------
SELECT has_column('public', 'lesson_comments', 'parent_id', 'lesson_comments.parent_id exists');
SELECT has_column('public', 'lesson_comments', 'deleted_at', 'lesson_comments.deleted_at exists');
SELECT has_column('public', 'lesson_comments', 'deleted_by', 'lesson_comments.deleted_by exists');
SELECT has_function('app', 'create_lesson_comment', ARRAY['uuid', 'text', 'uuid'], 'create_lesson_comment accepts an optional parent');
SELECT has_function('app', 'delete_lesson_comment', ARRAY['uuid'], 'app.delete_lesson_comment exists');
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'app.delete_lesson_comment(uuid)'::regprocedure), 'delete RPC is SECURITY DEFINER with empty search_path');
SELECT ok(has_function_privilege('authenticated', 'app.delete_lesson_comment(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'app.delete_lesson_comment(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('public', 'app.delete_lesson_comment(uuid)', 'EXECUTE'), 'delete RPC: authenticated only');
SELECT is(
  (SELECT proargnames FROM pg_proc WHERE oid = 'app.list_lesson_comments(uuid, timestamptz, uuid)'::regprocedure)::text,
  '{p_lesson_id,p_cursor_created_at,p_cursor_id,id,parent_id,author_first_name,is_staff_author,body,created_at,is_own,is_deleted,can_delete}',
  'list projects no e-mail and no user id; adds parent_id, is_deleted, can_delete'
);
SELECT throws_ok($$ INSERT INTO public.lesson_comments (lesson_id, user_id, body, deleted_by) VALUES ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x', '44444444-4444-4444-4444-444444444444') $$, '23514', NULL, 'deleted_by without deleted_at violates the table check');

-- Responder ----------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT results_eq(
  $$ SELECT parent_id, author_first_name, body, is_own, is_deleted, can_delete FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'resposta do Joao', 'b0000000-0000-0000-0000-000000000001') $$,
  $$ VALUES ('b0000000-0000-0000-0000-000000000001'::uuid, 'Joao'::text, 'resposta do Joao'::text, true, false, true) $$,
  'student replies to a root comment'
);
RESET ROLE;
UPDATE public.lesson_comments SET created_at = now() - interval '30 minutes' WHERE body = 'resposta do Joao';
INSERT INTO ids SELECT 'joao_reply', id FROM public.lesson_comments WHERE body = 'resposta do Joao';
SELECT is((SELECT parent_id FROM public.lesson_comments WHERE body = 'resposta do Joao'), 'b0000000-0000-0000-0000-000000000001'::uuid, 'reply stores its parent');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT throws_ok(
  $$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'resposta da resposta', (SELECT id FROM ids WHERE name = 'joao_reply')) $$,
  '22023', 'invalid_input', 'cannot reply to a reply (one level only)');
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'oi', 'b0000000-0000-0000-0000-000000000004') $$, '22023', 'invalid_input', 'parent from another lesson is invalid_input');
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'oi', '99999999-9999-9999-9999-999999999999') $$, '22023', 'invalid_input', 'unknown parent is invalid_input');
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', '   ', 'b0000000-0000-0000-0000-000000000001') $$, '22023', 'invalid_input', 'blank reply is invalid_input');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT results_eq(
  $$ SELECT is_staff_author, can_delete FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'resposta da equipe', 'b0000000-0000-0000-0000-000000000001') $$,
  $$ VALUES (true, true) $$,
  'staff replies with the Equipe flag');
RESET ROLE;
UPDATE public.lesson_comments SET created_at = now() - interval '20 minutes' WHERE body = 'resposta da equipe';
INSERT INTO ids SELECT 'staff_reply', id FROM public.lesson_comments WHERE body = 'resposta da equipe';

-- Responder sem direito -------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '55555555-5555-5555-5555-555555555555';
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'oi', 'b0000000-0000-0000-0000-000000000001') $$, '42501', 'forbidden', 'no enrollment: reply is forbidden (not invalid_input)');
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'oi', 'b0000000-0000-0000-0000-000000000001') $$, '42501', 'forbidden', 'deactivated user: reply is forbidden');
RESET "request.jwt.claim.sub";
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'oi', 'b0000000-0000-0000-0000-000000000001') $$, '42501', 'unauthorized', 'no session: reply is unauthorized');
RESET ROLE;

-- Listar: raiz com respostas, em ordem ------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT string_agg(coalesce(body, '?'), ' | ') FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001')),
  'raiz da Maria sem respostas | raiz do Joao | raiz da Maria | resposta do Joao | resposta da equipe',
  'roots newest first; replies follow their root, oldest first'
);
SELECT results_eq(
  $$ SELECT body, can_delete FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001') ORDER BY body $$,
  $$ VALUES ('raiz da Maria'::text, true), ('raiz da Maria sem respostas', true), ('raiz do Joao', false), ('resposta da equipe', false), ('resposta do Joao', false) $$,
  'can_delete is true only for the viewer''s own comments');
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT is((SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001') WHERE can_delete), 5::bigint, 'staff can delete every visible comment');
RESET ROLE;

-- Excluir: quem pode -------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT throws_ok($$ SELECT app.delete_lesson_comment('b0000000-0000-0000-0000-000000000001') $$, '42501', 'forbidden', 'a third party cannot delete someone else''s comment');
RESET ROLE;
SELECT is((SELECT deleted_at FROM public.lesson_comments WHERE id = 'b0000000-0000-0000-0000-000000000001'), NULL::timestamptz, 'the refused delete left the comment untouched');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '66666666-6666-6666-6666-666666666666';
SELECT throws_ok($$ SELECT app.delete_lesson_comment('b0000000-0000-0000-0000-000000000001') $$, '42501', 'forbidden', 'a student without the right cannot delete');
SET LOCAL "request.jwt.claim.sub" = '55555555-5555-5555-5555-555555555555';
SELECT throws_ok($$ SELECT app.delete_lesson_comment('b0000000-0000-0000-0000-000000000001') $$, '42501', 'forbidden', 'outsider cannot delete');
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT throws_ok($$ SELECT app.delete_lesson_comment('b0000000-0000-0000-0000-000000000001') $$, '42501', 'forbidden', 'deactivated user cannot delete');
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT throws_ok($$ SELECT app.delete_lesson_comment('99999999-9999-9999-9999-999999999999') $$, '42501', 'forbidden', 'unknown comment: forbidden (no enumeration)');
SELECT throws_ok($$ SELECT app.delete_lesson_comment(NULL) $$, '22023', 'invalid_input', 'null id is invalid_input');
RESET "request.jwt.claim.sub";
SELECT throws_ok($$ SELECT app.delete_lesson_comment('b0000000-0000-0000-0000-000000000001') $$, '42501', 'unauthorized', 'no session: unauthorized');
RESET ROLE;

-- Excluir: autor e equipe -------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT lives_ok($$ SELECT app.delete_lesson_comment('b0000000-0000-0000-0000-000000000001') $$, 'author deletes own root comment');
SELECT lives_ok($$ SELECT app.delete_lesson_comment('b0000000-0000-0000-0000-000000000003') $$, 'author deletes own root comment without replies');
RESET ROLE;
SELECT results_eq(
  $$ SELECT deleted_by, deleted_at IS NOT NULL FROM public.lesson_comments WHERE id = 'b0000000-0000-0000-0000-000000000001' $$,
  $$ VALUES ('11111111-1111-1111-1111-111111111111'::uuid, true) $$,
  'deleted_by and deleted_at are recorded; row is kept (soft delete)');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT lives_ok($$ SELECT app.delete_lesson_comment((SELECT id FROM ids WHERE name = 'joao_reply')) $$, 'staff deletes a student reply');
SELECT lives_ok($$ SELECT app.delete_lesson_comment('b0000000-0000-0000-0000-000000000001') $$, 'deleting an already deleted comment is a no-op, not an error');
RESET ROLE;
SELECT is((SELECT deleted_by FROM public.lesson_comments WHERE id = 'b0000000-0000-0000-0000-000000000001'), '11111111-1111-1111-1111-111111111111'::uuid, 'a repeated delete does not overwrite who deleted first');
SELECT is((SELECT deleted_by FROM public.lesson_comments WHERE body = 'resposta do Joao'), '44444444-4444-4444-4444-444444444444'::uuid, 'staff deletion records the staff user');

-- Listar apos exclusao ---------------------------------------------------------------
-- Estado: raiz da Maria excluida (com a resposta da equipe viva, a do Joao excluida);
-- raiz da Maria sem respostas excluida; raiz do Joao viva.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT results_eq(
  $$ SELECT is_deleted, author_first_name, body, is_staff_author, is_own, can_delete FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001') WHERE id = 'b0000000-0000-0000-0000-000000000001' $$,
  $$ VALUES (true, ''::text, ''::text, false, false, false) $$,
  'deleted root with live replies is listed as removed: no author, no body, nothing to delete');
SELECT is((SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001') WHERE id = 'b0000000-0000-0000-0000-000000000003'), 0::bigint, 'deleted root without replies disappears');
SELECT is((SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001') WHERE body = 'resposta do Joao'), 0::bigint, 'deleted reply disappears');
SELECT is((SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001') WHERE body = 'resposta da equipe'), 1::bigint, 'the live reply under a removed root stays visible');
SELECT is((SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001')), 3::bigint, 'visible rows: removed root + its live reply + the other root');
SELECT is(
  (SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001') WHERE body LIKE 'raiz da Maria%'),
  0::bigint, 'deleted body text is never returned');
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'oi', 'b0000000-0000-0000-0000-000000000001') $$, '22023', 'invalid_input', 'cannot reply to a removed comment');
RESET ROLE;

-- Raiz removida cuja ultima resposta tambem foi excluida some -------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT lives_ok($$ SELECT app.delete_lesson_comment((SELECT id FROM ids WHERE name = 'staff_reply')) $$, 'staff deletes the last live reply');
SELECT is((SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001') WHERE id = 'b0000000-0000-0000-0000-000000000001'), 0::bigint, 'removed root with no live replies disappears');
RESET ROLE;

-- Paginacao so de raizes ------------------------------------------------------------------
-- Aula A4: 22 raizes (c1..c22). Resposta na mais nova (c22, 1a da pagina) e na c2 (21a: so sinaliza).
INSERT INTO public.lesson_comments (id, lesson_id, user_id, body, created_at)
SELECT ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'a1000000-0000-0000-0000-000000000004',
       '22222222-2222-2222-2222-222222222222', 'c' || i, timestamptz '2026-01-01T00:00:00Z' + i * interval '1 second'
FROM generate_series(1, 22) AS i;
INSERT INTO public.lesson_comments (lesson_id, user_id, body, parent_id, created_at) VALUES
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'r22', '00000000-0000-0000-0000-000000000022', timestamptz '2026-01-02T00:00:00Z'),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'r2', '00000000-0000-0000-0000-000000000002', timestamptz '2026-01-02T00:00:00Z');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000004') WHERE parent_id IS NULL), 21::bigint, 'page returns 21 roots (20 + 1 to signal more)');
SELECT is((SELECT string_agg(body, ',') FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000004') WHERE parent_id IS NOT NULL), 'r22', 'replies of the signal root are not returned');
SELECT is(
  (SELECT string_agg(body, ',') FROM (SELECT body FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000004') LIMIT 3) t),
  'c22,r22,c21', 'a reply is returned right after its root');
SELECT is(
  (SELECT string_agg(body, ',') FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000004', timestamptz '2026-01-01T00:00:03Z', '00000000-0000-0000-0000-000000000003')),
  'c2,r2,c1', 'second page continues after the cursor and carries replies of its roots');
RESET ROLE;

-- Raizes excluidas sem respostas nao ocupam vaga nem geram falso "ha mais"
DELETE FROM public.lesson_comments WHERE body IN ('r22', 'r2');
UPDATE public.lesson_comments SET deleted_at = now(), deleted_by = '22222222-2222-2222-2222-222222222222' WHERE body IN ('c22', 'c21');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000004')), 20::bigint, 'two hidden roots leave exactly 20 visible: a full page with no extra signal row');
RESET ROLE;

-- Limite de taxa: excluir nao contorna, respostas contam ------------------------------------------
INSERT INTO public.lesson_comments (lesson_id, user_id, body, created_at)
SELECT 'a1000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'burst' || i, now() - interval '5 seconds'
FROM generate_series(1, 10) AS i;
INSERT INTO ids SELECT 'burst1', id FROM public.lesson_comments WHERE body = 'burst1';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000005', 'nova') $$, 'P0001', 'rate_limited', 'baseline: 10 rows in the last minute = rate_limited');
SELECT lives_ok($$ SELECT app.delete_lesson_comment((SELECT id FROM ids WHERE name = 'burst1')) $$, 'the author deletes one of the burst comments');
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000005', 'nova de novo') $$, 'P0001', 'rate_limited', 'deleting does not free a rate-limit slot');
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000005', 'resposta', 'b0000000-0000-0000-0000-000000000004') $$, 'P0001', 'rate_limited', 'replies are rate limited too');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.lesson_comments WHERE user_id = '22222222-2222-2222-2222-222222222222' AND created_at > now() - interval '1 minute'), 10::bigint, 'soft-deleted rows stay in the rate-limit window');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT is((SELECT count(*) FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000005', 'staff reply', 'b0000000-0000-0000-0000-000000000004')), 1::bigint, 'staff is still exempt');
RESET ROLE;

-- Integridade -------------------------------------------------------------------------------------
SELECT throws_ok($$ INSERT INTO public.lesson_comments (lesson_id, user_id, body, parent_id) VALUES ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'x', '99999999-9999-9999-9999-999999999999') $$, '23503', NULL, 'parent_id must reference an existing comment');
DELETE FROM auth.users WHERE id = '44444444-4444-4444-4444-444444444444';
SELECT is((SELECT count(*) FROM public.lesson_comments WHERE body = 'resposta do Joao' AND deleted_by IS NULL AND deleted_at IS NOT NULL), 1::bigint, 'deleting the staff user keeps the soft-deleted row and nulls deleted_by');
INSERT INTO public.lesson_comments (id, lesson_id, user_id, body, parent_id) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'pai', NULL),
  ('d0000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'filho', 'd0000000-0000-0000-0000-000000000001');
DELETE FROM public.lesson_comments WHERE id = 'd0000000-0000-0000-0000-000000000001';
SELECT is((SELECT count(*) FROM public.lesson_comments WHERE id = 'd0000000-0000-0000-0000-000000000002'), 0::bigint, 'replies cascade with a hard-deleted parent');

SELECT * FROM finish();
ROLLBACK;
