-- Two things, both from the founder on 5 September 2026.
--
-- ── One. The waiting queue has to survive its owner testing the product ──
--
-- The queue reported sixteen people waiting, then eight, and every single row
-- turned out to be a demo she had run herself. Twice I told her real people
-- were waiting on an urgent roof, and twice the evidence was a message she had
-- typed. The tell on one was a phone number in the 876 555 01xx range, which is
-- reserved for fiction.
--
-- The lesson is not "read the rows more carefully". She is going to keep
-- demoing this product daily for months, because that is what launching one
-- looks like. A queue that fills with her own tests and can only be cleaned by
-- hand in SQL is a queue she stops opening, and it is the only thing watching
-- the promise made on every page of the site.
--
-- So the queue can be told. One button per row, on both kinds, and both views
-- honour it. DELIBERATELY NOT A HEURISTIC: nothing here infers which rows are
-- real. A false positive hides a person who is waiting, which is worse than any
-- amount of noise. A person presses it and the ledger records that they did.
--
-- ── Two. The assistant speaks as Yaadly, never as Monique ──
--
-- Her instruction, in her words: "stop the webchat saying Monique, stop using
-- my name, it should be Yaadly in chat. Contact if they need too."
--
-- That is a brand decision and it is also a safety one. A client told "Monique
-- will answer" is being handed a named individual's availability as a promise,
-- by a machine, at two in the morning. "Someone at Yaadly" is both truer and
-- survives her being asleep, ill, or eventually not the only person on the
-- desk.
--
-- The transcript label moved with it, from "Monique (from the desk):" to
-- "Yaadly (from the desk):". That label is not decoration: both prompts are
-- told it marks a real person's words, so the model does not read a human's
-- reply as something the client said. yaad-desk-reply writes it,
-- transcript_test.ts asserts the prompts name it, and the three must move
-- together or the model quietly loses track of who is speaking.
--
-- The one place her name stays is the classifier's hint for wants_human,
-- because a client asking for "Monique" by name is exactly the signal that
-- field exists to catch. That is about what THEY say, never what we say.

alter table public.intake_threads
  add column if not exists is_test boolean not null default false;

comment on column public.intake_threads.is_test is
  'Marked by a person as their own demo or test, so it stops counting against the one working day promise. Never inferred. The conversation, the job and any evidence are untouched: this only removes the row from the waiting queue.';

create or replace function public.mark_thread_test(p_channel text, p_from text)
returns public.intake_threads
language plpgsql security definer set search_path = public as $$
declare row public.intake_threads;
begin
  if not public.is_admin() then
    raise exception 'Only a signed-in admin can mark a conversation as a test.';
  end if;

  update public.intake_threads set is_test = true
   where channel = p_channel and from_addr = p_from
   returning * into row;

  if row.channel is null then
    raise exception 'There is no conversation on that channel and address.';
  end if;

  insert into public.agent_actions (job_id, actor, actor_kind, action, summary, refs)
  values (row.job_id, coalesce(auth.jwt() ->> 'email', 'unknown'), 'human', 'mark_thread_test',
          'Marked the ' || p_channel || ' conversation ' || coalesce(row.job_id, p_from) || ' as a test, so it stops counting against the reply promise.',
          jsonb_build_object('intake_threads', p_channel || '/' || p_from));

  return row;
end;
$$;

comment on function public.mark_thread_test is
  'Takes a conversation off the waiting queue as a demo. Recorded in the ledger as a human act, because a measurement anybody can quietly switch off is not a measurement.';

revoke all on function public.mark_thread_test(text, text) from anon;

create or replace function public.mark_enquiry_test(p_enquiry uuid)
returns public.enquiries
language plpgsql security definer set search_path = public as $$
declare row public.enquiries;
begin
  if not public.is_admin() then
    raise exception 'Only a signed-in admin can mark an enquiry as a test.';
  end if;

  update public.enquiries set status = 'test'
   where id = p_enquiry and coalesce(status,'new') not in ('replied','converted')
   returning * into row;

  if row.id is null then
    raise exception 'That enquiry does not exist, or it has already been answered or converted.';
  end if;

  insert into public.agent_actions (actor, actor_kind, action, summary, refs)
  values (coalesce(auth.jwt() ->> 'email', 'unknown'), 'human', 'mark_enquiry_test',
          'Marked the enquiry from ' || coalesce(nullif(btrim(row.name),''), 'somebody who left no name') || ' as a test.',
          jsonb_build_object('enquiries', p_enquiry));

  return row;
end;
$$;

comment on function public.mark_enquiry_test is
  'Takes an enquiry off the waiting queue as a test. Refuses one already replied or converted: those are answered, not noise.';

revoke all on function public.mark_enquiry_test(uuid) from anon;

-- Both views honour the marker. A marker nothing reads is worse than no marker:
-- it looks like the row was dealt with and it still counts against the promise.
create or replace view public.v_waiting_on_you
with (security_invoker = true) as
  select
    'thread'::text                                        as kind,
    coalesce(t.job_id, t.from_addr)                       as ref,
    t.channel                                             as channel,
    t.from_addr                                           as from_addr,
    t.from_addr                                           as who,
    coalesce(t.contact_hint, '')                          as contact,
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
    and t.is_test is not true
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

grant select on public.v_waiting_on_you to authenticated;

create or replace view public.v_reply_clock
with (security_invoker = true) as
  select
    'thread'::text                              as kind,
    coalesce(s.job_id, s.from_addr)             as ref,
    s.channel                                   as channel,
    coalesce(s.first_client_at, s.awaiting_human_since) as waiting_since,
    round((extract(epoch from (now() - coalesce(s.first_client_at, s.awaiting_human_since))) / 3600.0)::numeric, 1) as hours_waiting,
    coalesce(public.within_one_working_day(
      coalesce(s.first_client_at, s.awaiting_human_since), now()), true) = false as breached
  from public.sla_first_reply s
  join public.intake_threads t
    on t.channel = s.channel and t.from_addr = s.from_addr
  where s.first_human_reply_at is null
    and coalesce(s.first_client_at, s.awaiting_human_since) is not null
    and coalesce(s.job_id, '') not like 'JOB-TEST%'
    and t.is_test is not true
  union all
  select
    'enquiry'::text,
    e.id::text,
    'form'::text,
    e.created_at,
    round((extract(epoch from (now() - e.created_at)) / 3600.0)::numeric, 1),
    coalesce(public.within_one_working_day(e.created_at, now()), true) = false
  from public.enquiries e
  where e.first_replied_at is null
    and coalesce(e.status, 'new') not in ('replied', 'converted', 'test', 'binned');

grant select on public.v_reply_clock to authenticated;
