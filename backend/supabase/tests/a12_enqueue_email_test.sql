-- A12 -- app.enqueue_email (idempotent per dedup_key) + the welcome-email
-- trigger (fires on email_confirmed_at NULL -> NOT NULL, never on signup).
BEGIN;
SELECT plan(14);

-- app.enqueue_email: fresh insert.
SET LOCAL ROLE service_role;
SELECT ok(
  app.enqueue_email('welcome', 'a@example.com', '{"user_id": "x"}'::jsonb, 'dedup-key-1') IS NOT NULL,
  'app.enqueue_email returns a non-null uuid'
);
SELECT is(
  (SELECT template FROM app_private.email_outbox WHERE dedup_key = 'dedup-key-1'),
  'welcome',
  'the queued row has the expected template'
);
SELECT is(
  (SELECT to_email FROM app_private.email_outbox WHERE dedup_key = 'dedup-key-1'),
  'a@example.com',
  'the queued row has the expected to_email'
);

-- Idempotency: same dedup_key, second call returns the SAME id and does
-- not create a second row.
SELECT is(
  (SELECT app.enqueue_email('welcome', 'a@example.com', '{}'::jsonb, 'dedup-key-1')),
  (SELECT id FROM app_private.email_outbox WHERE dedup_key = 'dedup-key-1'),
  'a duplicate app.enqueue_email call returns the id of the already-queued row'
);
SELECT is(
  (SELECT count(*)::int FROM app_private.email_outbox WHERE dedup_key = 'dedup-key-1'),
  1,
  'a duplicate app.enqueue_email call does not create a second row'
);
RESET ROLE;

-- Grant surface: service_role only.
SELECT ok(
  has_function_privilege('service_role', 'app.enqueue_email(text, text, jsonb, text)', 'EXECUTE'),
  'service_role has EXECUTE on app.enqueue_email'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'app.enqueue_email(text, text, jsonb, text)', 'EXECUTE'),
  'authenticated has NO EXECUTE on app.enqueue_email (no client-triggered spam vector)'
);
SELECT ok(
  NOT has_function_privilege('anon', 'app.enqueue_email(text, text, jsonb, text)', 'EXECUTE'),
  'anon has NO EXECUTE on app.enqueue_email'
);

-- Welcome trigger: fires on the email_confirmed_at NULL -> NOT NULL
-- transition, exactly once.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'newuser@example.com', NULL);
SELECT is(
  (SELECT count(*)::int FROM app_private.email_outbox WHERE dedup_key = 'welcome:11111111-1111-1111-1111-111111111111'),
  0,
  'signup alone (email_confirmed_at still NULL) does not queue a welcome email'
);

UPDATE auth.users SET email_confirmed_at = now() WHERE id = '11111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT count(*)::int FROM app_private.email_outbox WHERE dedup_key = 'welcome:11111111-1111-1111-1111-111111111111'),
  1,
  'confirming the email (NULL -> NOT NULL) queues exactly one welcome email'
);
SELECT is(
  (SELECT template FROM app_private.email_outbox WHERE dedup_key = 'welcome:11111111-1111-1111-1111-111111111111'),
  'welcome',
  'the queued welcome email has template = welcome'
);
SELECT is(
  (SELECT to_email FROM app_private.email_outbox WHERE dedup_key = 'welcome:11111111-1111-1111-1111-111111111111'),
  'newuser@example.com',
  'the queued welcome email is addressed to the confirmed user'
);

-- A later, unrelated UPDATE (email_confirmed_at already NOT NULL) does not
-- queue a second welcome email.
UPDATE auth.users SET last_sign_in_at = now() WHERE id = '11111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT count(*)::int FROM app_private.email_outbox WHERE dedup_key = 'welcome:11111111-1111-1111-1111-111111111111'),
  1,
  'a later, unrelated update does not queue a second welcome email'
);

-- Signup with email_confirmed_at already set at INSERT time (e.g. an
-- admin-created or magic-link user) does not fire the trigger either --
-- it is AFTER UPDATE only, deliberately not AFTER INSERT.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('22222222-2222-2222-2222-222222222222', 'preconfirmed@example.com', now());
SELECT is(
  (SELECT count(*)::int FROM app_private.email_outbox WHERE dedup_key = 'welcome:22222222-2222-2222-2222-222222222222'),
  0,
  'a user inserted with email_confirmed_at already set does not queue a welcome email (trigger is AFTER UPDATE only)'
);

SELECT * FROM finish();
ROLLBACK;
