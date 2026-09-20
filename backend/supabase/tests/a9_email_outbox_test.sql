-- A9 -- app_private.email_outbox: zero-policy default deny + dedup_key
-- uniqueness (the idempotency guarantee app.enqueue_email will rely on).
BEGIN;
SELECT plan(18);

SELECT has_table('app_private', 'email_outbox', 'app_private.email_outbox exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'app_private.email_outbox'::regclass),
  'RLS is enabled on app_private.email_outbox'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'app_private' AND tablename = 'email_outbox'),
  0,
  'app_private.email_outbox has zero RLS policies (default deny)'
);

INSERT INTO app_private.email_outbox (template, to_email, payload, dedup_key) VALUES
  ('welcome', 'user@example.com', '{}'::jsonb, 'welcome:11111111-1111-1111-1111-111111111111');

SELECT throws_ok(
  $$ INSERT INTO app_private.email_outbox (template, to_email, payload, dedup_key)
     VALUES ('welcome', 'user@example.com', '{}'::jsonb, 'welcome:11111111-1111-1111-1111-111111111111') $$,
  NULL, NULL,
  'a duplicate dedup_key is rejected -- this is app.enqueue_email''s idempotency guarantee'
);

-- anon: fully denied, all four operations.
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT count(*) FROM app_private.email_outbox $$,
  NULL, NULL,
  'anon SELECT on app_private.email_outbox is denied'
);
SELECT throws_ok(
  $$ INSERT INTO app_private.email_outbox (template, to_email, payload, dedup_key)
     VALUES ('welcome', 'anon-hacker@example.com', '{}'::jsonb, 'hijack:anon') $$,
  NULL, NULL,
  'anon INSERT on app_private.email_outbox is denied'
);
SELECT throws_ok(
  $$ UPDATE app_private.email_outbox SET status = 'sent' $$,
  NULL, NULL,
  'anon UPDATE on app_private.email_outbox is denied'
);
SELECT throws_ok(
  $$ DELETE FROM app_private.email_outbox $$,
  NULL, NULL,
  'anon DELETE on app_private.email_outbox is denied'
);
RESET ROLE;

INSERT INTO auth.users (id, email) VALUES ('11111111-1111-1111-1111-111111111111', 'user@example.com');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT throws_ok(
  $$ SELECT count(*) FROM app_private.email_outbox $$,
  NULL, NULL,
  'authenticated SELECT on app_private.email_outbox is denied (no client-readable send status)'
);
SELECT throws_ok(
  $$ INSERT INTO app_private.email_outbox (template, to_email, payload, dedup_key)
     VALUES ('welcome', 'hacker@example.com', '{}'::jsonb, 'hijack:1') $$,
  NULL, NULL,
  'authenticated INSERT on app_private.email_outbox is denied (no client-triggered spam vector)'
);
SELECT throws_ok(
  $$ UPDATE app_private.email_outbox SET status = 'sent' $$,
  NULL, NULL,
  'authenticated UPDATE on app_private.email_outbox is denied'
);
SELECT throws_ok(
  $$ DELETE FROM app_private.email_outbox $$,
  NULL, NULL,
  'authenticated DELETE on app_private.email_outbox is denied'
);
RESET ROLE;

-- service_role: unrestricted -- drains the queue (outbox-drain, Track B).
SET LOCAL ROLE service_role;
SELECT is(
  (SELECT count(*)::int FROM app_private.email_outbox),
  1,
  'service_role SELECT sees the queued email'
);
UPDATE app_private.email_outbox
  SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_attempted_at = now()
  WHERE dedup_key = 'welcome:11111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT status FROM app_private.email_outbox WHERE dedup_key = 'welcome:11111111-1111-1111-1111-111111111111'),
  'sent',
  'service_role can UPDATE email_outbox status/attempts (outbox-drain marking an email sent)'
);
INSERT INTO app_private.email_outbox (template, to_email, payload, dedup_key) VALUES
  ('purchase_confirmation', 'buyer@example.com', '{}'::jsonb, 'purchase_confirmation:probe');
SELECT is(
  (SELECT count(*)::int FROM app_private.email_outbox WHERE dedup_key = 'purchase_confirmation:probe'),
  1,
  'service_role can INSERT into email_outbox directly'
);
DELETE FROM app_private.email_outbox WHERE dedup_key = 'purchase_confirmation:probe';
SELECT is(
  (SELECT count(*)::int FROM app_private.email_outbox WHERE dedup_key = 'purchase_confirmation:probe'),
  0,
  'service_role can DELETE an email_outbox row'
);
RESET ROLE;

-- Data integrity.
SELECT throws_ok(
  $$ INSERT INTO app_private.email_outbox (template, to_email, payload, dedup_key, status)
     VALUES ('welcome', 'x@example.com', '{}'::jsonb, 'x:1', 'bogus') $$,
  NULL, NULL,
  'an unrecognized email_outbox.status value is rejected'
);
SELECT throws_ok(
  $$ INSERT INTO app_private.email_outbox (template, to_email, payload, dedup_key, attempts)
     VALUES ('welcome', 'x@example.com', '{}'::jsonb, 'x:2', -1) $$,
  NULL, NULL,
  'a negative attempts value is rejected'
);

SELECT * FROM finish();
ROLLBACK;
