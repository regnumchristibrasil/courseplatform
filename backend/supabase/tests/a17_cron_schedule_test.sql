-- A17 -- cron schedule (pg_cron + pg_net): the three scheduled jobs exist
-- with the right cadence, and app_private.cron_http_post is a genuine
-- no-op (not an error) until its two Vault secrets are configured, then
-- actually enqueues an HTTP call once they are.
BEGIN;
SELECT plan(14);

SELECT ok(
  (SELECT count(*)::int FROM pg_extension WHERE extname = 'pg_cron') = 1,
  'pg_cron extension is installed'
);
SELECT ok(
  (SELECT count(*)::int FROM pg_extension WHERE extname = 'pg_net') = 1,
  'pg_net extension is installed'
);

-- All three jobs exist, active, on the NFR's "every 5 min" cadence.
SELECT is(
  (SELECT count(*)::int FROM cron.job WHERE jobname = 'payments-reconcile-every-5-min' AND schedule = '*/5 * * * *' AND active),
  1,
  'payments-reconcile-every-5-min is scheduled, active, every 5 minutes'
);
SELECT is(
  (SELECT count(*)::int FROM cron.job WHERE jobname = 'outbox-drain-every-5-min' AND schedule = '*/5 * * * *' AND active),
  1,
  'outbox-drain-every-5-min is scheduled, active, every 5 minutes'
);
SELECT is(
  (SELECT count(*)::int FROM cron.job WHERE jobname = 'expire-stale-orders-every-5-min' AND schedule = '*/5 * * * *' AND active),
  1,
  'expire-stale-orders-every-5-min is scheduled, active, every 5 minutes'
);
SELECT is(
  (SELECT command FROM cron.job WHERE jobname = 'expire-stale-orders-every-5-min'),
  'select app.expire_stale_orders(100);',
  'expire-stale-orders calls the RPC directly (no HTTP/Vault dependency, no Edge Function needed)'
);
SELECT is(
  (SELECT command FROM cron.job WHERE jobname = 'payments-reconcile-every-5-min'),
  'select app_private.cron_http_post(''/payments-reconcile'');',
  'payments-reconcile calls the cron_http_post helper with the documented path'
);
SELECT is(
  (SELECT command FROM cron.job WHERE jobname = 'outbox-drain-every-5-min'),
  'select app_private.cron_http_post(''/outbox-drain'');',
  'outbox-drain calls the cron_http_post helper with the documented path'
);

-- cron_http_post is a no-op (does not raise an error) before Vault secrets
-- are configured -- this is what lets A17 land before Track B's Edge
-- Functions exist without breaking `supabase db reset`.
SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$ SELECT app_private.cron_http_post('/payments-reconcile') $$,
  'cron_http_post does not raise when Vault secrets are unconfigured'
);
SELECT is(
  (SELECT count(*)::int FROM net.http_request_queue),
  0,
  'cron_http_post enqueues NO HTTP request when Vault secrets are unconfigured'
);
RESET ROLE;

-- Once both Vault secrets exist, cron_http_post actually enqueues the
-- expected HTTP call (base_url || path, X-Cron-Secret header).
SELECT vault.create_secret('http://127.0.0.1:54321/functions/v1', 'cron_edge_functions_base_url');
SELECT vault.create_secret('test-cron-secret', 'cron_secret');

SET LOCAL ROLE service_role;
SELECT app_private.cron_http_post('/payments-reconcile', '{"limit": 50}'::jsonb);
SELECT is(
  (SELECT url FROM net.http_request_queue ORDER BY id DESC LIMIT 1),
  'http://127.0.0.1:54321/functions/v1/payments-reconcile',
  'cron_http_post enqueues a request to base_url || path once Vault secrets are configured'
);
SELECT is(
  (SELECT headers ->> 'X-Cron-Secret' FROM net.http_request_queue ORDER BY id DESC LIMIT 1),
  'test-cron-secret',
  'the enqueued request carries the X-Cron-Secret header from Vault'
);
RESET ROLE;

-- Grant surface: service_role only (postgres, the function owner, also has
-- implicit access, which is how the three cron.schedule() calls above --
-- run as postgres -- are able to invoke it without an extra grant).
SELECT ok(
  has_function_privilege('service_role', 'app_private.cron_http_post(text, jsonb)', 'EXECUTE'),
  'service_role has EXECUTE on cron_http_post'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'app_private.cron_http_post(text, jsonb)', 'EXECUTE'),
  'authenticated has NO EXECUTE on cron_http_post'
);

SELECT * FROM finish();
ROLLBACK;
