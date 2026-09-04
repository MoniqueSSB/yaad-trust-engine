-- A job records the door it came through.
--
-- Until now, which channel a job arrived by lived in two places and neither of
-- them was a column. It was a prefix inside the primary key (JOB-WA-, JOB-WEB-,
-- JOB-SMS-, JOB-EMAIL-), and it was an English sentence inside the free text
-- description: "Arrived by whatsapp from +447700900123, over 4 messages."
--
-- So "how many jobs came in on WhatsApp last month" could not be asked of the
-- database without parsing prose, and the id prefix does not answer it either:
-- ten of the forty rows are TEST, one is DEMO, and two are from a numbering
-- scheme that predates all of this.
--
-- Three columns, not one, because the other two answer the questions that
-- always come immediately after the first one and are equally unaskable today.
--
--   source          which door. whatsapp, sms, email, web, form, desk, other.
--   intake_turns    how many messages it took. The number that says whether
--                   the assistant is actually helping or grinding people down,
--                   and the one that decides whether the three turn handoff is
--                   set anywhere near right.
--   handed_to_human whether a person had to take it over. Read next to
--                   intake_turns it is the whole quality picture for the
--                   assistant, and today it is only visible by opening a
--                   conversation one at a time.
--
-- Deliberately NOT a check constraint on source. A value this list has never
-- seen should show up in the desk as itself, the way the Mid-chat view already
-- shows an unknown lane by name rather than folding it into a guess. A
-- constraint here would instead make a new channel fail to write a job.

alter table public.jobs
  add column if not exists source          text    not null default '',
  add column if not exists intake_turns    integer not null default 0,
  add column if not exists handed_to_human boolean not null default false;

comment on column public.jobs.source is
  'The door this job came through: whatsapp, sms, email, web, form, desk. Written by the function that creates the job. Empty means it predates this column or came from a path that does not set it yet.';
comment on column public.jobs.intake_turns is
  'How many messages the intake conversation took. 0 for jobs that did not come from a conversation.';
comment on column public.jobs.handed_to_human is
  'True if the assistant handed this conversation to Monique rather than finishing it.';

create index if not exists jobs_source_idx on public.jobs (source);

-- ── backfill ────────────────────────────────────────────────────────────
--
-- From the id prefix, which is the only evidence the old rows carry. Only
-- where source is still blank, so re-running this cannot overwrite a value the
-- function has since written properly.
--
-- TEST and DEMO rows are labelled as what they are rather than guessed into a
-- channel. Ten of forty rows being test data is worth being able to filter out
-- on purpose, and quietly calling them 'web' would put them in the numbers
-- that get read to an investor in January.

update public.jobs set source = 'whatsapp' where source = '' and id like 'JOB-WA-%';
update public.jobs set source = 'sms'      where source = '' and id like 'JOB-SMS-%';
update public.jobs set source = 'email'    where source = '' and id like 'JOB-EMAIL-%';
update public.jobs set source = 'test'     where source = '' and (id like 'JOB-TEST-%' or id like 'JOB-DEMO-%');

-- JOB-WEB- is the ambiguous one, and it is ambiguous because two different
-- functions mint it: yaad-post-job for somebody filling in the job form, and
-- yaad-inbound for somebody typing into the chat bubble on yaadly.co.uk. From
-- here on they write 'form' and 'web' themselves and the question does not
-- arise. For the fourteen rows already here, the conversation is the evidence:
-- a chat job has a row in intake_threads on channel 'web' and a form job has
-- none at all. Anything left over is a form job, which is what that route was
-- before the chat widget existed on 2 September 2026.
update public.jobs j set source = 'web'
 where j.source = '' and j.id like 'JOB-WEB-%'
   and exists (select 1 from public.intake_threads t where t.job_id = j.id and t.channel = 'web');
update public.jobs set source = 'form' where source = '' and id like 'JOB-WEB-%';

-- intake_turns is backfilled from the conversation where one still exists.
-- Nothing is invented for the rows where it does not: 0 already means "not
-- from a conversation" and a made up number would be worse than a blank.
update public.jobs j
   set intake_turns = t.turns,
       handed_to_human = t.human_handling
  from public.intake_threads t
 where t.job_id = j.id
   and j.intake_turns = 0;
