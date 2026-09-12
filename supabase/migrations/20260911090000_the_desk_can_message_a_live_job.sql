-- The desk can message the client or the tradesperson on a job, and the
-- ledger says who did. 11 September 2026.
--
-- yaad-desk-message sends Monique's own words, typed at the desk, from the
-- Yaadly WhatsApp number or the jobs address. This function is how that send
-- is written down. It exists because the desk's own session can read the
-- ledger and the delivery log but, by design, cannot write to either: every
-- write to agent_actions goes through a purpose-built SECURITY DEFINER
-- function that checks is_admin() and names the person, the same shape as
-- mark_job_test() and mark_enquiry_replied().
--
-- It records; it sends nothing. The message has already gone by the time
-- this runs, and the function calling it treats a failure here as "sent, not
-- recorded", never as "not sent".
--
-- The body is kept, capped at 1500 characters, because what Yaadly said to a
-- client or a worker mid-job is exactly what a dispute later turns on. The
-- ledger is admin-readable, and readable by the two parties to that job only.

create or replace function public.record_desk_message(
  p_job     text,
  p_to      text,
  p_channel text,
  p_sid     text,
  p_to_addr text,
  p_body    text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin text := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  if v_admin is null then
    raise exception 'No signed-in person to attribute this to.' using errcode = '28000';
  end if;
  if p_to not in ('client', 'worker') then
    raise exception 'A desk message goes to the client or the worker.' using errcode = 'check_violation';
  end if;
  if p_channel not in ('whatsapp', 'email') then
    raise exception 'A desk message goes by whatsapp or email.' using errcode = 'check_violation';
  end if;

  insert into public.agent_actions (job_id, actor, actor_kind, action, summary, refs)
  values (
    nullif(btrim(coalesce(p_job, '')), ''),
    v_admin,
    'human',
    'desk_message',
    left(coalesce(p_body, ''), 1500),
    jsonb_build_object('to', p_to, 'channel', p_channel, 'message_sid', nullif(btrim(coalesce(p_sid, '')), ''))
  );

  -- The row a Twilio status callback updates, so "Did it arrive" can show
  -- whether a WhatsApp desk message actually reached the phone. Email ids
  -- are prefixed resend: and never receive a Twilio callback; they are kept
  -- off this table so it keeps meaning one thing.
  if p_channel = 'whatsapp' and nullif(btrim(coalesce(p_sid, '')), '') is not null then
    insert into public.message_deliveries (message_sid, to_addr, channel, kind, job_id, status)
    values (btrim(p_sid), coalesce(p_to_addr, ''), 'whatsapp', 'desk_message', coalesce(p_job, ''), 'accepted')
    on conflict (message_sid) do nothing;
  end if;
end;
$$;

revoke all on function public.record_desk_message(text, text, text, text, text, text) from public, anon;
grant execute on function public.record_desk_message(text, text, text, text, text, text) to authenticated;

comment on function public.record_desk_message(text, text, text, text, text, text) is
  'Writes a desk message (yaad-desk-message) to the action ledger under the signed-in admin. Records only; sends nothing.';


-- ── record_desk_delivery ─────────────────────────────────────────────────
--
-- Found 11 September 2026: yaad-desk-reply has written to message_deliveries
-- under the caller's own token since 5 September, and message_deliveries has
-- a read policy for admins and no insert policy for anybody. So every one of
-- those writes was refused, silently, because the function treats the log as
-- best effort. Not one row in the table has kind 'desk_reply'. The replies
-- themselves went; what was lost is the record of whether they arrived, which
-- is the whole reason "Did it arrive" exists.
--
-- The fix is the same shape as every other write this desk makes to a
-- protected table: a SECURITY DEFINER function that checks is_admin() and
-- writes one row. Not an insert policy, because a policy would let the desk
-- write any row it liked into a log whose value is that the desk did not
-- write it.
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
  insert into public.message_deliveries (message_sid, to_addr, channel, kind, job_id, status)
  values (btrim(p_sid), coalesce(p_to_addr, ''), coalesce(p_channel, ''), p_kind, coalesce(p_job, ''), 'accepted')
  on conflict (message_sid) do nothing;
end;
$$;

revoke all on function public.record_desk_delivery(text, text, text, text, text) from public, anon;
grant execute on function public.record_desk_delivery(text, text, text, text, text) to authenticated;
