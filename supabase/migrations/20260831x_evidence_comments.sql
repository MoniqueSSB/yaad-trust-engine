-- The feedback loop the founder asked for, 31 Aug 2026: a client reviewing
-- evidence should be able to say more than yes or no. "If they're not
-- [satisfied], there should be a way to respond back", confirmed to mean
-- the client's comment goes to the WORKER to answer, and the worker's
-- reply is what the client sees next, not a whole-stage rejection and not
-- a bare complaint nobody sees.
--
-- One thread per job, not per photo: the client is commenting on what
-- arrived for a stage, not filing a structured dispute. Disputes already
-- have their own table and their own weight; this is lighter, a
-- conversation about the evidence, not a claim against the job.

create table if not exists public.evidence_comments (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs(id) on delete cascade,
  stage integer not null,
  from_role text not null check (from_role in ('client', 'worker')),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists evidence_comments_job_idx on public.evidence_comments(job_id, created_at);

alter table public.evidence_comments enable row level security;

-- Read only, same shape as stage_approvals: this job's client or worker,
-- or an admin. Written only from yaad-inbound on the service role, which
-- bypasses RLS entirely, so no insert policy exists for anyone else:
-- a client or worker session cannot post into a thread that is not theirs
-- to write into directly, only through the WhatsApp exchange that already
-- proved which job and which phone this is.
create policy "parties read evidence comments" on public.evidence_comments
  for select using (
    public.is_admin() or exists (
      select 1 from public.jobs j
       where j.id = evidence_comments.job_id
         and (lower(coalesce(j.client_email, '')) = lower(auth.jwt() ->> 'email')
              or lower(coalesce(j.worker_email, '')) = lower(auth.jwt() ->> 'email'))
    )
  );

comment on table public.evidence_comments is
  'A conversation about one stage''s evidence, client and worker, over WhatsApp. A comment from the client is a request for more, not an approval and not a dispute; a comment from the worker is their answer. Written only by yaad-inbound on the service role.';
