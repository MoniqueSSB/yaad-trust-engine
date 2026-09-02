-- Reapplies 20260902g on top of a newer version of sync_job_status() that
-- landed after it (the agency-fee-first restructure, ahead of what
-- 20260902f's own file on disk shows, found live rather than assumed).
-- 20260902g's fix, the quote_pack_drafts fallback for final_stage_count,
-- had been silently dropped by that newer version going back to reading
-- kickoff_packs only. Two sessions working this branch at once; nobody's
-- change was wrong on its own, they just landed on top of each other.
--
-- This changes exactly one thing versus the version it replaces: the
-- final_stage_count lookup now falls through to an approved Quote Pack
-- draft when no approved Kickoff Pack exists, same as 20260902g. The
-- fee-paid-first early return, the coalesce(final_stage_count, 1) default,
-- and everything else here is preserved exactly as found live, not
-- relitigated.
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

  if coalesce(new.worker_email,'') <> '' then
    select exists (
      select 1 from public.invoices i
       where i.job_id = new.id and i.stage is null and i.status = 'paid'
    ) into fee_paid;

    if not fee_paid then
      new.status := 'awaiting_payment';
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

    is_complete := coalesce(new.stage, 0) > coalesce(final_stage_count, 1);

    if is_complete then
      new.status := 'complete';
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

update public.jobs set updated_at = now()
 where id in (select job_id from public.quote_pack_drafts where status = 'approved');
