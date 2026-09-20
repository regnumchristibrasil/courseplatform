-- A13: app.refund_order -- CDC art. 49 gives Brazilian consumers a 7-day
-- withdrawal right on digital purchases, so a 'refunded' webhook event
-- must automatically revoke the associated enrollment, no manual step.
--
-- Same CAS shape as app.confirm_payment (A10): only a currently-'paid'
-- order can transition to 'refunded' -- a duplicate refund webhook
-- delivery, or one arriving for an order that was never paid, affects zero
-- rows and comes back with did_transition = false.
--
-- orders.refunded_at is not in this repo's original "Data model" column
-- list for orders (only paid_at is), but the frozen RPC signature accepts
-- p_refunded_at -- added here, mirroring paid_at, so that parameter has
-- somewhere to actually land instead of being silently discarded.
alter table public.orders add column refunded_at timestamptz;

create function app.refund_order(p_order_id uuid, p_refunded_at timestamptz)
returns table (did_transition boolean, revoked_enrollment_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_order_user_id uuid;
  v_order_course_id uuid;
  v_enrollment_id uuid;
begin
  update public.orders as o
    set status = 'refunded',
        refunded_at = p_refunded_at
    where o.id = p_order_id
      and o.status = 'paid'
    returning o.user_id, o.course_id into v_order_user_id, v_order_course_id;

  if not found then
    -- Not paid (already refunded, still pending, expired, cancelled, or
    -- p_order_id does not exist): nothing to revoke, nothing to report.
    return query select false, null::uuid;
    return;
  end if;

  -- Revoke the currently-active enrollment for this (user, course), if any
  -- -- status flips to 'refunded', it is not deleted, and the partial
  -- unique index on enrollments (A6) then allows this user to re-enroll
  -- later without a constraint conflict.
  update public.enrollments as e
    set status = 'refunded'
    where e.user_id = v_order_user_id
      and e.course_id = v_order_course_id
      and e.status = 'active'
    returning e.id into v_enrollment_id;

  return query select true, v_enrollment_id;
end;
$$;

comment on function app.refund_order(uuid, timestamptz) is
  'CAS: orders.status ''paid'' -> ''refunded'', then revokes the matching active enrollment (status -> ''refunded'', not deleted). service_role only.';

revoke all on function app.refund_order(uuid, timestamptz) from public, anon, authenticated;
grant execute on function app.refund_order(uuid, timestamptz) to service_role;
