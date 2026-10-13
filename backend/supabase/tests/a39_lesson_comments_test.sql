-- A39 -- public.lesson_comments, app.list_lesson_comments e
-- app.create_lesson_comment (ticket #27; ADR 0004).
-- Participam apenas aluno com matricula valida (aula e modulo ativos) e equipe.
-- Escrita sem direito = erro 'forbidden'; leitura sem direito = zero linhas.
-- Limite: 2.000 caracteres e ~10 criacoes/min por usuario (equipe isenta).
BEGIN;
SELECT plan(64);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'maria@example.com', '{"full_name": "  Maria Souza Lima"}'),
  ('22222222-2222-2222-2222-222222222222', 'joao@example.com', '{"full_name": "Joao Pedro"}'),
  ('33333333-3333-3333-3333-333333333333', 'inactive@example.com', '{"full_name": "Inativo Silva"}'),
  ('44444444-4444-4444-4444-444444444444', 'tutor@example.com', '{"full_name": "Tutor Chefe"}'),
  ('55555555-5555-5555-5555-555555555555', 'preview@example.com', '{"full_name": "Preview Only"}'),
  ('66666666-6666-6666-6666-666666666666', 'expired@example.com', '{"full_name": "Expirado Souza"}'),
  ('77777777-7777-7777-7777-777777777777', 'refunded@example.com', '{"full_name": "Reembolsado Souza"}'),
  ('88888888-8888-8888-8888-888888888888', 'noname@example.com', NULL),
  ('99999999-0000-0000-0000-000000000001', 'tab@example.com', '{"full_name": "Ana\tBeatriz Costa"}'),
  ('99999999-0000-0000-0000-000000000002', 'at@example.com', '{"full_name": "joao@x.com Silva"}');
UPDATE app_private.user_access SET role = 'tutor' WHERE user_id = '44444444-4444-4444-4444-444444444444';
UPDATE app_private.user_access SET is_active = false WHERE user_id = '33333333-3333-3333-3333-333333333333';

INSERT INTO public.courses (id, title, price_cents, status) VALUES
  ('c0000000-0000-0000-0000-0000000000a1', 'Course A', 10000, 'published'),
  ('c0000000-0000-0000-0000-0000000000f1', 'Preview only F', 10000, 'published');
INSERT INTO public.modules (id, course_id, title, position, archived_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'A / M1', 1, NULL),
  ('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000a1', 'A / M2 archived', 2, now()),
  ('f5000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000f1', 'F / M1', 1, NULL);
INSERT INTO public.lessons (id, course_id, module_id, title, position, is_free_preview, archived_at) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A1', 1, false, NULL),
  ('a1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A2 archived', 2, false, now()),
  ('a1000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000002', 'A3 in archived module', 1, false, NULL),
  ('a1000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A4', 3, false, NULL),
  ('f1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000f1', 'f5000000-0000-0000-0000-000000000001', 'F1', 1, true, NULL);
INSERT INTO public.enrollments (user_id, course_id, status, granted_at, expires_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a1', 'active', now() - interval '5 days', now() + interval '30 days'),
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-0000000000a1', 'active', now() - interval '5 days', NULL),
  ('33333333-3333-3333-3333-333333333333', 'c0000000-0000-0000-0000-0000000000a1', 'active', now(), NULL),
  ('66666666-6666-6666-6666-666666666666', 'c0000000-0000-0000-0000-0000000000a1', 'active', now() - interval '60 days', now() - interval '1 day'),
  ('77777777-7777-7777-7777-777777777777', 'c0000000-0000-0000-0000-0000000000a1', 'refunded', now() - interval '10 days', NULL),
  ('88888888-8888-8888-8888-888888888888', 'c0000000-0000-0000-0000-0000000000a1', 'active', now(), NULL),
  ('99999999-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'active', now(), NULL),
  ('99999999-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000a1', 'active', now(), NULL);

-- Shape ---------------------------------------------------------------
SELECT has_function('app', 'list_lesson_comments', ARRAY['uuid', 'timestamp with time zone', 'uuid'], 'app.list_lesson_comments exists');
SELECT has_function('app', 'create_lesson_comment', ARRAY['uuid', 'text', 'uuid'], 'app.create_lesson_comment exists');
SELECT ok((SELECT bool_and(prosecdef) FROM pg_proc WHERE proname IN ('list_lesson_comments', 'create_lesson_comment') AND pronamespace = 'app'::regnamespace), 'both RPCs are SECURITY DEFINER');
SELECT ok((SELECT bool_and(proconfig @> ARRAY['search_path=""']) FROM pg_proc WHERE proname IN ('list_lesson_comments', 'create_lesson_comment') AND pronamespace = 'app'::regnamespace), 'both RPCs pin search_path to empty');
SELECT ok(has_function_privilege('authenticated', 'app.create_lesson_comment(uuid, text, uuid)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'app.list_lesson_comments(uuid, timestamptz, uuid)', 'EXECUTE'), 'authenticated can EXECUTE both');
SELECT ok(NOT has_function_privilege('anon', 'app.create_lesson_comment(uuid, text, uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'app.list_lesson_comments(uuid, timestamptz, uuid)', 'EXECUTE'), 'anon cannot EXECUTE');
SELECT ok(NOT has_function_privilege('public', 'app.create_lesson_comment(uuid, text, uuid)', 'EXECUTE')
      AND NOT has_function_privilege('public', 'app.list_lesson_comments(uuid, timestamptz, uuid)', 'EXECUTE'), 'PUBLIC cannot EXECUTE');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lesson_comments'::regclass), 'lesson_comments has RLS enabled');
SELECT is((SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lesson_comments'), 0::bigint, 'lesson_comments has no policies');
SELECT ok(NOT has_table_privilege('authenticated', 'public.lesson_comments', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.lesson_comments', 'INSERT')
      AND NOT has_table_privilege('anon', 'public.lesson_comments', 'SELECT'), 'clients have no table grants');
SELECT is(
  (SELECT proargnames FROM pg_proc WHERE oid = 'app.list_lesson_comments(uuid, timestamptz, uuid)'::regprocedure)::text,
  '{p_lesson_id,p_cursor_created_at,p_cursor_id,id,parent_id,author_first_name,is_staff_author,body,created_at,is_own,is_deleted,can_delete}',
  'list projects no e-mail and no user id (replies/delete flags added in A40)'
);

-- Criar: aluno com matricula valida -----------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT results_eq(
  $$ SELECT author_first_name, is_staff_author, body, is_own FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', '  Otima aula!  ') $$,
  $$ VALUES ('Maria'::text, false, 'Otima aula!'::text, true) $$,
  'enrolled student creates: first name only, trimmed body, own, not staff'
);
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', '   ') $$, '22023', 'invalid_input', 'blank body is invalid_input');
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', E' \n\t\r\n ') $$, '22023', 'invalid_input', 'newline/tab-only body is invalid_input');
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', NULL) $$, '22023', 'invalid_input', 'null body is invalid_input');
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', repeat('x', 2001)) $$, '22023', 'invalid_input', '2001 characters is invalid_input');
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment(NULL, 'oi') $$, '22023', 'invalid_input', 'null lesson is invalid_input');
SELECT is((SELECT length(body) FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', repeat('y', 2000))), 2000, '2000 characters is accepted');
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000002', 'oi') $$, '42501', 'forbidden', 'archived lesson: forbidden');
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000003', 'oi') $$, '42501', 'forbidden', 'lesson in archived module: forbidden');
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('f1000000-0000-0000-0000-000000000001', 'oi') $$, '42501', 'forbidden', 'other course (not enrolled): forbidden');
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('99999999-9999-9999-9999-999999999999', 'oi') $$, '42501', 'forbidden', 'unknown lesson: forbidden (same as no entitlement)');

-- Criar: sem direito ----------------------------------------------------
SET LOCAL "request.jwt.claim.sub" = '66666666-6666-6666-6666-666666666666';
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'oi') $$, '42501', 'forbidden', 'expired enrollment: forbidden');
SET LOCAL "request.jwt.claim.sub" = '77777777-7777-7777-7777-777777777777';
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'oi') $$, '42501', 'forbidden', 'refunded enrollment: forbidden');
SET LOCAL "request.jwt.claim.sub" = '55555555-5555-5555-5555-555555555555';
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('f1000000-0000-0000-0000-000000000001', 'oi') $$, '42501', 'forbidden', 'free-preview only: forbidden');
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'oi') $$, '42501', 'forbidden', 'deactivated user: forbidden');
RESET "request.jwt.claim.sub";
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'oi') $$, '42501', 'unauthorized', 'no session: unauthorized');
RESET ROLE;

-- Criar: equipe ---------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT results_eq(
  $$ SELECT author_first_name, is_staff_author, is_own FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'Bem-vindos') $$,
  $$ VALUES ('Tutor'::text, true, true) $$,
  'staff creates in any course: Equipe flag set'
);
SELECT is((SELECT count(*) FROM app.create_lesson_comment('f1000000-0000-0000-0000-000000000001', 'Ola')), 1::bigint, 'staff comments on a course without enrolment');
RESET ROLE;

-- Nome do autor: fallback sem expor e-mail ------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '88888888-8888-8888-8888-888888888888';
SELECT is((SELECT author_first_name FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'sem nome')), 'Aluno', 'author without a name shows the generic label, never the e-mail');
SET LOCAL "request.jwt.claim.sub" = '99999999-0000-0000-0000-000000000001';
SELECT is((SELECT author_first_name FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'tab')), 'Ana', 'tab-separated name exposes only the first token');
SET LOCAL "request.jwt.claim.sub" = '99999999-0000-0000-0000-000000000002';
SELECT is((SELECT author_first_name FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'at')), 'Aluno', 'e-mail-shaped first token falls back to the generic label');
RESET ROLE;

-- Armazenamento -----------------------------------------------------------
SELECT is((SELECT count(*) FROM public.lesson_comments WHERE user_id = '11111111-1111-1111-1111-111111111111'), 2::bigint, 'only the two valid student comments were stored');
SELECT is((SELECT body FROM public.lesson_comments WHERE user_id = '11111111-1111-1111-1111-111111111111' AND length(body) < 100), 'Otima aula!', 'stored body is trimmed');

-- Listar: direito -----------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT is((SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001')), 6::bigint, 'enrolled student reads all comments of the lesson');
SELECT results_eq(
  $$ SELECT author_first_name, is_staff_author, is_own FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001') WHERE body = 'Bem-vindos' $$,
  $$ VALUES ('Tutor'::text, true, false) $$,
  'staff comment appears with first name and Equipe flag, not own'
);
SELECT is((SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001') WHERE is_own), 0::bigint, 'nothing is own for a viewer with no comments');
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001') WHERE is_own), 2::bigint, 'is_own marks exactly the caller''s comments');
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT is((SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001')), 6::bigint, 'staff reads comments');
SELECT is((SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000002')), 0::bigint, 'staff on an archived lesson: no comments here, no error');

-- Listar: sem direito = zero linhas ----------------------------------------------
SET LOCAL "request.jwt.claim.sub" = '66666666-6666-6666-6666-666666666666';
SELECT is((SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001')), 0::bigint, 'expired enrollment: zero rows');
SET LOCAL "request.jwt.claim.sub" = '77777777-7777-7777-7777-777777777777';
SELECT is((SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001')), 0::bigint, 'refunded: zero rows');
SET LOCAL "request.jwt.claim.sub" = '55555555-5555-5555-5555-555555555555';
SELECT is((SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001')), 0::bigint, 'no enrollment (preview only): zero rows');
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT is((SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001')), 0::bigint, 'deactivated user: zero rows');
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*) FROM app.list_lesson_comments('99999999-9999-9999-9999-999999999999')), 0::bigint, 'unknown lesson: zero rows');
SELECT is((SELECT count(*) FROM app.list_lesson_comments(NULL)), 0::bigint, 'null lesson: zero rows');
RESET "request.jwt.claim.sub";
SELECT is((SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001')), 0::bigint, 'no session: zero rows');
RESET ROLE;

-- O aluno nao le a tabela diretamente ---------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT throws_ok($$ SELECT * FROM public.lesson_comments $$, '42501', NULL, 'authenticated cannot read the table directly');
SELECT throws_ok($$ INSERT INTO public.lesson_comments (lesson_id, user_id, body) VALUES ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x') $$, '42501', NULL, 'authenticated cannot insert directly');
RESET ROLE;

-- Paginacao por cursor (created_at desc, id desc) ----------------------------
-- Aula A4: 25 comentarios, dois deles com o mesmo created_at (desempate por id).
INSERT INTO public.lesson_comments (id, lesson_id, user_id, body, created_at)
SELECT ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
       'a1000000-0000-0000-0000-000000000004',
       '22222222-2222-2222-2222-222222222222',
       'c' || i,
       timestamptz '2026-01-01T00:00:00Z' + (i / 2) * interval '1 second'
FROM generate_series(1, 25) AS i;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000004')), 21::bigint, 'first page returns 21 rows (20 + 1 to signal there is more)');
SELECT is(
  (SELECT array_agg(body ORDER BY ord) FROM (SELECT body, row_number() OVER () AS ord FROM (SELECT body FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000004') LIMIT 3) t) s)::text,
  '{c25,c24,c23}', 'newest first, ties broken by id descending'
);
SELECT results_eq(
  $$ SELECT count(*)::integer, min(body) IS NOT NULL FROM app.list_lesson_comments(
       'a1000000-0000-0000-0000-000000000004',
       '2026-01-01T00:00:03Z', '00000000-0000-0000-0000-000000000006') $$,
  $$ VALUES (5, true) $$,
  'cursor on the 20th row returns the remaining 5 (no overlap, nothing skipped)'
);
SELECT is(
  (SELECT string_agg(body, ',' ORDER BY created_at DESC, id DESC) FROM app.list_lesson_comments(
       'a1000000-0000-0000-0000-000000000004',
       '2026-01-01T00:00:03Z', '00000000-0000-0000-0000-000000000006')),
  'c5,c4,c3,c2,c1', 'second page continues exactly after the cursor'
);
SELECT throws_ok($$ SELECT * FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000004', NULL, '00000000-0000-0000-0000-000000000006') $$, '22023', 'invalid_input', 'half cursor (id without created_at) is invalid_input');
RESET ROLE;

-- Limite de taxa ------------------------------------------------------------
-- Joao (22...) ja tem 25 linhas antigas; so conta o ultimo minuto.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT is((SELECT count(*) FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'r1')), 1::bigint, 'old rows do not count towards the rate limit');
RESET ROLE;
INSERT INTO public.lesson_comments (lesson_id, user_id, body, created_at)
SELECT 'a1000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'burst' || i, now() - interval '10 seconds'
FROM generate_series(1, 8) AS i;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT is((SELECT count(*) FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'r10')), 1::bigint, 'the 10th comment in a minute is accepted');
SELECT throws_ok($$ SELECT * FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'r11') $$, 'P0001', 'rate_limited', 'the 11th comment in a minute is rate_limited');
SELECT is((SELECT count(*) FROM app.list_lesson_comments('a1000000-0000-0000-0000-000000000001') WHERE body = 'r11'), 0::bigint, 'the rate-limited comment was not stored');
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is((SELECT count(*) FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'other user')), 1::bigint, 'the limit is per user: another student is unaffected');
RESET ROLE;
-- Equipe com 12 criacoes no ultimo minuto continua isenta.
INSERT INTO public.lesson_comments (lesson_id, user_id, body, created_at)
SELECT 'a1000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'staff' || i, now()
FROM generate_series(1, 12) AS i;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT is((SELECT count(*) FROM app.create_lesson_comment('a1000000-0000-0000-0000-000000000001', 'staff is exempt')), 1::bigint, 'staff is exempt from the rate limit');
RESET ROLE;

-- Integridade -----------------------------------------------------------------
SELECT throws_ok($$ INSERT INTO public.lesson_comments (lesson_id, user_id, body) VALUES ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '') $$, '23514', NULL, 'table rejects an empty body');
SELECT throws_ok($$ INSERT INTO public.lesson_comments (lesson_id, user_id, body) VALUES ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', repeat('z', 2001)) $$, '23514', NULL, 'table rejects a body over 2000 characters');
DELETE FROM public.lessons WHERE id = 'a1000000-0000-0000-0000-000000000004';
SELECT is((SELECT count(*) FROM public.lesson_comments WHERE lesson_id = 'a1000000-0000-0000-0000-000000000004'), 0::bigint, 'comments cascade with the lesson');
DELETE FROM auth.users WHERE id = '88888888-8888-8888-8888-888888888888';
SELECT is((SELECT count(*) FROM public.lesson_comments WHERE user_id = '88888888-8888-8888-8888-888888888888'), 0::bigint, 'comments cascade with the user');

SELECT * FROM finish();
ROLLBACK;
