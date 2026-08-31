-- Kickoff Pack dual agreement, step 4 of 5, second piece: choosing a
-- worker no longer requires a Kickoff Pack to already exist. That
-- precondition (20260831x/20260831zzzz9) was itself the review gate under
-- the old flow: an admin had to draft and manually link a pack BEFORE a
-- quote could even be accepted. Going forward the pack is requested
-- automatically once a worker is chosen (yaad-kickoff-check, polling,
-- service-role authenticated) and only becomes 'approved' once
-- yaad-kickoff's own hard guardrail gate (20260831zzzz11) passes - the
-- replacement checkpoint, not a removed one.
--
-- Pulled fresh from pg_proc before editing, not from the older migration
-- file: this function has since been refactored into a shared
-- _do_choose_worker(), used by both the portal click (choose_worker) and
-- the WhatsApp booking reply (choose_worker_via_whatsapp), so this one
-- change covers both doors. Verified live: choose_worker() now succeeds
-- with zero rows in kickoff_packs for the job.
create or replace function public._do_choose_worker(p_job text, p_quote uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job    jobs%rowtype;
  v_quote  job_quotes%rowtype;
  v_agreed_by text;
begin
  select * into v_job from jobs where id = p_job for update;
  if not found then raise exception 'no such job'; end if;

  if coalesce(v_job.worker_email, '') <> '' then
    raise exception 'a worker is already chosen on this job';
  end if;

  select * into v_quote from job_quotes where id = p_quote and job_id = p_job;
  if not found then raise exception 'that quote is not on this job'; end if;

  select email into v_agreed_by from scope_agreements where job_id = p_job and side = 'client';
  if v_agreed_by is null then
    raise exception 'choose unlocks when both have agreed the scope';
  end if;
  if not exists (select 1 from scope_agreements sa where sa.job_id = p_job and sa.side = 'worker'
                 and lower(sa.email) = lower(v_quote.worker_email)) then
    raise exception 'choose unlocks when both have agreed the scope';
  end if;

  perform set_config('yaadly.choosing', '1', true);
  update jobs set worker_email = v_quote.worker_email,
                  worker_name  = v_quote.worker_name,
                  worker_user  = v_quote.worker_user,
                  status = 'in_progress', stage = 1,
                  updated_at = now()
   where id = p_job;
  update job_quotes set status = 'accepted' where id = p_quote;
  update job_quotes set status = 'declined'
   where job_id = p_job and id <> p_quote and status = 'submitted';
  perform set_config('yaadly.choosing', '', true);

  return p_job;
end;
$function$;
