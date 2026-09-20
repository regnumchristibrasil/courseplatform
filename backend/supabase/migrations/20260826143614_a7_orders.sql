-- A7: orders.
--
-- amount_cents is NEVER settable by the client -- there is no client
-- INSERT/UPDATE grant on this table at all, matching enrollments. The
-- checkout Edge Function (Track B) reads courses.price_cents server-side
-- at charge creation; accepting amount_cents from a request body would be
-- price tampering. status must include 'refunded': PIX refunds exist, and
-- CDC art. 49 gives Brazilian consumers a 7-day withdrawal right on
-- digital purchases.

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete restrict,
  amount_cents integer not null check (amount_cents >= 0),
  currency char(3) not null default 'BRL',
  provider text not null check (provider in ('mercadopago', 'efi')),
  provider_charge_id text,
  provider_txid text,
  external_reference text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'cancelled', 'refunded')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

comment on column public.orders.amount_cents is
  'Read server-side from courses.price_cents at charge creation -- never accepted from a client request. No client INSERT/UPDATE grant exists on this table, so this cannot be bypassed at the RLS layer either.';
comment on column public.orders.provider is
  'Set per-order, not read from a global config, so historical orders stay attributable after a future gateway swap (Mercado Pago -> Efi).';

-- provider_charge_id is assigned once the gateway creates the charge (NULL
-- until then); once assigned it must map to exactly one order, so this
-- doubles as a defense against double-crediting a charge to two orders.
create unique index orders_provider_charge_id_key
  on public.orders (provider_charge_id)
  where provider_charge_id is not null;

alter table public.orders enable row level security;

-- RLS: SELECT restricted to the owning user; no client writes at all, ever
-- -- see app.confirm_payment (A10) / app.refund_order (A13) /
-- app.expire_stale_orders (A10), all SECURITY DEFINER, all service_role-only.
create policy orders_select_own
  on public.orders
  for select
  to authenticated
  using (user_id = (select auth.uid()));

grant select on public.orders to authenticated;
grant select, insert, update, delete on public.orders to service_role;
