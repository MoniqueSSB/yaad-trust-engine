-- The public board hides what a person marked as a test.
--
-- WHAT WAS WRONG. On 9 September 2026 app.yaadly.co.uk/jobs listed eight
-- open jobs and six workers, and every one of them was the founder testing
-- her own system: three jobs and one worker say "Test" or "SEED" in their own
-- title, one worker has a test email address, and the rest are the founder's
-- own jobs put through the live WhatsApp, email and web form channels. The
-- Data Room note of 7 September ("WHERE THIS LANE ACTUALLY GOT TO") already
-- records exactly that: 43 jobs, one person testing, integration testing and
-- not validation. That record is honest and it stays. What was not honest was
-- the board, which showed those rows to the public as if they were demand.
--
-- WHAT THIS DOES. jobs and worker_profiles each get an is_test flag, false by
-- default. The public views (open_jobs, and the four public_worker_* views)
-- exclude rows where it is true. The desk shows them regardless, with a chip,
-- because the desk is the record and the board is the shop window. Two
-- functions let a signed-in admin mark a row as a test or as real, and each
-- press is written to agent_actions with who pressed it. Nothing is deleted,
-- nothing else about a marked row changes: its conversation, evidence, quotes
-- and money are untouched. Same pattern as intake_threads.is_test
-- (20260906001500), which takes a demo conversation off the reply queue.
--
-- HOW THE BACKFILL DECIDES. Nothing here is inferred by the machine from
-- someone's behaviour. Two sources only:
--   1. rows that declare themselves on their own record: source = 'test',
--      an id beginning JOB-TEST-, a client name beginning "Test " or "TEST QA"
--      or carrying "(SEED)" or "(DESK CHECK)"; workers whose name or email
--      contains the word test or qa as a whole word, or an @example.com
--      address;
--   2. the founder's own written record: the six jobs that were open on the
--      board on 9 September under her own name and email, which the Data Room
--      note describes as her tests. They are named by id below rather than
--      matched by pattern, so a real client is never caught by a rule.
-- JOB-DEMO-PHOTOS is deliberately NOT marked. It is a display listing that
-- says DEMO LISTING in its own title and first line; RUNBOOK.md says to
-- delete it when it is no longer wanted on the board. Hiding it is that
-- decision, and it is Monique's.
--
-- WHAT THIS DOES NOT DO. It does not touch the closed rows the flag would
-- make no difference to. A job that is not open never reaches the board, so
-- marking it would write a claim the flag does not need; the desk buttons
-- are there for the day a closed test row is reopened.
--
-- PRODUCTION SHAPE. This project has not had 20260905a applied (no
-- request_state column, no request_is_live(), no my_requested_jobs) nor
-- 20260905b (no worker_showcase table, no public_worker_showcase view). See
-- RUNBOOK.md, "Applying migration 20260905a to production". The two view
-- definitions that depend on those are therefore built conditionally: on a
-- clean ordered apply of this repository both conditions hold and the full
-- definitions land; on production today they do not, and the same file
-- applies the live shape plus the is_test clause. One file, both states,
-- nothing edited by hand at apply time.
--
-- THE TRAP FROM 20260907090000 STILL STANDS, AND NOW POINTS HERE. Applying
-- 20260905a on its own redefines open_jobs without board_descr() AND without
-- this clause. Apply this migration again straight after it.

alter table public.jobs
  add column if not exists is_test boolean not null default false;

comment on column public.jobs.is_test is
  'Marked by a person as their own test or demo. Never inferred. Keeps the row off the public board (open_jobs) and out of the automatic quote pack trigger; the desk, the portal, the conversation, the evidence and the money are untouched. Set through mark_job_test().';

alter table public.worker_profiles
  add column if not exists is_test boolean not null default false;

comment on column public.worker_profiles.is_test is
  'Marked by a person as a test profile. Never inferred. Keeps the worker out of the public directory and off their public profile page; the desk still shows them. Set through mark_worker_test().';

-- the backfill, on the two sources named above

update public.jobs
   set is_test = true
 where id <> 'JOB-DEMO-PHOTOS'
   and (
        source = 'test'
     or id like 'JOB-TEST-%'
     or coalesce(client_name, '') ~* '^(test |test qa)|\((seed|desk check)\)'
     or id in (
          -- founder-run tests through the live channels, per the Data Room
          -- record of 7 September 2026; open on the board on 9 September
          'JOB-WA-1788222609649',
          'JOB-WA-1788258939807',
          'JOB-WEB-1788281626906',
          'JOB-WA-1787995411470',
          'JOB-EMAIL-1787848212484',
          'JOB-WEB-1788219235030'
        )
   );

update public.worker_profiles
   set is_test = true
 where coalesce(name, '') ~* '(^|[^a-z])(test|qa)([^a-z]|$)'
    or coalesce(worker_email, '') ~* '(^|[^a-z])(test|qa)([^a-z]|$)|@example\.com$';

-- the public board

do $body$
declare
  has_refusal boolean := exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'jobs' and column_name = 'request_state')
    and to_regproc('public.request_is_live') is not null;
begin
  execute format($v$
    create or replace view public.open_jobs as
     SELECT j.id, j.title, j.parish,
        public.board_descr(j.descr, j.client_name, j.client_email, j.client_phone) AS descr,
        j.updated_at,
        cp.user_id IS NOT NULL AS client_signed,
        COALESCE(cp.jobs_completed, 0) AS client_jobs_completed,
        j.trade, j.job_type, j.size_band, j.access_type, j.materials_by, j.urgency,
        j.materials_store_type
       FROM public.jobs j
         LEFT JOIN public.client_profiles cp ON lower(cp.email) = lower(COALESCE(j.client_email, ''::text))
      WHERE j.open = true AND COALESCE(j.worker_email, ''::text) = ''::text AND j.stage = 0
        AND j.is_test = false
        %s
  $v$, case when has_refusal
            then 'AND NOT public.request_is_live(j.request_state, j.requested_at)'
            else '' end);
end
$body$;

grant select on public.open_jobs to anon, authenticated;

comment on view public.open_jobs is
  'The public job board. Masked through board_descr(); granted to anon, so treat every column here as published. Excludes rows a person marked with is_test (20260909150000). NOTE: if this project has not had 20260905a applied there is no first-refusal clause here and no my_requested_jobs view; applying 20260905a redefines this view WITHOUT board_descr and WITHOUT the is_test clause, so re-apply 20260909150000 straight after it.';

-- the public worker directory and profile pages

create or replace view public.public_worker_profiles as
select
  wp.name,
  wp.trade,
  wp.parish,
  wp.areas,
  wp.lane,
  wp.jobs_completed,
  wp.about,
  wp.years,
  wp.vetting_state,
  wp.slug
from public.worker_profiles wp
where wp.active
  and wp.is_test = false;

create or replace view public.public_portfolio as
select
  p.title,
  p.month,
  p.stages,
  p.evidence_items,
  p.position,
  wp.slug as subject_slug
from public.portfolio p
join public.worker_profiles wp on lower(wp.worker_email) = lower(p.worker_email)
where wp.active
  and wp.is_test = false;

create or replace view public.public_worker_checks as
select
  wc.label,
  wc.passed,
  wc.note,
  wc.position,
  wp.slug as subject_slug
from public.worker_checks wc
join public.worker_profiles wp on lower(wp.worker_email) = lower(wc.worker_email)
where wp.active
  and wp.is_test = false;

do $body$
begin
  if to_regclass('public.worker_showcase') is not null
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'worker_profiles'
                    and column_name = 'showcase_consent') then
    execute $v$
      create or replace view public.public_worker_showcase as
      select
        ws.kind,
        ws.storage_path,
        ws.mime,
        ws.caption,
        ws.position,
        wp.slug as subject_slug
      from public.worker_showcase ws
      join public.worker_profiles wp on lower(wp.worker_email) = lower(ws.worker_email)
      where wp.active
        and wp.showcase_consent = 'granted'
        and wp.is_test = false
    $v$;
    execute 'grant select on public.public_worker_showcase to anon, authenticated';
  end if;
end
$body$;

grant select on public.public_worker_profiles to anon, authenticated;
grant select on public.public_portfolio       to anon, authenticated;
grant select on public.public_worker_checks   to anon, authenticated;

comment on view public.public_worker_profiles is
  'The public worker directory. No email, no phone. Excludes inactive workers and anybody a person marked with is_test (20260909150000).';

-- the two buttons: a person marks, the ledger records who

create or replace function public.mark_job_test(p_job text, p_is_test boolean default true)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if not public.is_admin() then
    raise exception 'Only a signed-in admin can mark a job as a test.';
  end if;

  update public.jobs set is_test = p_is_test
   where id = p_job
   returning id into v_id;

  if v_id is null then
    raise exception 'There is no job with that id.';
  end if;

  insert into public.agent_actions (job_id, actor, actor_kind, action, summary, refs)
  values (v_id, coalesce(auth.jwt() ->> 'email', 'unknown'), 'human',
          case when p_is_test then 'mark_job_test' else 'unmark_job_test' end,
          case when p_is_test
               then 'Marked ' || v_id || ' as a test, so it stays off the public board. Nothing else about it changed.'
               else 'Marked ' || v_id || ' as real, so it shows on the public board whenever it is open for quotes.' end,
          jsonb_build_object('jobs', v_id, 'is_test', p_is_test));

  return p_is_test;
end;
$$;

comment on function public.mark_job_test(text, boolean) is
  'Sets jobs.is_test for one job. Admin only, recorded in agent_actions as a human act. True hides the job from the public board; false puts it back. Deletes nothing.';

revoke all on function public.mark_job_test(text, boolean) from public, anon;
grant execute on function public.mark_job_test(text, boolean) to authenticated;

create or replace function public.mark_worker_test(p_email text, p_is_test boolean default true)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if not public.is_admin() then
    raise exception 'Only a signed-in admin can mark a worker as a test.';
  end if;

  update public.worker_profiles set is_test = p_is_test
   where lower(worker_email) = lower(p_email)
   returning worker_email into v_email;

  if v_email is null then
    raise exception 'There is no worker profile with that email.';
  end if;

  insert into public.agent_actions (job_id, actor, actor_kind, action, summary, refs)
  values (null, coalesce(auth.jwt() ->> 'email', 'unknown'), 'human',
          case when p_is_test then 'mark_worker_test' else 'unmark_worker_test' end,
          case when p_is_test
               then 'Marked the worker profile ' || v_email || ' as a test, so it is out of the public directory. Nothing else about it changed.'
               else 'Marked the worker profile ' || v_email || ' as real, so it shows in the public directory while active.' end,
          jsonb_build_object('worker_profiles', v_email, 'is_test', p_is_test));

  return p_is_test;
end;
$$;

comment on function public.mark_worker_test(text, boolean) is
  'Sets worker_profiles.is_test for one worker. Admin only, recorded in agent_actions as a human act. True hides the worker from the public directory and profile page; false puts them back. Deletes nothing.';

revoke all on function public.mark_worker_test(text, boolean) from public, anon;
grant execute on function public.mark_worker_test(text, boolean) to authenticated;
