-- The evidence-flips-to-awaiting-approval trigger from the previous migration
-- never worked, and testing it is what found out. jobs already has
-- sync_job_status(), a BEFORE INSERT OR UPDATE trigger that recomputes
-- status from scratch on every write and knew nothing about 'evidence'. It
-- ran after my trigger's UPDATE on the same statement and silently reset
-- status back to 'in_progress' every time. Two triggers deciding the same
-- column is exactly the shape that looks like it works in a code read and
-- does nothing in a database.
--
-- Fixed by giving sync_job_status the one more fact it needs, rather than
-- adding a second authority beside it. It already recomputes status from
-- stage, worker_email and open on every write; it now also checks whether
-- the stage being worked has evidence filed against it with no approval yet.
create or replace function public.sync_job_status()
returns trigger
language plpgsql
as $$
declare
  has_quotes boolean;
  working_stage integer;
  has_unapproved_evidence boolean;
begin
  if new.status in ('disputed','cancelled') then
    return new;
  end if;

  if coalesce(new.stage,0) >= 5 then
    new.status := 'complete';
  elsif coalesce(new.worker_email,'') <> '' then
    working_stage := greatest(coalesce(new.stage, 0), 1);
    select exists (
      select 1 from public.evidence e
       where e.job_id = new.id and coalesce(e.stage, 1) = working_stage
    ) and not exists (
      select 1 from public.stage_approvals a
       where a.job_id = new.id and a.stage = working_stage
    ) into has_unapproved_evidence;

    new.status := case when has_unapproved_evidence then 'evidence' else 'in_progress' end;
  elsif new.open then
    select exists (select 1 from public.job_quotes q
                    where q.job_id = new.id and q.status = 'submitted')
      into has_quotes;
    new.status := case when has_quotes then 'quoted' else 'open_for_quotes' end;
  elsif public.client_cleared_for_golive(new.client_email) then
    new.status := 'draft';
  else
    new.status := 'awaiting_client_setup';
  end if;

  return new;
end;
$$;

-- Evidence is a different table, so filing a photo never touches the jobs
-- row on its own and sync_job_status never runs. This trigger's only job now
-- is to poke the row so that recompute happens; it does not decide status
-- itself, which is what the previous version of this migration got wrong.
create or replace function public.poke_job_on_evidence_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.jobs set updated_at = now() where id = new.job_id;
  return new;
end;
$$;

drop trigger if exists trg_evidence_marks_awaiting_approval on public.evidence;
create trigger trg_evidence_marks_awaiting_approval
  after insert on public.evidence
  for each row execute function public.poke_job_on_evidence_insert();
