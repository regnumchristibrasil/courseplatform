-- A10: app.confirm_payment (atomic CAS) + app.expire_stale_orders.
--
-- Bundled in one migration: both are order-lifecycle state transitions
-- (paid / expired) invoked by the same Track B reconciliation surface, and
-- the frozen RPC signature list groups them together; PROGRESS.md's Track A
-- checklist does not allocate expire_stale_orders its own A-number, so it
-- lands here rather than being deferred to an unrelated migration.
--
-- confirm_payment is the actual webhook idempotency boundary (webhook
-- signature verification and app_private.payment_events dedup, both Track
-- B/A8, are defense in depth on top of this): a duplicate delivery for an
-- already-paid order affects zero rows in the UPDATE below, so
-- did_transition comes back false and no second enrollment/email is ever
-- created.

create function app.confirm_payment(p_order_id uuid, p_provider_charge_id text, p_paid_at timestamptz)
returns table (did_transition boolean, order_status text, enrollment_id uuid, user_id uuid, course_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
-- Technical: this function's RETURNS TABLE declares OUT parameters named
-- user_id/course_id, which are the same identifiers as public.orders' and
-- public.enrollments' actual columns. Without this pragma, every bare
-- reference to those columns anywhere in the body (INSERT target list,
-- ON CONFLICT target, RETURNING) is ambiguous between "the OUT parameter"
-- and "the table column"; this makes bare column references resolve to
-- the column, matching ordinary SQL behavior.
declare
  v_order_user_id uuid;
  v_order_course_id uuid;
  v_order_status text;
  v_access_duration_days integer;
  v_expires_at timestamptz;
  v_enrollment_id uuid;
begin
  -- Atomic compare-and-swap: only the caller that actually flips
  -- status <> 'paid' -> 'paid' gets did_transition = true. This is the ONE
  -- statement that must never be split into a SELECT-then-UPDATE -- doing
  -- so would reopen the exact race this function exists to close.
  update public.orders as o
    set status = 'paid',
        paid_at = p_paid_at,
        provider_charge_id = coalesce(p_provider_charge_id, o.provider_charge_id)
    where o.id = p_order_id
      and o.status <> 'paid'
    returning o.user_id, o.course_id, o.status into v_order_user_id, v_order_course_id, v_order_status;

  if found then
    select c.access_duration_days into v_access_duration_days
    from public.courses c
    where c.id = v_order_course_id;

    -- NULL access_duration_days = lifetime access; otherwise expires
    -- access_duration_days days after the payment actually settled
    -- (p_paid_at), not after the order was created.
    v_expires_at := case
      when v_access_duration_days is null then null
      else p_paid_at + make_interval(days => v_access_duration_days)
    end;

    insert into public.enrollments (user_id, course_id, status, granted_at, expires_at)
    values (v_order_user_id, v_order_course_id, 'active', p_paid_at, v_expires_at)
    on conflict (user_id, course_id) where status = 'active' do nothing
    returning id into v_enrollment_id;

    return query select true, v_order_status, v_enrollment_id, v_order_user_id, v_order_course_id;
    return;
  end if;

  -- No transition: either the order was already 'paid' (duplicate webhook
  -- delivery / reconciliation re-run) or p_order_id does not exist. Either
  -- way, did_transition = false is the caller's signal to NOT queue a
  -- second confirmation email -- return the current state for logging, not
  -- to trigger any further side effect.
  select o.status, o.user_id, o.course_id into v_order_status, v_order_user_id, v_order_course_id
  from public.orders o
  where o.id = p_order_id;

  return query select false, v_order_status, null::uuid, v_order_user_id, v_order_course_id;
end;
$$;

comment on function app.confirm_payment(uuid, text, timestamptz) is
  'Atomic CAS: orders.status <> ''paid'' -> ''paid'', then enrollment creation via ON CONFLICT DO NOTHING. did_transition=true is the only signal that should trigger a confirmation email. service_role only.';

revoke all on function app.confirm_payment(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function app.confirm_payment(uuid, text, timestamptz) to service_role;

-- Sweeps PIX charges that expired before the customer paid (orders.expires_at
-- is the gateway-issued charge expiry, e.g. PIX_CHARGE_TTL_SECONDS after
-- creation) -- distinct from the reconciliation cron's "pending > 3 min"
-- refetch window (Track B), which re-checks orders that are simply slow to
-- settle, not yet expired.
create function app.expire_stale_orders(p_limit int default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with stale as (
    select id
    from public.orders
    where status = 'pending'
      and expires_at is not null
      and expires_at <= now()
    order by created_at
    limit p_limit
    for update skip locked
  )
  update public.orders o
    set status = 'expired'
    from stale
    where o.id = stale.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function app.expire_stale_orders(int) is
  'Flips pending orders past their own gateway-issued expires_at to ''expired''. Batched (default 100) + SKIP LOCKED so this is safe to run concurrently with confirm_payment. service_role only.';

revoke all on function app.expire_stale_orders(int) from public, anon, authenticated;
grant execute on function app.expire_stale_orders(int) to service_role;
