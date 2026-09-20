-- A9: app_private.email_outbox -- durable queue for transactional emails
-- (welcome, purchase confirmation), drained by a scheduled Edge Function
-- (outbox-drain, Track B) so a transient Resend failure is retried, not
-- silently lost. app.enqueue_email (A12) is the only writer this queue is
-- meant to have; the table itself lands now so A10/A12/A17 have somewhere
-- to write to and read from.

create table app_private.email_outbox (
  id uuid primary key default gen_random_uuid(),
  template text not null,
  to_email text not null,
  payload jsonb not null default '{}'::jsonb,
  -- e.g. 'purchase_confirmation:<order_id>' -- lets app.enqueue_email (A12)
  -- be called more than once for the same logical event (webhook retry,
  -- reconciliation re-run) without ever queuing a second email.
  dedup_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'dead_lettered')),
  attempts integer not null default 0 check (attempts >= 0),
  last_attempted_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

comment on table app_private.email_outbox is
  'Durable email queue. dedup_key is UNIQUE (app.enqueue_email''s idempotency guarantee). RLS enabled, zero policies: service_role only.';
comment on column app_private.email_outbox.attempts is
  'Drained with 5 attempts + backoff before dead_lettered, per this repo''s NFR for outbox-drain (Track B).';

alter table app_private.email_outbox enable row level security;

grant select, insert, update, delete on app_private.email_outbox to service_role;
