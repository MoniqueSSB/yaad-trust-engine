-- One queue of everybody waiting on a person.
--
-- The desk knew who was waiting and would not show it. v_reply_clock produced
-- a number for a tile; acting on that number meant opening Conversations,
-- opening Enquiries, working out which rows were the waiting ones, and holding
-- two lists in your head. The founder's own words, 4 September 2026: "why is
-- not a place somewhere i can see these open queries to answer them".
--
-- She was right, and the shape of the mistake is worth keeping. Every part of
-- this existed: the threads, the enquiries, the clock, the reply lane. What
-- was missing was the one screen that put them together, and a measurement
-- nobody can act on is decoration.
--
-- This view carries enough to ACT, not only to count. Threads keep channel and
-- from_addr so the same reply box Conversations already uses works here
-- unchanged, with no second implementation to drift. Enquiries keep the contact
-- and whether the automatic receipt ever reached them, because "they have had
-- nothing at all, not even the robot" is the row you answer first: it happens
-- when somebody leaves a phone number rather than an email, and the receipt
-- has no way to reach them.
--
-- Same exclusions as v_reply_clock, for the same reason: a queue that counts
-- your own QA is a queue you learn to ignore.

create or replace view public.v_waiting_on_you
with (security_invoker = true) as
  select
    'thread'::text                                        as kind,
    coalesce(t.job_id, t.from_addr)                       as ref,
    t.channel                                             as channel,
    t.from_addr                                           as from_addr,
    t.from_addr                                           as who,
    ''::text                                              as contact,
    ''::text                                              as receipt,
    t.transcript                                          as transcript,
    coalesce(t.first_client_at, t.awaiting_human_since)   as waiting_since,
    round((extract(epoch from (now() - coalesce(t.first_client_at, t.awaiting_human_since))) / 3600.0)::numeric, 1) as hours_waiting,
    coalesce(public.within_one_working_day(
      coalesce(t.first_client_at, t.awaiting_human_since), now()), true) = false as breached,
    t.human_handling                                      as handed_over,
    t.turns                                               as turns
  from public.intake_threads t
  where t.first_human_reply_at is null
    and coalesce(t.first_client_at, t.awaiting_human_since) is not null
    and coalesce(t.job_id, '') not like 'JOB-TEST%'
  union all
  select
    'enquiry'::text,
    e.id::text,
    'form'::text,
    null::text,
    coalesce(nullif(btrim(e.name), ''), 'no name'),
    coalesce(e.contact, ''),
    coalesce(e.receipt, ''),
    coalesce(e.topic, '') || case when coalesce(e.topic,'') <> '' then E'\n\n' else '' end || coalesce(e.message, ''),
    e.created_at,
    round((extract(epoch from (now() - e.created_at)) / 3600.0)::numeric, 1),
    coalesce(public.within_one_working_day(e.created_at, now()), true) = false,
    false,
    0
  from public.enquiries e
  where e.first_replied_at is null
    and coalesce(e.status, 'new') not in ('replied', 'converted', 'test', 'binned');

comment on view public.v_waiting_on_you is
  'Everybody waiting on a person, conversations and contact form enquiries in one list, oldest first. Carries what is needed to answer them, not only to count them: channel and from_addr for the reply box, contact and receipt state for an enquiry.';

grant select on public.v_waiting_on_you to authenticated;

-- The desk needs to clear an enquiry off this queue, and the queue is a view,
-- so a column write is not available to it. Same reason every other rule here
-- goes through a function: the check happens in the database whoever calls.
create or replace function public.mark_enquiry_replied(p_enquiry uuid)
returns public.enquiries
language plpgsql security definer set search_path = public as $$
declare row public.enquiries;
begin
  if not public.is_admin() then
    raise exception 'Only a signed-in admin can mark an enquiry replied.';
  end if;

  -- status drives first_replied_at through trg_enquiry_reply_clock, so this
  -- stamps the reply clock as a side effect and deliberately does not set that
  -- column itself. One writer for it, or the two disagree eventually.
  update public.enquiries set status = 'replied'
   where id = p_enquiry and coalesce(status,'new') not in ('replied','converted')
   returning * into row;

  if row.id is null then
    raise exception 'That enquiry does not exist, or it is already replied to.';
  end if;

  insert into public.agent_actions (actor, actor_kind, action, summary, refs)
  values (coalesce(auth.jwt() ->> 'email', 'unknown'), 'human', 'mark_enquiry_replied',
          'Answered the enquiry from ' || coalesce(nullif(btrim(row.name),''), 'somebody who left no name'),
          jsonb_build_object('enquiries', p_enquiry));

  return row;
end;
$$;

comment on function public.mark_enquiry_replied is
  'Clears an enquiry off the waiting queue and stamps the reply clock through the status trigger. It sends nothing: replying happens on WhatsApp or by email, and this records that a person did it.';

revoke all on function public.mark_enquiry_replied(uuid) from anon;
