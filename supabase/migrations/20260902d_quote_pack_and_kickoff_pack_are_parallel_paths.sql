-- Corrective, minutes after 20260902c: the Quote Pack path was built as a
-- gate IN FRONT of the Kickoff Pack instead of an ALTERNATIVE beside it.
-- Found live, checking the portal UI that already existed for this
-- ("Get a Kickoff Pack for this price" at q.status = 'submitted',
-- web/app/portal/(gated)/jobs/[id]/page.tsx) only after 20260902c had
-- already shipped: request_kickoff_as_me() now required 'quote_confirmed',
-- which nothing in that existing, working button ever produces, so the
-- button would have started failing for every quote sitting at 'submitted'.
--
-- The founder's actual words: "they dont have to use it, the kick off
-- pack, if they are happy with the agreement they already have." That is
-- an alternative route to booking, not a precondition on the existing one.
-- request_kickoff_as_me() reverts to its original guard. _do_choose_worker()
-- now accepts either a confirmed quote (the new, lighter path) or a
-- confirmed Kickoff Pack (the original path, unchanged), branching on
-- which one the quote actually went through rather than requiring both.

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

create or replace function public._do_choose_worker(p_job text, p_quote uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job    jobs%rowtype;
  v_quote  job_quotes%rowtype;
  v_pack_confirmed timestamptz;
begin
  select * into v_job from jobs where id = p_job for update;
  if not found then raise exception 'no such job'; end if;

  if coalesce(v_job.worker_email, '') <> '' then
    raise exception 'a worker is already chosen on this job';
  end if;

  select * into v_quote from job_quotes where id = p_quote and job_id = p_job;
  if not found then raise exception 'that quote is not on this job'; end if;

  if v_quote.status = 'quote_confirmed' then
    -- The lighter path: both sides agreed the quote itself over WhatsApp,
    -- no Kickoff Pack ever requested. Nothing further to check.
    null;
  elsif v_quote.status = 'kickoff_requested' then
    -- The original path: a Kickoff Pack was asked for, so IT is what has
    -- to be mutually confirmed, unchanged from before 20260902c.
    select both_confirmed_at into v_pack_confirmed
      from kickoff_packs
     where job_id = p_job and quote_id = p_quote
     order by created_at desc
     limit 1;
    if v_pack_confirmed is null then
      raise exception 'choose unlocks once this worker''s Kickoff Pack is confirmed by both sides';
    end if;
  else
    raise exception 'choose unlocks once both sides confirm the price, or once a requested Kickoff Pack is confirmed by both sides';
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
   where job_id = p_job and id <> p_quote and status in ('submitted', 'quote_confirmed', 'kickoff_requested');
  perform set_config('yaadly.choosing', '', true);

  return p_job;
end;
$function$;
