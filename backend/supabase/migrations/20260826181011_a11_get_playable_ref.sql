-- A11: app.get_playable_ref -- the only client-reachable path to a
-- lesson's provider/external_ref (app_private.lesson_assets itself has
-- zero RLS policies, per A5). Runs under the caller's own JWT context
-- (auth.uid()), even though it is SECURITY DEFINER: the entitlement check
-- is against whoever is actually calling, never a fixed identity, which is
-- what makes "checks app.has_active_enrollment internally" structurally
-- impossible to bypass from a caller's own code.
--
-- Returns ZERO ROWS, never an error, both when the lesson does not exist
-- and when the caller is not entitled -- an error in one case and an empty
-- result in the other would let a caller distinguish "this lessonId is
-- real but I can't watch it" from "this lessonId doesn't exist", which
-- leaks curriculum existence to an unauthorized caller.

create function app.get_playable_ref(p_lesson_id uuid)
returns table (lesson_id uuid, provider text, external_ref text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_course_id uuid;
  v_is_free_preview boolean;
begin
  select l.course_id, l.is_free_preview
    into v_course_id, v_is_free_preview
  from public.lessons l
  where l.id = p_lesson_id;

  if not found then
    return; -- lesson does not exist -- zero rows, no error
  end if;

  -- is_free_preview lets a logged-in-but-not-enrolled user preview a
  -- lesson (marketing/sales purpose); anyone else must be actively
  -- entitled. Either way, an unmet condition falls through to the same
  -- "zero rows" ending as the lesson-not-found branch above.
  if not v_is_free_preview and not app.has_active_enrollment(auth.uid(), v_course_id) then
    return;
  end if;

  return query
    select la.lesson_id, la.provider, la.external_ref
    from app_private.lesson_assets la
    where la.lesson_id = p_lesson_id
      and la.is_active;
end;
$$;

comment on function app.get_playable_ref(uuid) is
  'Only client-reachable read path to app_private.lesson_assets. Checks app.has_active_enrollment (or is_free_preview) against auth.uid() -- returns zero rows, never an error, for both "not entitled" and "lesson does not exist". GRANT TO authenticated only.';

revoke all on function app.get_playable_ref(uuid) from public, anon;
grant execute on function app.get_playable_ref(uuid) to authenticated;
