-- Corrective, found live while testing the worker journey end to end on
-- JOB-TEST-WAPAY-3: sync_job_status() only ever counted payment stages
-- from an approved Kickoff Pack. A job that goes through the newer Quote
-- Pack path instead (20260902c/d) never gets a kickoff_packs row at all,
-- so final_stage_count came back null and silently fell back to the
-- generic default of 4 remaining stages, no matter what the Quote Pack
-- itself promised the client.
--
-- Confirmed live: JOB-TEST-WAPAY-3's Quote Pack promised 2 payment
-- stages (docs->'payment_stages', 30/70), the portal was showing "Stage
-- 3 of 3" from a third, independent count, and the trigger itself would
-- not have completed the job until stage 5. All three disagreed with
-- each other, and none of them were wrong on purpose.
--
-- Fix: read whichever of the two documents is actually approved for the
-- job. A Quote Pack draft stores its stages as a plain array at
-- docs->'payment_stages', not docs->'payment_schedule'->'stages' like a
-- Kickoff Pack, so the two need separate lookups, not one shared jsonb
-- path. Kickoff Pack stays the first check: a job can only ever have
-- gone through one of the two paths (20260902d), but if it ever had
-- both, the original document type keeps priority.
create or replace function public.sync_job_status()
returns trigger
language plpgsql
as $function$
declare
  has_quotes boolean;
  working_stage integer;
  has_unapproved_evidence boolean;
  final_stage_count integer;
  is_complete boolean;
  fee_paid boolean;
begin
  if new.status in ('disputed','cancelled') then
    return new;
  end if;

  select jsonb_array_length(p.docs->'payment_schedule'->'stages')
    into final_stage_count
    from public.kickoff_packs p
   where p.job_id = new.id and p.status = 'approved'
   order by p.updated_at desc
   limit 1;

  if final_stage_count is null then
    select jsonb_array_length(q.docs->'payment_stages')
      into final_stage_count
      from public.quote_pack_drafts q
     where q.job_id = new.id and q.status = 'approved'
     order by q.created_at desc
     limit 1;
  end if;

  is_complete := coalesce(new.stage, 0) >
    coalesce(final_stage_count, 5 - 1);

  if is_complete then
    new.status := 'complete';
  elsif coalesce(new.worker_email,'') <> '' then
    select exists (
      select 1 from public.invoices i
       where i.job_id = new.id and i.stage is null and i.status = 'paid'
    ) into fee_paid;

    if not fee_paid then
      new.status := 'awaiting_payment';
    else
      working_stage := greatest(coalesce(new.stage, 0), 1);
      select exists (
        select 1 from public.evidence e
         where e.job_id = new.id and coalesce(e.stage, 1) = working_stage
      ) and not exists (
        select 1 from public.stage_approvals a
         where a.job_id = new.id and a.stage = working_stage
      ) into has_unapproved_evidence;

      new.status := case when has_unapproved_evidence then 'evidence' else 'in_progress' end;
    end if;
  elsif new.open then
    select exists (select 1 from public.job_quotes q
                    where q.job_id = new.id and q.status in ('submitted', 'quote_confirmed', 'kickoff_requested'))
      into has_quotes;
    new.status := case when has_quotes then 'quoted' else 'open_for_quotes' end;
  elsif public.client_cleared_for_golive(new.client_email) then
    new.status := 'draft';
  else
    new.status := 'awaiting_client_setup';
  end if;

  return new;
end;
$function$;

-- Jobs already sitting on an approved Quote Pack get the corrected count
-- immediately, rather than waiting for their next unrelated write.
update public.jobs set updated_at = now()
 where id in (select job_id from public.quote_pack_drafts where status = 'approved');
