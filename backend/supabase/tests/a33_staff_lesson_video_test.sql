-- A33 -- staff_set_lesson_video + app_private.parse_video_ref (ticket #19).
BEGIN;
SELECT plan(39);

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'superadmin@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'tutor@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'student@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'inactivetutor@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'buyer@example.com');

UPDATE app_private.user_access SET role = 'superadmin' WHERE user_id = '11111111-1111-1111-1111-111111111111';
UPDATE app_private.user_access SET role = 'tutor' WHERE user_id IN ('33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555');
UPDATE app_private.user_access SET is_active = false WHERE user_id = '55555555-5555-5555-5555-555555555555';

-- D: rascunho. O: outro curso publicado. S: publicado com matricula.
INSERT INTO public.courses (id, title, price_cents, status) VALUES
  ('c0000000-0000-0000-0000-0000000000d1', 'Draft D', 10000, 'draft'),
  ('c0000000-0000-0000-0000-0000000000e1', 'Other O', 10000, 'published'),
  ('c0000000-0000-0000-0000-0000000000a1', 'Sales S', 10000, 'published');

INSERT INTO public.modules (id, course_id, title, position) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d1', 'D1', 1),
  ('a0000000-0000-0000-0000-0000000000e1', 'c0000000-0000-0000-0000-0000000000e1', 'O1', 1),
  ('a0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000a1', 'S1', 1);

-- updated_at explicito no passado: now() e congelado na transacao, entao so assim
-- o teste enxerga o bump feito pela RPC.
INSERT INTO public.lessons (id, course_id, module_id, title, position, archived_at, updated_at) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000001', 'L1', 1, NULL, '2026-01-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000001', 'L2', 2, NULL, '2026-01-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000001', 'L3', 3, '2026-02-01 00:00:00+00', '2026-01-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-0000000000e1', 'c0000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'OA1', 1, NULL, '2026-01-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-0000000000e2', 'c0000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'OA2', 2, '2026-02-01 00:00:00+00', '2026-01-01 00:00:00+00'),
  ('d0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000b1', 'SA1', 1, NULL, '2026-01-01 00:00:00+00');

-- OA1 usa Du9L1cAt3Xy; OA2 (arquivada) usa 9bZkp7q19f0 ativo e Xr1vUo8rC5k como historico.
INSERT INTO app_private.lesson_assets (lesson_id, provider, external_ref, is_active) VALUES
  ('d0000000-0000-0000-0000-0000000000e1', 'youtube', 'Du9L1cAt3Xy', true),
  ('d0000000-0000-0000-0000-0000000000e2', 'youtube', '9bZkp7q19f0', true),
  ('d0000000-0000-0000-0000-0000000000e2', 'youtube', 'Xr1vUo8rC5k', false),
  ('d0000000-0000-0000-0000-0000000000b1', 'youtube', 'sAlEsViDeO1', true);

INSERT INTO public.enrollments (user_id, course_id, status, expires_at) VALUES
  ('66666666-6666-6666-6666-666666666666', 'c0000000-0000-0000-0000-0000000000a1', 'active', now() + interval '30 days');

-- RLS e grants escondem lessons e lesson_assets do authenticated: leitura por views do dono.
CREATE TEMP VIEW _lv AS SELECT * FROM public.lessons;
GRANT SELECT ON _lv TO authenticated;
CREATE TEMP VIEW _av AS SELECT * FROM app_private.lesson_assets;
GRANT SELECT ON _av TO authenticated;

-- Shape -----------------------------------------------------------------
SELECT has_function('app_private', 'parse_video_ref', ARRAY['text'], 'parse_video_ref exists');
SELECT has_function('app', 'staff_set_lesson_video', ARRAY['uuid', 'timestamp with time zone', 'text'], 'staff_set_lesson_video exists');
SELECT ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE proname = 'staff_set_lesson_video'),
  'staff_set_lesson_video is SECURITY DEFINER with an empty search_path'
);
SELECT ok(NOT has_function_privilege('anon', 'app.staff_set_lesson_video(uuid, timestamp with time zone, text)', 'EXECUTE'), 'anon cannot set a video');
SELECT ok(has_function_privilege('authenticated', 'app.staff_set_lesson_video(uuid, timestamp with time zone, text)', 'EXECUTE'), 'authenticated can call it (role checked inside)');
SELECT ok(NOT has_function_privilege('authenticated', 'app_private.parse_video_ref(text)', 'EXECUTE'), 'authenticated cannot call parse_video_ref directly');

-- Parity with the shared contract (backend/contracts/videoRef.ts) ----------------
-- The literal below is checked against VIDEO_REF_CASES by videoRef.parity.test.ts.
CREATE TEMP TABLE _cases AS
SELECT c.ordinality AS n, c.value->>'input' AS input, c.value->'expected' AS expected
FROM jsonb_array_elements($video_ref_cases$[
 {
  "input": "dQw4w9WgXcQ",
  "expected": {
   "provider": "youtube",
   "externalRef": "dQw4w9WgXcQ"
  }
 },
 {
  "input": "  dQw4w9WgXcQ\n",
  "expected": {
   "provider": "youtube",
   "externalRef": "dQw4w9WgXcQ"
  }
 },
 {
  "input": "-_-_-_-_-_-",
  "expected": {
   "provider": "youtube",
   "externalRef": "-_-_-_-_-_-"
  }
 },
 {
  "input": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "expected": {
   "provider": "youtube",
   "externalRef": "dQw4w9WgXcQ"
  }
 },
 {
  "input": "http://youtube.com/watch?v=dQw4w9WgXcQ",
  "expected": {
   "provider": "youtube",
   "externalRef": "dQw4w9WgXcQ"
  }
 },
 {
  "input": "youtube.com/watch?v=dQw4w9WgXcQ",
  "expected": {
   "provider": "youtube",
   "externalRef": "dQw4w9WgXcQ"
  }
 },
 {
  "input": "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
  "expected": {
   "provider": "youtube",
   "externalRef": "dQw4w9WgXcQ"
  }
 },
 {
  "input": "https://www.youtube.com/embed/dQw4w9WgXcQ",
  "expected": {
   "provider": "youtube",
   "externalRef": "dQw4w9WgXcQ"
  }
 },
 {
  "input": "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0",
  "expected": {
   "provider": "youtube",
   "externalRef": "dQw4w9WgXcQ"
  }
 },
 {
  "input": "https://youtu.be/dQw4w9WgXcQ",
  "expected": {
   "provider": "youtube",
   "externalRef": "dQw4w9WgXcQ"
  }
 },
 {
  "input": "https://youtu.be/dQw4w9WgXcQ?si=abc123",
  "expected": {
   "provider": "youtube",
   "externalRef": "dQw4w9WgXcQ"
  }
 },
 {
  "input": "https://youtu.be/dQw4w9WgXcQ#t=10",
  "expected": {
   "provider": "youtube",
   "externalRef": "dQw4w9WgXcQ"
  }
 },
 {
  "input": "dQw4w9WgXc",
  "expected": null
 },
 {
  "input": "dQw4w9WgXcQQ",
  "expected": null
 },
 {
  "input": "dQw4w9WgXc!",
  "expected": null
 },
 {
  "input": "dQw4w9 WgXc",
  "expected": null
 },
 {
  "input": "https://www.youtube.com/watch?v=short",
  "expected": null
 },
 {
  "input": "https://www.youtube.com/watch?v=dQw4w9WgXcQx",
  "expected": null
 },
 {
  "input": "https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ",
  "expected": null
 },
 {
  "input": "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
  "expected": null
 },
 {
  "input": "https://example.com/watch?v=dQw4w9WgXcQ",
  "expected": null
 },
 {
  "input": "https://youtu.be/dQw4w9WgXcQ\nextra",
  "expected": null
 },
 {
  "input": "https://youtu.be/dQw4w9WgXcQ\rextra",
  "expected": null
 },
 {
  "input": "HTTPS://YOUTU.BE/dQw4w9WgXcQ",
  "expected": null
 },
 {
  "input": "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  "expected": {
   "provider": "panda",
   "externalRef": "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
  }
 },
 {
  "input": "0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D",
  "expected": {
   "provider": "panda",
   "externalRef": "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
  }
 },
 {
  "input": "\t0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d  ",
  "expected": {
   "provider": "panda",
   "externalRef": "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
  }
 },
 {
  "input": "https://player-vz-abc123.tv.pandavideo.com.br/embed/?v=0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  "expected": {
   "provider": "panda",
   "externalRef": "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
  }
 },
 {
  "input": "https://player-vz-abc123.tv.pandavideo.com.br/embed?v=0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  "expected": {
   "provider": "panda",
   "externalRef": "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
  }
 },
 {
  "input": "https://player-vz-abc123.tv.pandavideo.com.br/embed/?autoplay=1&v=0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  "expected": {
   "provider": "panda",
   "externalRef": "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
  }
 },
 {
  "input": "https://player-vz-abc123.tv.pandavideo.com.br/embed/?v=0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D",
  "expected": {
   "provider": "panda",
   "externalRef": "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
  }
 },
 {
  "input": "https://player-vz-abc123.tv.pandavideo.com.br/embed/?v=0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d&autoplay=1",
  "expected": {
   "provider": "panda",
   "externalRef": "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
  }
 },
 {
  "input": "https://player-vz-abc123.tv.pandavideo.com.br/embed/?v=0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d&v=9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f",
  "expected": {
   "provider": "panda",
   "externalRef": "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f"
  }
 },
 {
  "input": "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4",
  "expected": null
 },
 {
  "input": "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d0",
  "expected": null
 },
 {
  "input": "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4g",
  "expected": null
 },
 {
  "input": "0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d",
  "expected": null
 },
 {
  "input": "----------------------------------------",
  "expected": null
 },
 {
  "input": "------------------------------------",
  "expected": null
 },
 {
  "input": "https://player.pandavideo.com.br/embed/?v=not-a-uuid-not-a-uuid-not-a-uuid-1",
  "expected": null
 },
 {
  "input": "https://example.com/embed/?v=0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  "expected": null
 },
 {
  "input": "",
  "expected": null
 },
 {
  "input": "   \n\t",
  "expected": null
 }
]$video_ref_cases$::jsonb) WITH ORDINALITY AS c(value, ordinality);

SELECT cmp_ok((SELECT count(*) FROM _cases)::int, '>=', 30, 'shared case table is loaded');
SELECT is(
  (SELECT coalesce(jsonb_agg(c.input), '[]'::jsonb)
   FROM _cases c
   LEFT JOIN LATERAL app_private.parse_video_ref(c.input) p ON true
   WHERE c.expected IS DISTINCT FROM
     CASE WHEN p.provider IS NULL THEN 'null'::jsonb
          ELSE jsonb_build_object('provider', p.provider, 'externalRef', p.external_ref) END),
  '[]'::jsonb,
  'parse_video_ref agrees with the TS parser on every shared case'
);

-- Authorization ---------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT throws_ok($$ SELECT app.staff_set_lesson_video('d0000000-0000-0000-0000-000000000001', now(), 'Du9L1cAt3Xy') $$, '42501', 'forbidden', 'student cannot set a video');
SELECT throws_ok($$ SELECT app.staff_set_lesson_video('d0000000-0000-0000-0000-00000000ffff', now(), 'Du9L1cAt3Xy') $$, '42501', 'forbidden', 'student gets forbidden (not not_found) for an unknown lesson');
SET LOCAL "request.jwt.claim.sub" = '55555555-5555-5555-5555-555555555555';
SELECT throws_ok($$ SELECT app.staff_set_lesson_video('d0000000-0000-0000-0000-000000000001', now(), 'Du9L1cAt3Xy') $$, '42501', 'forbidden', 'inactive tutor cannot set a video');
SELECT throws_ok($$ SELECT * FROM app_private.lesson_assets $$, '42501', NULL, 'authenticated has no direct read on lesson_assets');

-- Validation (tutor) ------------------------------------------------------
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT throws_ok($$ SELECT app.staff_set_lesson_video('d0000000-0000-0000-0000-000000000001', '2026-01-01 00:00:00+00', 'not a video') $$, '22023', 'invalid_input', 'unrecognized format is invalid_input');
SELECT throws_ok($$ SELECT app.staff_set_lesson_video('d0000000-0000-0000-0000-000000000001', '2026-01-01 00:00:00+00', '   ') $$, '22023', 'invalid_input', 'blank input is invalid_input');
SELECT throws_ok($$ SELECT app.staff_set_lesson_video('d0000000-0000-0000-0000-000000000001', '2026-01-01 00:00:00+00', NULL) $$, '22023', 'invalid_input', 'null input is invalid_input');
SELECT throws_ok($$ SELECT app.staff_set_lesson_video(NULL, '2026-01-01 00:00:00+00', 'Du9L1cAt3Xy') $$, '22023', 'invalid_input', 'null lesson id is invalid_input');
SELECT throws_ok($$ SELECT app.staff_set_lesson_video('d0000000-0000-0000-0000-000000000001', NULL, 'Du9L1cAt3Xy') $$, '22023', 'invalid_input', 'null expected updated_at is invalid_input');
SELECT throws_ok($$ SELECT app.staff_set_lesson_video('d0000000-0000-0000-0000-00000000ffff', now(), 'Du9L1cAt3Xy') $$, 'P0002', 'not_found', 'unknown lesson is not_found');
SELECT throws_ok($$ SELECT app.staff_set_lesson_video('d0000000-0000-0000-0000-000000000001', '2025-12-31 00:00:00+00', 'Du9L1cAt3Xy') $$, 'CR001', 'stale_target', 'stale updated_at is stale_target');
SELECT is((SELECT count(*) FROM _av WHERE lesson_id = 'd0000000-0000-0000-0000-000000000001')::int, 0, 'rejected calls write nothing');

-- First video ---------------------------------------------------------------
SELECT is(
  app.staff_set_lesson_video('d0000000-0000-0000-0000-000000000001', '2026-01-01 00:00:00+00', ' https://youtu.be/9bZkp7q19f0?si=x '),
  '{"provider": "youtube", "external_ref": "9bZkp7q19f0", "duplicates": [{"course_title": "Other O", "lesson_title": "OA2"}]}'::jsonb,
  'sets the normalized video and warns about the lesson that already uses it (staff only)'
);
SELECT is(
  (SELECT provider || ':' || external_ref || ':' || is_active FROM _av WHERE lesson_id = 'd0000000-0000-0000-0000-000000000001'),
  'youtube:9bZkp7q19f0:true', 'the canonical reference is stored active'
);
SELECT isnt((SELECT updated_at FROM _lv WHERE id = 'd0000000-0000-0000-0000-000000000001'), '2026-01-01 00:00:00+00'::timestamptz, 'setting the video bumps the lesson updated_at');
SELECT throws_ok(
  $$ SELECT app.staff_set_lesson_video('d0000000-0000-0000-0000-000000000001', '2026-01-01 00:00:00+00', 'Du9L1cAt3Xy') $$,
  'CR001', 'stale_target', 'the token read before the change is now stale'
);

-- Replacement keeps history, never two active -------------------------------------
SELECT lives_ok(
  $$ SELECT app.staff_set_lesson_video('d0000000-0000-0000-0000-000000000001',
       (SELECT updated_at FROM _lv WHERE id = 'd0000000-0000-0000-0000-000000000001'), 'Zz9Yy8Xx7Ww') $$,
  'replaces the video'
);
SELECT is(
  (SELECT array_agg(external_ref || ':' || is_active ORDER BY created_at, external_ref)
   FROM _av WHERE lesson_id = 'd0000000-0000-0000-0000-000000000001'),
  ARRAY['9bZkp7q19f0:false', 'Zz9Yy8Xx7Ww:true'], 'the previous video stays as inactive history'
);
SELECT is((SELECT count(*) FROM _av WHERE lesson_id = 'd0000000-0000-0000-0000-000000000001' AND is_active)::int, 1, 'exactly one active video after replacement');

-- Provider switch (per-lesson migration) and idempotency --------------------------
SELECT is(
  (app.staff_set_lesson_video('d0000000-0000-0000-0000-000000000001',
     (SELECT updated_at FROM _lv WHERE id = 'd0000000-0000-0000-0000-000000000001'),
     'https://player-vz-abc123.tv.pandavideo.com.br/embed/?v=0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D')) - 'duplicates',
  '{"provider": "panda", "external_ref": "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"}'::jsonb,
  'switches provider with a lowercase Panda uuid'
);
SELECT is((SELECT count(*) FROM _av WHERE lesson_id = 'd0000000-0000-0000-0000-000000000001' AND is_active)::int, 1, 'still exactly one active video after the provider switch');
SELECT is((SELECT count(*) FROM _av WHERE lesson_id = 'd0000000-0000-0000-0000-000000000001')::int, 3, 'history now has three rows');
SELECT is(
  app.staff_set_lesson_video('d0000000-0000-0000-0000-000000000001',
    (SELECT updated_at FROM _lv WHERE id = 'd0000000-0000-0000-0000-000000000001'), '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'),
  '{"provider": "panda", "external_ref": "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", "duplicates": []}'::jsonb,
  'setting the same video again is a no-op that reports it'
);
SELECT is((SELECT count(*) FROM _av WHERE lesson_id = 'd0000000-0000-0000-0000-000000000001')::int, 3, 'the no-op writes no history row');

-- Duplicates --------------------------------------------------------------------
SELECT is(
  app.staff_set_lesson_video('d0000000-0000-0000-0000-000000000002', '2026-01-01 00:00:00+00', 'Du9L1cAt3Xy'),
  '{"provider": "youtube", "external_ref": "Du9L1cAt3Xy", "duplicates": [{"course_title": "Other O", "lesson_title": "OA1"}]}'::jsonb,
  'using a video of another course is allowed and names the other course and lesson'
);
SELECT is(
  (app.staff_set_lesson_video('d0000000-0000-0000-0000-000000000003', '2026-01-01 00:00:00+00', 'Xr1vUo8rC5k')) -> 'duplicates',
  '[]'::jsonb, 'inactive history of other lessons is not a duplicate; archived lesson can get a video'
);
SELECT is(
  (SELECT jsonb_array_length(app.staff_set_lesson_video('d0000000-0000-0000-0000-0000000000e1',
     (SELECT updated_at FROM _lv WHERE id = 'd0000000-0000-0000-0000-0000000000e1'), 'Du9L1cAt3Xy') -> 'duplicates')),
  1, 'the lesson itself is excluded from its own duplicates'
);

-- Published course / course with sales ----------------------------------------------
SELECT lives_ok(
  $$ SELECT app.staff_set_lesson_video('d0000000-0000-0000-0000-0000000000e1',
       (SELECT updated_at FROM _lv WHERE id = 'd0000000-0000-0000-0000-0000000000e1'), 'Qq1Ww2Ee3Rr') $$,
  'replacing the video of an active lesson in a published course is allowed'
);
SELECT lives_ok(
  $$ SELECT app.staff_set_lesson_video('d0000000-0000-0000-0000-0000000000b1',
       (SELECT updated_at FROM _lv WHERE id = 'd0000000-0000-0000-0000-0000000000b1'), 'Aa1Ss2Dd3Ff') $$,
  'a course with sales can have a video replaced'
);
SELECT is((SELECT count(*) FROM _av WHERE lesson_id = 'd0000000-0000-0000-0000-0000000000b1' AND is_active)::int, 1, 'sales lesson still has exactly one active video');

-- Reads ---------------------------------------------------------------------------
SELECT is(
  (SELECT l ->> 'external_ref' FROM jsonb_path_query(app.staff_get_course('c0000000-0000-0000-0000-0000000000d1'),
     '$.modules[*].lessons[*] ? (@.title == "L1").video') AS l),
  '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', 'staff_get_course shows the active video'
);

SELECT * FROM finish();
ROLLBACK;
