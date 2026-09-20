-- A17: cron schedule (pg_cron + pg_net) for the reconciliation and
-- outbox-drain jobs described in this repo's NFR table (every 5 min,
-- batch-limited, so a webhook that never arrives or a Resend outage don't
-- leave a paying customer or a queued email stuck forever).
--
-- Track B's `payments-reconcile` and `outbox-drain` Edge Functions do not
-- exist yet at the time this migration lands (they are separate,
-- not-yet-built tasks) -- the jobs below are still safe to schedule now:
-- app_private.cron_http_post() below is a deliberate no-op (WARNING, not
-- an error) until an operator configures the two Vault secrets it reads,
-- so this migration does not block on Track B's completion and does not
-- fail `supabase db reset` in the meantime.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Secrets (base URL + X-Cron-Secret value) are read from Supabase Vault,
-- never hardcoded here -- this repo's NFRs forbid committing secrets, and
-- the URL itself differs per environment (dev/staging/prod). An operator
-- must run, once per environment, OUTSIDE version control (Studio SQL
-- editor or `supabase secrets`/psql against that environment):
--
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1', 'cron_edge_functions_base_url');
--   select vault.create_secret('<the same value as the CRON_SECRET Edge Function secret>', 'cron_secret');
--
-- Until both exist, every scheduled HTTP-calling job below is a no-op.
create function app_private.cron_http_post(p_edge_function_path text, p_body jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_url text;
  v_cron_secret text;
begin
  select decrypted_secret into v_base_url
  from vault.decrypted_secrets
  where name = 'cron_edge_functions_base_url';

  select decrypted_secret into v_cron_secret
  from vault.decrypted_secrets
  where name = 'cron_secret';

  if v_base_url is null or v_cron_secret is null then
    raise warning 'app_private.cron_http_post: skipping % -- cron_edge_functions_base_url and/or cron_secret not configured in Vault yet', p_edge_function_path;
    return;
  end if;

  perform net.http_post(
    url := v_base_url || p_edge_function_path,
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Cron-Secret', v_cron_secret),
    body := p_body
  );
end;
$$;

comment on function app_private.cron_http_post(text, jsonb) is
  'Fire-and-forget POST to a Track B cron-triggered Edge Function, authenticated via X-Cron-Secret. No-op (WARNING, not an error) until the two required Vault secrets are configured. service_role/postgres only -- called exclusively by pg_cron jobs below.';

revoke all on function app_private.cron_http_post(text, jsonb) from public, anon, authenticated;
grant execute on function app_private.cron_http_post(text, jsonb) to service_role;

-- Reconciliation: re-checks orders stuck in 'pending' past a short window
-- by refetching charge status from the payment gateway -- PIX payments can
-- settle even when webhook delivery permanently fails, and without this a
-- paying user has no automated recovery path (see Track B's
-- payments-reconcile, not yet built at the time this migration lands).
select cron.schedule(
  'payments-reconcile-every-5-min',
  '*/5 * * * *',
  $$select app_private.cron_http_post('/payments-reconcile');$$
);

-- Outbox drain: retries transactional emails (welcome, purchase
-- confirmation) that failed to send, up to 5 attempts with backoff before
-- dead-lettering, so a transient Resend failure does not silently drop an
-- email (see Track B's outbox-drain, not yet built at the time this
-- migration lands).
select cron.schedule(
  'outbox-drain-every-5-min',
  '*/5 * * * *',
  $$select app_private.cron_http_post('/outbox-drain');$$
);

-- Order expiry: purely a DB-side sweep (A10's app.expire_stale_orders --
-- flips orders past their own gateway-issued expires_at to 'expired'), no
-- external HTTP call needed, so this one runs directly against the RPC
-- rather than through an Edge Function/Vault secret -- one less moving
-- part to configure, and it works from the moment this migration lands.
select cron.schedule(
  'expire-stale-orders-every-5-min',
  '*/5 * * * *',
  $$select app.expire_stale_orders(100);$$
);
