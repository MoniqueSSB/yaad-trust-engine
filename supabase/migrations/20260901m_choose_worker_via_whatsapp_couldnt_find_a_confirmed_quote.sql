-- Caught live, the exact test the founder asked for tonight: booking a
-- worker by WhatsApp reply, after tonight's Kickoff Pack rework, threw
-- "No price is open on this job to accept." every time, on a job whose
-- quote was fully confirmed on both sides and genuinely ready to book.
--
-- Two compounding faults, both flagged as a known risk in this migration's
-- own predecessor (20260901f) and not decided then; deciding them now
-- because they block the thing actually being tested.
--
-- 1. This function only ever looked for job_quotes.status = 'submitted'.
--    By the time a Kickoff Pack exists and is confirmed, the quote has
--    long since moved to 'kickoff_requested' (20260901f) - 'submitted'
--    describes a quote nobody has asked anything of yet. The door was
--    looking for a state that can never coexist with being ready to book.
--
-- 2. Even with that fixed, the function's own readiness pre-check wrote
--    to and read from scope_agreements, the mechanism _do_choose_worker()
--    stopped reading the moment its gate became the Kickoff Pack's
--    both_confirmed_at (20260901f). Nobody writes scope_agreements in the
--    new flow, so this pre-check would always find the worker "not
--    ready" and return PENDING_WORKER_SCOPE - not a refusal that reaches
--    the real gate and explains itself, but a confidently wrong answer
--    that never asks the real gate at all. The prior migration's own
--    comment predicted this would "fail open... caught one call
--    further in"; it does not, because the wrong branch returns before
--    that call is ever made. Removed. _do_choose_worker() is now the
--    only source of truth this function defers to, same as its portal
--    and code-reply siblings; if the pack is not confirmed, its own
--    exception message is what the client sees, which is honest about
--    what is actually being waited on.

create or replace function public.choose_worker_via_whatsapp(p_job text, p_phone text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  j record;
  v_tail text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9);
  v_count integer;
  v_quote uuid;
begin
  if length(v_tail) < 7 then
    raise exception 'No usable phone number.';
  end if;

  select * into j from public.jobs where id = p_job;
  if j.id is null then
    raise exception 'No such job.';
  end if;

  if right(regexp_replace(coalesce(j.client_phone, ''), '\D', '', 'g'), 9) <> v_tail then
    raise exception 'That number is not on record for this job.';
  end if;

  select count(*), (array_agg(id))[1]
    into v_count, v_quote
    from public.job_quotes
   where job_id = p_job and status in ('submitted', 'kickoff_requested');

  if coalesce(v_count, 0) = 0 then
    raise exception 'No price is open on this job to accept.';
  end if;

  if v_count > 1 then
    raise exception 'More than one price is open on this job. Use the link to choose.';
  end if;

  return public._do_choose_worker(p_job, v_quote);
end;
$function$;
