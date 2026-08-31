-- The approve button. The product is named after this moment and it did not
-- exist. "Money moves when you approve them" has sat on the evidence ledger
-- since 30 Aug, wired to jobs.status = 'evidence', a value the jobs.status
-- CHECK constraint has never allowed. awaitingApproval was always false, so
-- the sentence has been true of nothing since it was written.
--
-- Two pieces, both needed for the sentence to become real rather than just
-- one of them:
--
--   1. Something has to set jobs.status = 'evidence' when there is actually
--      something to approve. Nothing did. A trigger on evidence does it now,
--      the moment a row is filed against the stage currently being worked.
--   2. Something has to let the client say yes. approve_stage() does that,
--      same access rule as client_go_live: auth.uid() checked first, the
--      confirmed email read from auth.users, everything else follows from
--      who that turns out to be.
--
-- 'evidence' joins the status values a job can hold.
alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status = any (array[
    'draft', 'awaiting_client_setup', 'open_for_quotes', 'quoted',
    'in_progress', 'evidence', 'complete', 'disputed', 'cancelled'
  ]));

-- The record of an approval: who, when, against exactly what. The evidence
-- column is a snapshot taken at the moment of approval, id + sha256 + label
-- per item, not a live join to the evidence table. A photo cannot be swapped
-- after the fact without its fingerprint changing, and this is what makes
-- that checkable months later even if the evidence table's own rows are ever
-- edited by an admin for a legitimate reason.
create table if not exists public.stage_approvals (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs(id) on delete cascade,
  stage integer not null,
  approved_by text not null,
  approved_at timestamptz not null default now(),
  evidence jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists stage_approvals_job_idx on public.stage_approvals(job_id);

alter table public.stage_approvals enable row level security;

-- Read only. There is no INSERT policy, on purpose: the only door in is
-- approve_stage(), which is SECURITY DEFINER and writes as its owner. A
-- direct insert from a client or worker session would be a self-issued
-- approval, and the whole point of this table is that it is not that.
create policy "parties read stage approvals" on public.stage_approvals
  for select using (
    public.is_admin() or exists (
      select 1 from public.jobs j
       where j.id = stage_approvals.job_id
         and (lower(coalesce(j.client_email, '')) = lower(auth.jwt() ->> 'email')
              or lower(coalesce(j.worker_email, '')) = lower(auth.jwt() ->> 'email'))
    )
  );

create policy "admin full stage approvals" on public.stage_approvals
  for all using (public.is_admin()) with check (public.is_admin());

-- Files evidence, and the moment it is filed against the stage actually being
-- worked, the job has something waiting on a human. status flips to
-- 'evidence' so the ledger's headline stops being aspirational.
--
-- Materials evidence counts too: it is still proof filed against a stage, and
-- gating on kind would mean a job that only ever has materials evidence
-- (rare, but the schema allows it) never reaches an approvable state at all.
create or replace function public.evidence_marks_job_awaiting_approval()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.jobs
     set status = 'evidence',
         updated_at = now()
   where id = new.job_id
     and status = 'in_progress'
     and greatest(coalesce(stage, 0), 1) = coalesce(new.stage, 1);
  return new;
end;
$$;

drop trigger if exists trg_evidence_marks_awaiting_approval on public.evidence;
create trigger trg_evidence_marks_awaiting_approval
  after insert on public.evidence
  for each row execute function public.evidence_marks_job_awaiting_approval();

-- The approve function itself. Refuses while a dispute is open, using the
-- same "state <> 'resolved'" test the dispute policies already use, rather
-- than inventing a second definition of open that could drift from the
-- first.
create or replace function public.approve_stage(p_job text)
returns table(job_id text, stage integer, evidence_count integer)
language plpgsql
security definer
set search_path to 'public, auth'
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  j record;
  v_stage integer;
  v_evidence jsonb;
  v_count integer;
  v_dispute_open boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  select lower(btrim(u.email)) into v_email
    from auth.users u
   where u.id = v_uid and u.email_confirmed_at is not null;

  if v_email is null or v_email = '' then
    raise exception 'Confirm your email address first.' using errcode = '28000';
  end if;

  select * into j from public.jobs where id = p_job;
  if j.id is null then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;

  if lower(coalesce(j.client_email, '')) <> v_email then
    raise exception 'That is not your job to approve.' using errcode = '28000';
  end if;

  select exists (
    select 1 from public.disputes d
     where d.job_id = p_job and d.state <> 'resolved'
  ) into v_dispute_open;

  if v_dispute_open then
    raise exception 'A dispute is open on this job. Nothing can be approved while it is.'
      using errcode = 'check_violation';
  end if;

  v_stage := greatest(coalesce(j.stage, 0), 1);

  select jsonb_agg(
           jsonb_build_object('id', e.id, 'sha256', e.sha256, 'label', e.label, 'created_at', e.created_at)
           order by e.created_at
         ),
         count(*)
    into v_evidence, v_count
    from public.evidence e
   where e.job_id = p_job and coalesce(e.stage, 1) = v_stage;

  if coalesce(v_count, 0) = 0 then
    raise exception 'Nothing has been filed for this stage yet.' using errcode = 'check_violation';
  end if;

  insert into public.stage_approvals (job_id, stage, approved_by, evidence)
  values (p_job, v_stage, v_email, v_evidence);

  -- Advancing past the last real stage is fine: a stage nobody has filed
  -- evidence against yet simply has nothing to approve, and the ledger's
  -- own stageCount grows to meet whatever the worker actually files. This
  -- function does not decide the job is COMPLETE; nothing does yet, on
  -- purpose, because that is a bigger claim than "one stage is proven" and
  -- belongs to a later piece of work, not this one.
  update public.jobs
     set stage = v_stage + 1,
         status = 'in_progress',
         updated_at = now()
   where id = p_job;

  return query select p_job, v_stage, v_count;
end;
$$;

-- Same anon trap this repository has hit twice before (20260828b, 20260828f):
-- Supabase grants EXECUTE to anon and authenticated on every function created
-- in an exposed schema, and revoking from PUBLIC alone leaves anon's explicit
-- grant standing. Name both, every time, on anything that moves work or
-- money.
revoke execute on function public.approve_stage(text) from public, anon;
grant  execute on function public.approve_stage(text) to authenticated;
