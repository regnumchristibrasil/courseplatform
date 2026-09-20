-- A8: app_private.payment_events -- webhook dedup + durable audit trail.
--
-- Unique on (provider, event_id) for best-effort dedup via
-- `INSERT ... ON CONFLICT (provider, event_id) DO NOTHING` -- not the sole
-- idempotency guarantee (Mercado Pago's request id isn't guaranteed stable
-- across retries), the real guarantee is app.confirm_payment's atomic CAS
-- (A10). This table is also the durable record of webhook failures:
-- PostHog capture alone isn't enough (Supabase's free tier keeps logs for
-- only 1 day).

create table app_private.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('mercadopago', 'efi')),
  event_id text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received' check (status in ('received', 'processed', 'failed')),
  unique (provider, event_id)
);

comment on table app_private.payment_events is
  'Webhook dedup (best-effort, not sole guarantee -- see app.confirm_payment) + durable audit trail for webhook processing failures. RLS enabled, zero policies: service_role only.';

alter table app_private.payment_events enable row level security;

grant select, insert, update, delete on app_private.payment_events to service_role;
