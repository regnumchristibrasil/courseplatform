-- A8 -- app_private.payment_events: zero-policy default deny + the
-- (provider, event_id) dedup constraint.
BEGIN;
SELECT plan(18);

SELECT has_table('app_private', 'payment_events', 'app_private.payment_events exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'app_private.payment_events'::regclass),
  'RLS is enabled on app_private.payment_events'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'app_private' AND tablename = 'payment_events'),
  0,
  'app_private.payment_events has zero RLS policies (default deny)'
);

-- Dedup: ON CONFLICT (provider, event_id) DO NOTHING is a no-op on retry.
INSERT INTO app_private.payment_events (provider, event_id, payload) VALUES
  ('mercadopago', 'evt-123', '{"type": "payment"}'::jsonb);
INSERT INTO app_private.payment_events (provider, event_id, payload)
  VALUES ('mercadopago', 'evt-123', '{"type": "payment", "retry": true}'::jsonb)
  ON CONFLICT (provider, event_id) DO NOTHING;
SELECT is(
  (SELECT count(*)::int FROM app_private.payment_events WHERE provider = 'mercadopago' AND event_id = 'evt-123'),
  1,
  'a duplicate (provider, event_id) webhook delivery is a no-op via ON CONFLICT DO NOTHING'
);
SELECT throws_ok(
  $$ INSERT INTO app_private.payment_events (provider, event_id, payload) VALUES ('mercadopago', 'evt-123', '{}'::jsonb) $$,
  NULL, NULL,
  'a duplicate (provider, event_id) without ON CONFLICT raises a unique violation'
);

-- Different provider, same event_id: not a conflict (dedup key is the pair).
INSERT INTO app_private.payment_events (provider, event_id, payload) VALUES
  ('efi', 'evt-123', '{}'::jsonb);
SELECT is(
  (SELECT count(*)::int FROM app_private.payment_events WHERE event_id = 'evt-123'),
  2,
  'the same event_id from two different providers is not a dedup conflict'
);

-- anon: fully denied, all four operations.
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT count(*) FROM app_private.payment_events $$,
  NULL, NULL,
  'anon SELECT on app_private.payment_events is denied'
);
SELECT throws_ok(
  $$ INSERT INTO app_private.payment_events (provider, event_id, payload) VALUES ('mercadopago', 'evt-hijack-anon', '{}'::jsonb) $$,
  NULL, NULL,
  'anon INSERT on app_private.payment_events is denied'
);
SELECT throws_ok(
  $$ UPDATE app_private.payment_events SET status = 'processed' $$,
  NULL, NULL,
  'anon UPDATE on app_private.payment_events is denied'
);
SELECT throws_ok(
  $$ DELETE FROM app_private.payment_events $$,
  NULL, NULL,
  'anon DELETE on app_private.payment_events is denied'
);
RESET ROLE;

INSERT INTO auth.users (id, email) VALUES ('11111111-1111-1111-1111-111111111111', 'user@example.com');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT throws_ok(
  $$ SELECT count(*) FROM app_private.payment_events $$,
  NULL, NULL,
  'authenticated SELECT on app_private.payment_events is denied'
);
SELECT throws_ok(
  $$ INSERT INTO app_private.payment_events (provider, event_id, payload) VALUES ('mercadopago', 'evt-hijack', '{}'::jsonb) $$,
  NULL, NULL,
  'authenticated INSERT on app_private.payment_events is denied'
);
SELECT throws_ok(
  $$ UPDATE app_private.payment_events SET status = 'processed' $$,
  NULL, NULL,
  'authenticated UPDATE on app_private.payment_events is denied'
);
SELECT throws_ok(
  $$ DELETE FROM app_private.payment_events $$,
  NULL, NULL,
  'authenticated DELETE on app_private.payment_events is denied'
);
RESET ROLE;

-- service_role: unrestricted.
SET LOCAL ROLE service_role;
SELECT is(
  (SELECT count(*)::int FROM app_private.payment_events),
  2,
  'service_role SELECT sees every payment_events row'
);
UPDATE app_private.payment_events SET status = 'processed', processed_at = now() WHERE provider = 'mercadopago' AND event_id = 'evt-123';
SELECT is(
  (SELECT status FROM app_private.payment_events WHERE provider = 'mercadopago' AND event_id = 'evt-123'),
  'processed',
  'service_role can UPDATE payment_events status'
);
DELETE FROM app_private.payment_events WHERE provider = 'efi' AND event_id = 'evt-123';
SELECT is(
  (SELECT count(*)::int FROM app_private.payment_events WHERE provider = 'efi' AND event_id = 'evt-123'),
  0,
  'service_role can DELETE a payment_events row'
);
RESET ROLE;

SELECT throws_ok(
  $$ INSERT INTO app_private.payment_events (provider, event_id, payload) VALUES ('stripe', 'evt-x', '{}'::jsonb) $$,
  NULL, NULL,
  'an unrecognized provider value is rejected'
);

SELECT * FROM finish();
ROLLBACK;
