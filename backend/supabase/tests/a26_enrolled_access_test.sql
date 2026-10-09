-- A26 -- acesso do aluno matriculado sobrevive a despublicacao e arquivamento
-- (ticket #13, GLOSSARY "Acesso do aluno"). Matricula valida da acesso de
-- leitura a modulos e aulas (inclusive arquivados) de curso em rascunho ou
-- arquivado, e a reproducao; apos a expiracao, tudo some. O publico segue
-- vendo apenas itens ativos de cursos publicados.
BEGIN;
SELECT plan(29);

-- Fixtures --------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'enrolled@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'expired@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'other@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'inactive@example.com');

-- D = rascunho, R = arquivado, P = publicado.
INSERT INTO public.courses (id, title, price_cents, status) VALUES
  ('c0000000-0000-0000-0000-0000000000d1', 'Draft D', 10000, 'draft'),
  ('c0000000-0000-0000-0000-0000000000a1', 'Archived R', 10000, 'archived'),
  ('c0000000-0000-0000-0000-0000000000b1', 'Published P', 10000, 'published');

INSERT INTO public.modules (id, course_id, title, position, archived_at) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d1', 'D / M1', 1, NULL),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000d1', 'D / M2 archived', 2, now()),
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'R / M1', 1, NULL),
  ('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000a1', 'R / M2 archived', 2, now()),
  ('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000b1', 'P / M1', 1, NULL),
  ('b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000b1', 'P / M2 archived', 2, now());

INSERT INTO public.lessons (id, course_id, module_id, title, position, is_free_preview, archived_at) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-000000000001', 'D1 active', 1, false, NULL),
  ('d1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-000000000001', 'D1 archived', 2, false, now()),
  ('d1000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-000000000002', 'D2 in archived module', 1, false, NULL),
  ('d1000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-000000000001', 'D1 preview', 3, true, NULL),
  ('a1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'R1 active', 1, false, NULL),
  ('a1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'R1 archived', 2, false, now()),
  ('a1000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000002', 'R2 in archived module', 1, false, NULL),
  ('a1000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'R1 preview', 3, true, NULL),
  ('b1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'P1 active', 1, false, NULL),
  ('b1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'P1 archived', 2, false, now()),
  ('b1000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'P1 preview', 3, true, NULL),
  ('b1000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'P1 preview archived', 4, true, now());

INSERT INTO app_private.lesson_assets (lesson_id, provider, external_ref, is_active) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'youtube', 'yt-d-active', true),
  ('d1000000-0000-0000-0000-000000000002', 'youtube', 'yt-d-archived-lesson', true),
  ('d1000000-0000-0000-0000-000000000003', 'youtube', 'yt-d-archived-module', true),
  ('a1000000-0000-0000-0000-000000000002', 'youtube', 'yt-r-archived-lesson', true),
  ('d1000000-0000-0000-0000-000000000004', 'youtube', 'yt-d-preview', true),
  ('a1000000-0000-0000-0000-000000000004', 'youtube', 'yt-r-preview', true),
  ('b1000000-0000-0000-0000-000000000001', 'youtube', 'yt-p-active', true),
  ('b1000000-0000-0000-0000-000000000003', 'youtube', 'yt-p-preview', true),
  ('b1000000-0000-0000-0000-000000000004', 'youtube', 'yt-p-preview-archived', true);

INSERT INTO public.enrollments (user_id, course_id, status, granted_at, expires_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000d1', 'active', now(), now() + interval '30 days'),
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a1', 'active', now(), NULL),
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-0000000000d1', 'active', now() - interval '60 days', now() - interval '30 days'),
  ('44444444-4444-4444-4444-444444444444', 'c0000000-0000-0000-0000-0000000000d1', 'active', now(), NULL);
UPDATE app_private.user_access SET is_active = false
  WHERE user_id = '44444444-4444-4444-4444-444444444444';

-- Anonimo: nada de rascunho/arquivado; so itens ativos do publicado ------
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.modules WHERE course_id IN ('c0000000-0000-0000-0000-0000000000d1', 'c0000000-0000-0000-0000-0000000000a1')),
  0, 'anon sees no modules of draft or archived courses'
);
SELECT is(
  (SELECT count(*)::int FROM public.lessons WHERE course_id IN ('c0000000-0000-0000-0000-0000000000d1', 'c0000000-0000-0000-0000-0000000000a1')),
  0, 'anon sees no lessons of draft or archived courses'
);
SELECT is(
  (SELECT count(*)::int FROM public.modules WHERE course_id = 'c0000000-0000-0000-0000-0000000000b1'),
  1, 'anon sees only the non-archived module of the published course'
);
SELECT is(
  (SELECT count(*)::int FROM public.lessons WHERE course_id = 'c0000000-0000-0000-0000-0000000000b1'),
  2, 'anon sees only the non-archived lessons of the published course'
);
RESET ROLE;

-- Outro usuario (sem matricula): igual ao anonimo -------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT is(
  (SELECT count(*)::int FROM public.modules WHERE course_id IN ('c0000000-0000-0000-0000-0000000000d1', 'c0000000-0000-0000-0000-0000000000a1')),
  0, 'non-enrolled user sees no modules of draft or archived courses'
);
SELECT is(
  (SELECT count(*)::int FROM public.lessons WHERE course_id IN ('c0000000-0000-0000-0000-0000000000d1', 'c0000000-0000-0000-0000-0000000000a1')),
  0, 'non-enrolled user sees no lessons of draft or archived courses'
);
SELECT is(
  (SELECT count(*)::int FROM public.lessons WHERE course_id = 'c0000000-0000-0000-0000-0000000000b1'),
  2, 'non-enrolled user sees only non-archived lessons of the published course'
);
SELECT is(
  (SELECT count(*)::int FROM app.get_playable_ref('d1000000-0000-0000-0000-000000000001'::uuid)),
  0, 'non-enrolled user cannot play a lesson of a draft course'
);
-- Free preview inalterada: ativa toca, arquivada nao.
SELECT results_eq(
  $$ SELECT external_ref FROM app.get_playable_ref('b1000000-0000-0000-0000-000000000003'::uuid) $$,
  $$ VALUES ('yt-p-preview'::text) $$,
  'free preview of an active lesson still plays for a non-enrolled user'
);
SELECT is(
  (SELECT count(*)::int FROM app.get_playable_ref('b1000000-0000-0000-0000-000000000004'::uuid)),
  0, 'free preview of an archived lesson does not play for a non-enrolled user'
);
SELECT is(
  (SELECT count(*)::int FROM app.get_playable_ref('d1000000-0000-0000-0000-000000000004'::uuid)),
  0, 'free preview of a draft course does not play for a non-enrolled user'
);
SELECT is(
  (SELECT count(*)::int FROM app.get_playable_ref('a1000000-0000-0000-0000-000000000004'::uuid)),
  0, 'free preview of an archived course does not play for a non-enrolled user'
);
RESET ROLE;

-- Matriculado valido: ve e toca tudo, mesmo arquivado/despublicado --------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT count(*)::int FROM public.modules WHERE course_id IN ('c0000000-0000-0000-0000-0000000000d1', 'c0000000-0000-0000-0000-0000000000a1')),
  4, 'enrolled student reads all modules (archived included) of draft and archived courses'
);
SELECT is(
  (SELECT count(*)::int FROM public.lessons WHERE course_id IN ('c0000000-0000-0000-0000-0000000000d1', 'c0000000-0000-0000-0000-0000000000a1')),
  8, 'enrolled student reads all lessons (archived included) of draft and archived courses'
);
SELECT is(
  (SELECT count(*)::int FROM public.lessons WHERE course_id = 'c0000000-0000-0000-0000-0000000000b1'),
  2, 'enrollment in other courses does not widen reads of a course the student has not bought'
);
SELECT results_eq(
  $$ SELECT external_ref FROM app.get_playable_ref('d1000000-0000-0000-0000-000000000001'::uuid) $$,
  $$ VALUES ('yt-d-active'::text) $$,
  'enrolled student plays an active lesson of a draft course'
);
SELECT results_eq(
  $$ SELECT external_ref FROM app.get_playable_ref('d1000000-0000-0000-0000-000000000004'::uuid) $$,
  $$ VALUES ('yt-d-preview'::text) $$,
  'enrolled student still plays the free preview of a draft course'
);
SELECT results_eq(
  $$ SELECT external_ref FROM app.get_playable_ref('d1000000-0000-0000-0000-000000000002'::uuid) $$,
  $$ VALUES ('yt-d-archived-lesson'::text) $$,
  'enrolled student plays an archived lesson'
);
SELECT results_eq(
  $$ SELECT external_ref FROM app.get_playable_ref('d1000000-0000-0000-0000-000000000003'::uuid) $$,
  $$ VALUES ('yt-d-archived-module'::text) $$,
  'enrolled student plays a lesson of an archived module'
);
SELECT results_eq(
  $$ SELECT external_ref FROM app.get_playable_ref('a1000000-0000-0000-0000-000000000002'::uuid) $$,
  $$ VALUES ('yt-r-archived-lesson'::text) $$,
  'enrolled student plays an archived lesson of an archived course'
);
RESET ROLE;

-- Matricula expirada: tudo some (lista e reproducao) ----------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT is(
  (SELECT count(*)::int FROM public.modules WHERE course_id = 'c0000000-0000-0000-0000-0000000000d1'),
  0, 'expired student sees no modules'
);
SELECT is(
  (SELECT count(*)::int FROM public.lessons WHERE course_id = 'c0000000-0000-0000-0000-0000000000d1'),
  0, 'expired student sees no lessons'
);
SELECT is(
  (SELECT count(*)::int FROM app.get_playable_ref('d1000000-0000-0000-0000-000000000001'::uuid)),
  0, 'expired student cannot play'
);
RESET ROLE;

-- Usuario inativo: continua bloqueado -------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT is(
  (SELECT count(*)::int FROM public.modules WHERE course_id = 'c0000000-0000-0000-0000-0000000000d1'),
  0, 'inactive enrolled user sees no modules'
);
SELECT is(
  (SELECT count(*)::int FROM public.lessons WHERE course_id = 'c0000000-0000-0000-0000-0000000000d1'),
  0, 'inactive enrolled user sees no lessons'
);
SELECT is(
  (SELECT count(*)::int FROM app.get_playable_ref('d1000000-0000-0000-0000-000000000001'::uuid)),
  0, 'inactive enrolled user cannot play'
);
RESET ROLE;

-- A expiracao em si: o mesmo aluno perde o acesso quando a data passa ------
UPDATE public.enrollments SET expires_at = now() - interval '1 second'
  WHERE user_id = '11111111-1111-1111-1111-111111111111'
    AND course_id = 'c0000000-0000-0000-0000-0000000000d1';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT count(*)::int FROM public.lessons WHERE course_id = 'c0000000-0000-0000-0000-0000000000d1'),
  0, 'once the enrollment expires the student loses the lessons of that course'
);
SELECT is(
  (SELECT count(*)::int FROM app.get_playable_ref('d1000000-0000-0000-0000-000000000001'::uuid)),
  0, 'once the enrollment expires the student loses playback of that course'
);
SELECT is(
  (SELECT count(*)::int FROM public.lessons WHERE course_id = 'c0000000-0000-0000-0000-0000000000a1'),
  4, 'a still-valid enrollment in another course is unaffected'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
