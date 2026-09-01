-- accept_quote_as_me() is the no-account /jobs/[id]/quotes page's own path
-- to booking a worker, a second implementation of what choose_worker() and
-- choose_worker_via_whatsapp() both ultimately do through
-- _do_choose_worker(). It only ever set jobs.worker_email. worker_name,
-- worker_user and stage were left exactly as they were, so a job booked
-- through this specific page sat with a worker_email but no worker_name, no
-- worker_user, and stage still 0, correct nowhere the rest of the system
-- reads those fields: the kickoff pack poller, the stage rail, evidence
-- filed against a stage. sync_job_status() still moved status to
-- 'in_progress' off worker_email alone, which is exactly what made this
-- look fine on the surface and be wrong underneath.
--
-- Found live, 1 Sep 2026, testing a real booking on a real job: the pack
-- generated (job_id and descr were enough for that), but the job's own
-- record of who was doing the work was half written.
--
-- Fixed to set the same fields _do_choose_worker() sets, from the same
-- quote row. The scope_agreements gate _do_choose_worker() enforces is
-- deliberately NOT added here: the founder's own description of the
-- intended flow, same session, is quote then acceptance then a kickoff
-- pack the two sides align on, with no separate scope-agreement step
-- before acceptance. Whether _do_choose_worker()'s own gate should still
-- exist is a separate, not yet settled question and is not decided by
-- this migration either way; this fixes the missing fields only.
create or replace function public.accept_quote_as_me(p_quote uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare q record; j record; me text;
begin
  me := lower(coalesce(auth.jwt() ->> 'email', ''));
  if me = '' then raise exception 'You need to be signed in to accept a quote.'; end if;

  select * into q from job_quotes where id = p_quote;
  if q is null then raise exception 'That quote no longer exists.'; end if;

  select * into j from jobs where id = q.job_id;
  if j is null then raise exception 'That job no longer exists.'; end if;

  if lower(coalesce(j.client_email,'')) <> me then
    raise exception 'That is not your job to book.';
  end if;

  if coalesce(j.worker_email,'') <> '' then
    raise exception 'This job already has a worker on it. Talk to Yaadly before changing that.';
  end if;

  perform set_config('yaadly.choosing', '1', true);
  update job_quotes set status = 'accepted', updated_at = now() where id = p_quote;
  update job_quotes set status = 'declined', updated_at = now()
   where job_id = q.job_id and id <> p_quote and status = 'submitted';
  update jobs set worker_email = q.worker_email,
                  worker_name  = q.worker_name,
                  worker_user  = q.worker_user,
                  stage = 1,
                  updated_at = now()
   where id = q.job_id;
  perform set_config('yaadly.choosing', '', true);

  return q.job_id;
end;
$function$;
