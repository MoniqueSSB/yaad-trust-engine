-- Flagged earlier the same night, now fixed at the founder's own request:
-- "the job till completion because i want to see if there are any other
-- bugs." sync_job_status() only ever completed a job at stage >= 5,
-- with no connection to how many payment stages that job's own Kickoff
-- Pack actually defines. A small job's pack, correctly, defines however
-- many stages the work actually has - JOB-TEST-REAL-WA's own pack has 2 -
-- and could never reach 'complete' through ordinary approvals: nobody
-- would ever legitimately file a 3rd, 4th or 5th stage of evidence for
-- work that only ever had two.
--
-- Fixed to read the job's own approved pack, when one exists:
-- payment_schedule.stages, the same jsonb array packPaymentStages()
-- already reads client-side for the stage rail. _do_approve_stage()
-- advances jobs.stage to (approved stage + 1), so completion is
-- new.stage > that count - true exactly once the LAST real stage has
-- been approved, never before. A job with no approved pack (booked
-- before this system existed, or never got one) keeps the original
-- stage >= 5 fallback rather than changing behaviour nothing asked to
-- change.

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

  is_complete := coalesce(new.stage, 0) >
    coalesce(final_stage_count, 5 - 1);
  -- final_stage_count is the real number of payment stages once a pack
  -- exists; the legacy fallback keeps the exact original threshold
  -- (stage >= 5) by comparing against 5 - 1 = 4 the same way.

  if is_complete then
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
                    where q.job_id = new.id and q.status in ('submitted', 'kickoff_requested'))
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
