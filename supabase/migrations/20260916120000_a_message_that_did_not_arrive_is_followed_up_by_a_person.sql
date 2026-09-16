-- A message that did not arrive is followed up by a person.
--
-- The desk's "Did it arrive" page was a list of Twilio statuses. On 16
-- September 2026 the founder asked for it to say what the actual issue is and
-- give her a button to act on it. Reading the live table to build that turned
-- up three things wrong underneath it, and this migration fixes the two that
-- live in the database.
--
-- 1. A LATE STATUS COULD OVERWRITE A FAILURE. yaad-message-status upserted
--    whatever Twilio said last. Twilio's callbacks are not guaranteed to
--    arrive in order, and on 13 and 14 September two messages that WhatsApp
--    refused (error 63016) were left reading "sent", because the "sent"
--    callback landed after the "undelivered" one. The page read them as fine.
--    From here every write goes through record_message_delivery(), which only
--    ever moves a status forward: accepted, queued, sending, sent, delivered,
--    read, with failed and undelivered as the end of the line. An error code,
--    a kind and a job, once known, are never blanked by a later write that
--    does not carry them.
--
-- 2. NOTHING RECORDED WHAT A MESSAGE WAS. The table's own comment says the
--    sending code writes the row when Twilio accepts a message. None did: only
--    the callback wrote, and the callback does not know what the message was
--    or which job it belonged to, so "What it was" and "Job" were blank on
--    every live row. The functions that send now call the same function the
--    moment Twilio accepts, with the kind and the job (the function code is in
--    the same change). The one sender that already tried, the desk reply, lost
--    the race to the callback and recorded nothing; fixed below. Rows already
--    written stay blank; there is nothing true to put in them.
--
-- 3. FOLLOWING ONE UP. Three columns and one admin-only function. The desk can
--    still only read this table; the function is the one way to write to it,
--    it writes nothing but these three columns, and it records the named
--    person from the signed-in session rather than trusting a name the page
--    sends. Following up clears every open problem to that number at once,
--    because what she does is call a person, not a message. It sends nothing
--    and changes nothing about the messages themselves.
--
-- NOTHING HERE SENDS A MESSAGE, MOVES MONEY OR DECIDES ANYTHING.

alter table public.message_deliveries
  add column if not exists followed_up_at   timestamptz,
  add column if not exists followed_up_by   text not null default '',
  add column if not exists followed_up_note text not null default '';

comment on column public.message_deliveries.followed_up_at is
  'When a named person recorded that they had dealt with this message not arriving. Set only by mark_delivery_followed_up().';
comment on column public.message_deliveries.followed_up_by is
  'The signed-in email of the person who followed it up, taken from the session, never from the page.';
comment on column public.message_deliveries.followed_up_note is
  'What they did, in their words. For the desk only; never sent to anybody.';

-- How far along a status is. Unknown words rank lowest, so a status Twilio
-- adds later can never overwrite a real one.
create or replace function public.message_status_rank(p_status text)
returns int
language sql
immutable
set search_path to 'public'
as $$
  select case lower(btrim(coalesce(p_status, '')))
    when 'accepted'    then 1
    when 'scheduled'   then 1
    when 'queued'      then 2
    when 'sending'     then 3
    when 'sent'        then 4
    when 'delivered'   then 5
    when 'read'        then 6
    when 'failed'      then 7
    when 'undelivered' then 7
    else 0
  end
$$;

create or replace function public.record_message_delivery(
  p_sid        text,
  p_to         text default '',
  p_channel    text default '',
  p_kind       text default '',
  p_job        text default '',
  p_status     text default '',
  p_error_code text default ''
)
returns void
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_sid    text := btrim(coalesce(p_sid, ''));
  v_status text := lower(btrim(coalesce(p_status, '')));
begin
  if v_sid = '' then
    return;
  end if;

  insert into public.message_deliveries as d
    (message_sid, to_addr, channel, kind, job_id, status, error_code)
  values (
    v_sid,
    btrim(coalesce(p_to, '')),
    coalesce(nullif(btrim(coalesce(p_channel, '')), ''), 'whatsapp'),
    left(btrim(coalesce(p_kind, '')), 80),
    btrim(coalesce(p_job, '')),
    coalesce(nullif(v_status, ''), 'accepted'),
    btrim(coalesce(p_error_code, ''))
  )
  on conflict (message_sid) do update set
    -- The callback's To is Twilio's own normalised form, so a sender's copy
    -- only fills a blank, never replaces it.
    to_addr    = case when d.to_addr = '' then excluded.to_addr else d.to_addr end,
    channel    = case when btrim(coalesce(p_channel, '')) <> '' then excluded.channel else d.channel end,
    kind       = case when excluded.kind       <> '' then excluded.kind       else d.kind       end,
    job_id     = case when excluded.job_id     <> '' then excluded.job_id     else d.job_id     end,
    error_code = case when excluded.error_code <> '' then excluded.error_code else d.error_code end,
    status     = case
                   when v_status = '' then d.status
                   when public.message_status_rank(v_status) >= public.message_status_rank(d.status) then v_status
                   else d.status
                 end,
    updated_at = now();
end
$$;

comment on function public.record_message_delivery(text, text, text, text, text, text, text) is
  'The one way a delivery row is written: by the sending function when Twilio accepts, and by yaad-message-status as Twilio reports. A status only moves forward; a kind, job or error code already known is never blanked.';

revoke all on function public.record_message_delivery(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_message_delivery(text, text, text, text, text, text, text) to service_role;

-- The desk's own record, record_desk_delivery (20260911090000), inserted with
-- ON CONFLICT DO NOTHING. Twilio's first status callback routinely lands
-- within a second of the send, before the desk function gets round to
-- recording it, so the callback's row already existed and the desk's kind and
-- job were thrown away. Same checks as before; the write now goes through
-- record_message_delivery, which fills a blank kind and job into a row the
-- callback got to first.
create or replace function public.record_desk_delivery(
  p_sid     text,
  p_to_addr text,
  p_channel text,
  p_kind    text,
  p_job     text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  if nullif(btrim(coalesce(p_sid, '')), '') is null then
    raise exception 'A delivery is recorded against the message id Twilio returned.' using errcode = 'check_violation';
  end if;
  if p_kind not in ('desk_reply', 'desk_message') then
    raise exception 'The desk records its own replies and messages, nothing else.' using errcode = 'check_violation';
  end if;
  perform public.record_message_delivery(btrim(p_sid), coalesce(p_to_addr, ''), coalesce(p_channel, ''), p_kind, coalesce(p_job, ''), 'accepted');
end;
$$;

-- Which rows count as a problem is the same rule the desk page draws with:
-- an error code, a failed or undelivered status, or sent with no news for a
-- day. Kept in one expression here so the button clears exactly what the page
-- shows as open.
create or replace function public.mark_delivery_followed_up(p_to_addr text, p_note text)
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
  if length(v_note) < 5 then
    raise exception 'Say in a few words what you did, so the next person reading this knows.' using errcode = 'check_violation';
  end if;
  if length(v_digits) < 7 then
    raise exception 'That is not a usable number.' using errcode = 'check_violation';
  end if;

  update public.message_deliveries
     set followed_up_at = now(), followed_up_by = v_who, followed_up_note = left(v_note, 1000)
   where regexp_replace(to_addr, '\D', '', 'g') = v_digits
     and followed_up_at is null
     and (error_code <> ''
          or status in ('failed', 'undelivered')
          or (status = 'sent' and sent_at < now() - interval '24 hours'));
  get diagnostics v_n = row_count;

  if v_n = 0 then
    raise exception 'Nothing to follow up for that number: every message to it arrived or has already been followed up.' using errcode = 'check_violation';
  end if;
  return v_n;
end
$$;

comment on function public.mark_delivery_followed_up(text, text) is
  'Records that a named admin dealt with every open delivery problem to one number, and what they did. Writes only the three followed_up columns. Sends nothing.';

revoke all on function public.mark_delivery_followed_up(text, text) from public, anon;
grant execute on function public.mark_delivery_followed_up(text, text) to authenticated;

-- The two rows 1. describes, and any like them: a row carrying an error code
-- was not delivered, whatever the later callback said. Only the status moves;
-- the code that proves it stays.
update public.message_deliveries
   set status = 'undelivered'
 where error_code <> ''
   and status not in ('failed', 'undelivered');
