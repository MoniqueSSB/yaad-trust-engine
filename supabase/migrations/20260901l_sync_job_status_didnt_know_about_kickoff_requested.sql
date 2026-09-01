-- Caught live, setting up the WhatsApp booking test: a job with a quote
-- sitting at 'kickoff_requested' still read status = 'open_for_quotes'
-- ("Open for quotes") rather than 'quoted' ("Quotes in, waiting on you"),
-- because sync_job_status()'s own has_quotes check only ever looked for
-- status = 'submitted'. 'kickoff_requested' is new tonight (20260901f)
-- and this trigger was never told about it.
--
-- Not just a wrong label. choose_worker_via_whatsapp()'s own candidate
-- query in yaad-inbound filters jobs.status = 'quoted' directly, so a
-- job whose only live quote had already moved to 'kickoff_requested' -
-- which is every job actually mid-flow through tonight's own rework -
-- was invisible to the WhatsApp booking door entirely.

create or replace function public.sync_job_status()
 returns trigger
 language plpgsql
as $function$
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
