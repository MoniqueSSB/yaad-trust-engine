-- The desk can message an applicant who has no job yet, and the ledger says
-- who did. 25 October 2026.
--
-- Found 25 October 2026: every worker application since 5 September failed at
-- Send (a missing showcase_consent column, since applied by hand), and two
-- real applicants sat at status started for weeks with no way to reach them
-- from the desk. The only message function, yaad-desk-message, is keyed on a
-- JOB, and record_desk_message() writes against jobs.id, which an applicant
-- does not have.
--
-- This is the applicant twin of record_desk_message() (20260911090000). Same
-- shape on purpose: a SECURITY DEFINER function that checks is_admin() and
-- names the signed-in person from their own token, never from the page. It
-- records; it sends nothing. The message has already gone by the time this
-- runs, and the function calling it treats a failure here as "sent, not
-- recorded", never as "not sent".
--
-- The row lands in agent_actions with job_id null, which that table's read
-- policy already treats as desk-wide activity, admin only. The application
-- id goes in refs, so the ledger can still be read back by applicant.

create or replace function public.record_desk_applicant_message(
  p_application uuid,
  p_channel     text,
  p_sid         text,
  p_to_addr     text,
  p_body        text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin text := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
  v_ref   text;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  if v_admin is null then
    raise exception 'No signed-in person to attribute this to.' using errcode = '28000';
  end if;
  if p_application is null then
    raise exception 'An applicant message is recorded against an application.' using errcode = 'check_violation';
  end if;
  if p_channel not in ('whatsapp', 'email') then
    raise exception 'A desk message goes by whatsapp or email.' using errcode = 'check_violation';
  end if;

  select a.app_id into v_ref from public.applications a where a.id = p_application;
  if v_ref is null then
    raise exception 'No application with that id.' using errcode = 'no_data_found';
  end if;

  insert into public.agent_actions (job_id, actor, actor_kind, action, summary, refs)
  values (
    null,
    v_admin,
    'human',
    'desk_message',
    left(coalesce(p_body, ''), 1500),
    jsonb_build_object(
      'to', 'applicant',
      'application_id', p_application,
      'application_ref', v_ref,
      'channel', p_channel,
      'message_sid', nullif(btrim(coalesce(p_sid, '')), '')
    )
  );

  -- The row a Twilio status callback updates, so "Did it arrive" can show
  -- whether the WhatsApp message reached the phone. job_id is '' because
  -- there is no job; the kind says what it was. Email ids are prefixed
  -- resend: and never get a Twilio callback, so they stay off this table.
  if p_channel = 'whatsapp' and nullif(btrim(coalesce(p_sid, '')), '') is not null then
    insert into public.message_deliveries (message_sid, to_addr, channel, kind, job_id, status)
    values (btrim(p_sid), coalesce(p_to_addr, ''), 'whatsapp', 'desk_message', '', 'accepted')
    on conflict (message_sid) do nothing;
  end if;
end;
$$;

revoke all on function public.record_desk_applicant_message(uuid, text, text, text, text) from public, anon;
grant execute on function public.record_desk_applicant_message(uuid, text, text, text, text) to authenticated;

comment on function public.record_desk_applicant_message(uuid, text, text, text, text) is
  'Writes a desk message to an applicant (yaad-desk-message, side applicant) to the action ledger under the signed-in admin. Records only; sends nothing.';
