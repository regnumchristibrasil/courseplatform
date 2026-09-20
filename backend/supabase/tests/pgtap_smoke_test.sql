-- Smoke test confirming pgTAP is enabled on the local Supabase stack.
-- Real RLS/policy suites (Track A15 in PROGRESS.md) replace/extend this
-- once schemas/tables exist; keep this file until then as the CI signal
-- that `supabase test db` is wired up correctly.
BEGIN;
SELECT plan(1);

SELECT ok(
  (SELECT extversion IS NOT NULL FROM pg_extension WHERE extname = 'pgtap'),
  'pgtap extension is installed and available'
);

SELECT * FROM finish();
ROLLBACK;
