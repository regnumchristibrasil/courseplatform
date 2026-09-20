-- A12: app.enqueue_email + the welcome-email trigger.
--
-- Welcome email fires on the auth.users.email_confirmed_at NULL -> NOT NULL
-- transition, not on signup itself: an explicit client-callable "send
-- welcome email" endpoint would be a spam vector against the Resend daily
-- quota before the user is even verified. Routed through
-- app_private.email_outbox (A9) so a transient Resend send failure
-- (drained by outbox-drain, Track B) is retried, not lost.

create function app.enqueue_email(p_template text, p_to_email text, p_payload jsonb, p_dedup_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into app_private.email_outbox (template, to_email, payload, dedup_key)
  values (p_template, p_to_email, coalesce(p_payload, '{}'::jsonb), p_dedup_key)
  on conflict (dedup_key) do nothing
  returning id into v_id;

  -- A duplicate call with the same dedup_key (retried webhook, re-run
  -- reconciliation) is not an error and does not queue a second email --
  -- return the id of the row that already claimed this dedup_key, so
  -- callers always get a stable, non-null uuid back either way.
  if v_id is null then
    select eo.id into v_id
    from app_private.email_outbox eo
    where eo.dedup_key = p_dedup_key;
  end if;

  return v_id;
end;
$$;

comment on function app.enqueue_email(text, text, jsonb, text) is
  'Idempotent (per p_dedup_key) insert into app_private.email_outbox. service_role only -- there is no legitimate reason for an authenticated client to queue an arbitrary email.';

revoke all on function app.enqueue_email(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function app.enqueue_email(text, text, jsonb, text) to service_role;

-- Welcome email, enqueued exactly once per user, on email confirmation.
create function app_private.handle_user_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform app.enqueue_email(
      'welcome',
      new.email,
      jsonb_build_object('user_id', new.id),
      'welcome:' || new.id::text
    );
  end if;
  return new;
end;
$$;

comment on function app_private.handle_user_email_confirmed() is
  'AFTER UPDATE ON auth.users: fires only on the email_confirmed_at NULL -> NOT NULL transition, never on signup itself.';

create trigger on_auth_user_email_confirmed
  after update on auth.users
  for each row
  execute function app_private.handle_user_email_confirmed();
