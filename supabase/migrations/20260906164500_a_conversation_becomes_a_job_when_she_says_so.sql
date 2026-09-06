-- A conversation becomes a job when she says so.
--
-- Founder, 6 September 2026: "What if i want to turn this person into a job,
-- can i do that, be saying, attached a job to this, as i dont want it To
-- attach automatically to every single question that's asked."
--
-- The second half is already true as of this afternoon: a message the
-- classifier reads as a question, with no scope, trade or parish in it, writes
-- no job row at all. The conversation is kept in full under Conversations and
-- nothing lands in the job list.
--
-- This is the missing half. A question turns into real work more often than
-- not, and until now the only way to promote one was to wait for the client to
-- describe the job again so the classifier would catch it on a later turn.
-- That is asking somebody to repeat themselves so a machine can notice, which
-- is the same failure this whole day has been about.
--
-- A NAMED HUMAN DECIDES, which is why this is a button and not a heuristic.
-- CLAUDE.md 2. The engine decides nothing here: it wrote no job, and the only
-- thing that creates one is Monique reading the conversation and pressing the
-- button. There is deliberately no confidence score and no auto-promote.

create or replace function public.attach_job_to_thread(p_channel text, p_from text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  t   record;
  nid text;
  pre text;
begin
  -- security definer, so the check is the whole gate. Same shape as every
  -- other desk RPC in this schema.
  if not is_admin() then
    raise exception 'Only the desk can attach a job to a conversation.';
  end if;

  select * into t from public.intake_threads
   where channel = p_channel and from_addr = p_from;
  if not found then
    raise exception 'There is no conversation on % from %.', p_channel, p_from;
  end if;

  -- Idempotent on purpose. Two taps, or two people, must not produce two jobs
  -- for one conversation, and the honest answer to "attach a job" when one is
  -- already attached is the job that is already there.
  if t.job_id is not null then
    return t.job_id;
  end if;

  pre := case p_channel
           when 'whatsapp' then 'WA'
           when 'sms'      then 'SMS'
           when 'email'    then 'EMAIL'
           else 'WEB'
         end;
  nid := 'JOB-' || pre || '-' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text;

  -- Everything else on jobs is NOT NULL with a default, so this insert names
  -- only what it actually knows. It knows very little on purpose: the trade,
  -- the parish and the access are the client's to give, and inventing them
  -- from a conversation nobody has read as a brief is exactly what section 5
  -- of CLAUDE.md exists to stop. The transcript is carried verbatim so the
  -- desk can write the brief from their own words.
  insert into public.jobs (
    id, client_email, title, descr, client_phone,
    source, intake_turns, stage, open, status, handed_to_human
  ) values (
    nid,
    '',
    'Job from a conversation on ' || p_channel,
    'Attached to an existing conversation by the desk, not by the assistant. '
      || 'Nothing here was classified: read it and write the brief.'
      || E'\n\nIn their own words:\n' || coalesce(t.transcript, ''),
    -- A web visitor token is not a phone number and must never be shown as
    -- one, the same rule yaad-inbound follows on its own insert.
    case when p_channel in ('web', 'email') then '' else p_from end,
    p_channel,
    coalesce(t.turns, 1),
    0,
    false,
    -- sync_job_status owns this column and will rewrite whatever is passed:
    -- with no worker and open false it lands on 'awaiting_client_setup',
    -- because client_email is '' and client_cleared_for_golive() is false.
    -- 'draft' is passed anyway so this row is written exactly the way
    -- yaad-inbound writes its own, and so the intent is on the page rather
    -- than only in a trigger three files away. Verified by a rolled back
    -- insert against the live schema before this shipped, which is also how
    -- the override was found.
    'draft',
    coalesce(t.human_handling, false)
  );

  update public.intake_threads
     set job_id = nid
   where channel = p_channel and from_addr = p_from;

  return nid;
end $$;

revoke all on function public.attach_job_to_thread(text, text) from public;
grant execute on function public.attach_job_to_thread(text, text) to authenticated;

comment on function public.attach_job_to_thread(text, text) is
  'Desk only. Turns an existing conversation into a job and links the thread to it. Idempotent: returns the existing job id if one is already attached. The job lands closed, at stage 0, unclassified, carrying the transcript; sync_job_status settles its status, which is awaiting_client_setup until the client sets up a portal.';
