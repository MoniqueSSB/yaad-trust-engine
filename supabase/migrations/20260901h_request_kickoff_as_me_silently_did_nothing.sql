-- Caught live, running the actual multi-quote test this evening's other
-- two migrations were built for: request_kickoff_as_me() reported success
-- and returned the job id every time, but job_quotes.status never actually
-- moved to 'kickoff_requested'. Confirmed directly - called it, then
-- selected the row straight back - updated_at moved, status did not.
--
-- job_quotes_touch() (BEFORE UPDATE) exists specifically so a non-admin
-- caller can never move a quote into an admin-only state except through
-- choose_worker(), which marks itself with a transaction-local flag,
-- yaadly.choosing, before it touches status. Every status-changing
-- function written before tonight sets that flag around its own update:
-- _do_choose_worker(), the retired accept_quote_as_me() (RUNBOOK already
-- documents this exact failure shape happening to that function before 31
-- Aug 2026, for the identical reason). request_kickoff_as_me(), written
-- fresh tonight in 20260901f, never got it, so the trigger silently put
-- 'kickoff_requested' back to 'submitted' on every single call, and the
-- RPC had no way to know its own write had been reverted underneath it.
--
-- Every quote requested through the live app so far tonight is affected:
-- reset below alongside the fix, rather than leaving them stuck on
-- 'submitted' with a client who believes they already asked.

create or replace function public.request_kickoff_as_me(p_quote uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare q record; j record; me text;
begin
  me := lower(coalesce(auth.jwt() ->> 'email', ''));
  if me = '' then raise exception 'You need to be signed in to do that.'; end if;

  select * into q from job_quotes where id = p_quote;
  if q is null then raise exception 'That quote no longer exists.'; end if;

  select * into j from jobs where id = q.job_id;
  if j is null then raise exception 'That job no longer exists.'; end if;

  if lower(coalesce(j.client_email,'')) <> me then
    raise exception 'That is not your job.';
  end if;

  if coalesce(j.worker_email,'') <> '' then
    raise exception 'This job already has a worker on it. Talk to Yaadly before changing that.';
  end if;

  if q.status <> 'submitted' then
    raise exception 'That price is not open to request a Kickoff Pack for.';
  end if;

  perform set_config('yaadly.choosing', '1', true);
  update job_quotes set status = 'kickoff_requested', updated_at = now() where id = p_quote;
  perform set_config('yaadly.choosing', '', true);

  return q.job_id;
end;
$function$;

update public.job_quotes
   set status = 'kickoff_requested', updated_at = now()
 where status = 'submitted'
   and exists (
     select 1 from public.kickoff_drafts d
      where d.quote_id = job_quotes.id
   );
