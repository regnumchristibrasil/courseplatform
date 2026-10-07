-- Local development seed data. Runs as the migration-runner role (owner
-- bypass), so RLS does not need to be worked around here -- this file is
-- not a substitute for the pgTAP fixtures in supabase/tests/, it only
-- gives `supabase start` a non-empty catalog to click through in Studio or
-- point the frontend dev server at.
--
-- Fixed UUIDs (not gen_random_uuid()) so this file is deterministic across
-- resets and easy to reference by hand while developing locally.

insert into public.courses (id, title, description, price_cents, status, access_duration_days) values
  (
    'd0000000-0000-0000-0000-000000000001',
    'Introdução ao Discernimento Vocacional',
    'Um curso introdutório sobre discernimento vocacional para jovens.',
    9900,
    'published',
    null
  ),
  (
    'd0000000-0000-0000-0000-000000000002',
    'Formação em Liderança Cristã',
    'Curso de formação em liderança para catequistas e coordenadores.',
    14900,
    'published',
    365
  ),
  (
    'd0000000-0000-0000-0000-000000000003',
    'Curso em Preparação (Rascunho)',
    'Curso ainda não publicado -- usado para validar que status = draft fica oculto do catálogo público.',
    5000,
    'draft',
    null
  );

insert into public.lessons (id, course_id, title, position, duration_seconds, is_free_preview) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Boas-vindas e visão geral', 1, 300, true),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'O que é discernimento?', 2, 900, false),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001', 'Exercícios práticos', 3, 1200, false),
  ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000002', 'Fundamentos da liderança', 1, 600, true),
  ('e0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000002', 'Liderança a serviço', 2, 900, false);

-- YouTube-phase video references (placeholder ids -- not real videos).
-- All active; none pre-seeded as inactive/backfilled since no migration to
-- Panda is in progress in local dev.
insert into app_private.lesson_assets (lesson_id, provider, external_ref, is_active) values
  ('e0000000-0000-0000-0000-000000000001', 'youtube', 'dQw4w9WgXcQ', true),
  ('e0000000-0000-0000-0000-000000000002', 'youtube', 'dQw4w9WgXcQ', true),
  ('e0000000-0000-0000-0000-000000000003', 'youtube', 'dQw4w9WgXcQ', true),
  ('e0000000-0000-0000-0000-000000000004', 'youtube', 'dQw4w9WgXcQ', true),
  ('e0000000-0000-0000-0000-000000000005', 'youtube', 'dQw4w9WgXcQ', true);

-- Usuarios de teste ficam em seed.dev.sql (somente dev local, fora de
-- [db.seed]). O runbook do primeiro superadmin (ambiente real) fica em
-- runbooks/bootstrap_superadmin.sql.
