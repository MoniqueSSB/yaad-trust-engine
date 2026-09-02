-- Found live, testing the WhatsApp booking-by-reply door for real: nothing
-- ever touches the jobs row when a job_quotes row changes underneath it,
-- and sync_job_status() only recomputes public.jobs.status on an INSERT or
-- UPDATE to jobs itself (it is a trigger on that table, not on job_quotes).
-- A quote landing, being confirmed, or reaching kickoff_requested therefore
-- left jobs.status exactly where it was computed last, most often still
-- 'open_for_quotes' from job creation, and the WhatsApp booking block
-- (yaad-inbound) filters candidates on jobs.status = 'quoted', so a client
-- replying to book could silently find no candidate job at all.
--
-- Fixed the same way this codebase already recomputes derived state: touch
-- the row, let its own BEFORE trigger do the actual work, rather than
-- duplicating sync_job_status's logic here. AFTER trigger on job_quotes,
-- one row, one UPDATE, no loop back: touching jobs never fires anything on
-- job_quotes in turn.
create or replace function public.touch_job_on_quote_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.jobs set updated_at = now() where id = new.job_id;
  return new;
end;
$function$;

drop trigger if exists trg_touch_job_on_quote_change on public.job_quotes;
create trigger trg_touch_job_on_quote_change
  after insert or update on public.job_quotes
  for each row execute function public.touch_job_on_quote_change();

-- Every job with a live quote sitting under a stale status gets recomputed
-- once, now, rather than waiting for the next unrelated touch to fix it by
-- accident. Real jobs with real stale status included: this is a read of
-- current fact (open, worker, quotes, evidence), not a guess at one.
update public.jobs set updated_at = now()
 where id in (select distinct job_id from public.job_quotes);
