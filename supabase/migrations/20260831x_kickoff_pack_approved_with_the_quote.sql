-- "Approving is what lets it reach a client" has been sitting in the desk's
-- own copy since the Kickoff Pack view was built, describing a button that
-- was never wired to anything. Nothing anywhere set kickoff_packs.status to
-- 'approved'. Every pack, forever, was invisible to every client: the
-- portal's own /pack page already reads the row correctly and RLS already
-- refuses it correctly (parties_read_approved_packs, status = 'approved'
-- and the job matches their email) - the one door in simply had no handle.
--
-- Founder's instruction, 31 Aug 2026: the pack is approved at the same
-- moment the client accepts a quote, not as a separate admin click. That is
-- choose_worker(), so the approval goes there, in the same transaction as
-- assigning the worker: one decision, one commit, both sides of it land
-- together or neither does.
--
-- Choosing a worker now requires a drafted pack to exist for the job. A
-- client who chooses before one is written gets told plainly why, rather
-- than being let through to a job with no scope, no payment structure and
-- no evidence checklist behind it.
create or replace function public.choose_worker(p_job text, p_quote uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_job   jobs%rowtype;
  v_quote job_quotes%rowtype;
  v_pack  kickoff_packs%rowtype;
  v_email text := lower(nullif(btrim(auth.jwt()->>'email'), ''));
begin
  if v_email is null then
    raise exception 'Sign in as the client of this job to choose a worker.'
      using errcode = '28000';
  end if;

  select * into v_job from jobs where id = p_job for update;
  if not found then raise exception 'no such job'; end if;

  if lower(coalesce(v_job.client_email,'')) is distinct from v_email then
    raise exception 'only the client of this job may choose';
  end if;

  if coalesce(v_job.worker_email,'') <> '' then
    raise exception 'a worker is already chosen on this job';
  end if;

  select * into v_quote from job_quotes where id = p_quote and job_id = p_job;
  if not found then raise exception 'that quote is not on this job'; end if;

  if not exists (select 1 from scope_agreements where job_id = p_job and side = 'client') then
    raise exception 'choose unlocks when both have agreed the scope';
  end if;
  if not exists (select 1 from scope_agreements sa where sa.job_id = p_job and sa.side = 'worker'
                 and lower(sa.email) = lower(v_quote.worker_email)) then
    raise exception 'choose unlocks when both have agreed the scope';
  end if;

  -- The Kickoff Pack, approved in the same breath as the worker is chosen.
  -- Locked with the same FOR UPDATE discipline as the job row above: two
  -- quotes cannot both race this pack to approved.
  select * into v_pack from kickoff_packs where job_id = p_job
   order by updated_at desc limit 1 for update;
  if not found or v_pack.docs is null then
    raise exception 'This job has no Kickoff Pack drafted yet. Write one before a worker can be chosen.'
      using errcode = 'check_violation';
  end if;
  if v_pack.status <> 'approved' then
    update kickoff_packs
       set status = 'approved', approved_by = v_email, approved_at = now(), updated_at = now()
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
end $function$;

-- create or replace preserves prior grants, but named explicitly anyway:
-- the standing rule in this repository (20260828a, 20260828b, 20260828f)
-- is that a function moving work or money never trusts an implicit grant to
-- have survived, on anything that touches this file.
revoke execute on function public.choose_worker(text, uuid) from anon;
grant  execute on function public.choose_worker(text, uuid) to authenticated;
