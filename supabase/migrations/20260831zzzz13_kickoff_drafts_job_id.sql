-- Kickoff Pack dual agreement, step 4 of 5, first piece: kickoff_drafts
-- gains job_id. Needed before anything can auto-trigger a draft: today a
-- draft is not correlated to a job until an admin manually links it
-- (link_kickoff_draft_to_job), so nothing could tell "a draft for this job
-- is already in flight" without it, and an automatic trigger would risk
-- requesting a second draft every time it polled. Nullable: the admin
-- desk's existing manual flow never sends one and keeps working exactly as
-- it does today.
alter table public.kickoff_drafts
  add column if not exists job_id text references public.jobs(id);

create index if not exists kickoff_drafts_job_id_idx on public.kickoff_drafts(job_id) where job_id is not null;
