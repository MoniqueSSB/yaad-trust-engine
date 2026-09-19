-- Following one up is a tick. The words are worth having, not worth a door.
--
-- mark_delivery_followed_up() refused any note under five characters. The
-- founder typed "DONE", which is four, and the desk told her "This did not
-- go." Four characters typed by the person who actually made the phone call
-- is a real answer, and a rule that rejects it is not protecting anybody: the
-- row it guards is a note to herself, on a page one person uses, about a
-- message that has already failed to arrive.
--
-- Two changes, both to the same function. Nothing else moves.
--
-- 1. The note is optional. Empty records that it was dealt with, by whom, and
--    when, which is the part that matters; the desk still asks for the words
--    and still keeps them when they are given.
-- 2. Nothing left to follow up is no longer an error. It was raised so a
--    mistyped number could not silently do nothing, but the only caller is a
--    button drawn on a row the page has already read as open, so in practice
--    it fires when the page is a few seconds stale or the same tick is sent
--    twice, and what she sees is a red refusal for work already finished. It
--    returns 0 instead, the page reloads, the row is gone. A number with no
--    usable digits is still refused, because that one is a real mistake.
--
-- NOTHING HERE SENDS A MESSAGE, MOVES MONEY OR DECIDES ANYTHING. It writes the
-- same three followed_up columns it always did, and it still records the named
-- person from the signed-in session rather than a name the page sends.

create or replace function public.mark_delivery_followed_up(p_to_addr text, p_note text default '')
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_who    text := btrim(coalesce(auth.jwt() ->> 'email', ''));
  v_note   text := btrim(coalesce(p_note, ''));
  v_digits text := regexp_replace(coalesce(p_to_addr, ''), '\D', '', 'g');
  v_n      int;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  if v_who = '' then
    raise exception 'No signed-in email on this session, so there is no named person to record.' using errcode = '28000';
  end if;
  if length(v_digits) < 7 then
    raise exception 'That is not a usable number.' using errcode = 'check_violation';
  end if;
  -- Said plainly, so a row read back in six months does not look like somebody
  -- wrote nothing by accident.
  if v_note = '' then
    v_note := 'Marked as followed up. No note written.';
  end if;

  update public.message_deliveries
     set followed_up_at = now(), followed_up_by = v_who, followed_up_note = left(v_note, 1000)
   where regexp_replace(to_addr, '\D', '', 'g') = v_digits
     and followed_up_at is null
     and (error_code <> ''
          or status in ('failed', 'undelivered')
          or (status = 'sent' and sent_at < now() - interval '24 hours'));
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

comment on function public.mark_delivery_followed_up(text, text) is
  'Records that a named admin dealt with every open delivery problem to one number, and what they did if they said. Writes only the three followed_up columns. Sends nothing. Returns how many rows it closed, 0 if there was nothing left open.';

revoke all on function public.mark_delivery_followed_up(text, text) from public, anon;
grant execute on function public.mark_delivery_followed_up(text, text) to authenticated;
