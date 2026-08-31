-- Two doors drifted apart, found while merging, not while looking for it.
-- Between this branch's own work and origin/main, choose_worker() picked up
-- a real new requirement: a worker cannot be chosen at all until the job's
-- Kickoff Pack is drafted, approved in the same transaction as the choice.
-- Whoever wrote that extended choose_worker() directly, correctly reading
-- its live source first rather than overwriting it (the scope agreement
-- checks from this branch's own earlier work are still there, intact) --
-- but choose_worker() had, by then, drifted away from calling
-- _do_choose_worker() at all, back into its own full copy of the mutation
-- logic. So the new gate landed only in the portal's door.
-- choose_worker_via_whatsapp(), which calls _do_choose_worker() precisely
-- so a change to booking rules only has to happen once, never got it: a
-- client could have booked a worker over WhatsApp with no Kickoff Pack
-- drafted at all, the exact bypass this repository has spent today
-- avoiding on every other pair of doors onto the same decision.
--
-- Fixed by restoring the actual shared-core shape rather than patching
-- both copies again: the Kickoff Pack gate moves into _do_choose_worker(),
-- and choose_worker() goes back to being a thin wrapper, auth and
-- ownership only, exactly the pattern approve_stage()/_do_approve_stage()
-- already proves out. The Kickoff Pack's own approved_by needs an
-- identity, and neither caller has a uniform one to hand it (a portal
-- session has an email, the WhatsApp path only ever proved a phone
-- number): read back the client's own scope_agreements.email instead,
-- which by this point in the function is guaranteed to exist and already
-- carries whichever identity that specific door actually proved, an
-- authenticated email for the portal, `whatsapp:+<tail>` for a text reply.

create or replace function public._do_choose_worker(p_job text, p_quote uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_job    jobs%rowtype;
  v_quote  job_quotes%rowtype;
  v_pack   kickoff_packs%rowtype;
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

  select * into v_pack from kickoff_packs where job_id = p_job
   order by updated_at desc limit 1 for update;
  if not found or v_pack.docs is null then
    raise exception 'This job has no Kickoff Pack drafted yet. Write one before a worker can be chosen.'
      using errcode = 'check_violation';
  end if;
  if v_pack.status <> 'approved' then
    update kickoff_packs
       set status = 'approved', approved_by = v_agreed_by, approved_at = now(), updated_at = now()
     where id = v_pack.id;
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
$$;

revoke all on function public._do_choose_worker(text, uuid) from public, anon, authenticated;

-- Back to a thin wrapper: auth and ownership, nothing else. Everything
-- past establishing "this is genuinely the job's client" lives in
-- _do_choose_worker again.
create or replace function public.choose_worker(p_job text, p_quote uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := lower(nullif(btrim(auth.jwt()->>'email'), ''));
  v_client_email text;
begin
  if v_email is null then
    raise exception 'Sign in as the client of this job to choose a worker.'
      using errcode = '28000';
  end if;

  select lower(coalesce(client_email, '')) into v_client_email from jobs where id = p_job;
  if v_client_email is null then raise exception 'no such job'; end if;
  if v_client_email is distinct from v_email then
    raise exception 'only the client of this job may choose';
  end if;

  perform public._do_choose_worker(p_job, p_quote);
end;
$$;
