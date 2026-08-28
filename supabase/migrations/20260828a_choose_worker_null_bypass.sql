-- choose_worker() let an anonymous caller choose the worker on somebody
-- else's job.
--
-- The only authorisation check in the function was:
--
--     if lower(coalesce(v_job.client_email,'')) <> lower(auth.jwt()->>'email')
--
-- With no JWT, auth.jwt()->>'email' is NULL, so the comparison evaluates to
-- NULL rather than true, and plpgsql treats IF NULL as false. The exception
-- never raised and execution carried straight on. EXECUTE was also granted to
-- anon, so the whole thing was reachable at /rest/v1/rpc/choose_worker with
-- nothing but the publishable key that is printed in the page source.
--
-- A worker can read their own quote id under jq_select_own_or_admin. That was
-- enough to assign themselves to a client's job, accept their own quote and
-- decline every rival, without the client choosing anybody. The one thing this
-- product sells is that the client decides and the money follows the proof.
--
-- Not exploited: job_quotes, worker_profiles and scope_agreements are all
-- empty, and the function needs a scope agreement from both sides. This would
-- have gone live with the first pilot quote in December.
--
-- Two changes. The comparison is now NULL-safe, and the caller must present an
-- email before any of it runs. IS DISTINCT FROM is the operator that treats
-- NULL as a value rather than as an unknown that swallows the test.

create or replace function public.choose_worker(p_job text, p_quote uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_job   jobs%rowtype;
  v_quote job_quotes%rowtype;
  v_email text := lower(nullif(btrim(auth.jwt()->>'email'), ''));
begin
  -- Fail closed before anything is read. An anonymous caller has no business
  -- here at all, and saying so plainly beats relying on a comparison further
  -- down to notice.
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

-- Belt as well as braces. Nothing anonymous should be able to reach a function
-- that reassigns work and money, whatever the body says.
revoke execute on function public.choose_worker(text, uuid) from anon;

-- provider_email() handed the admin address to anybody who asked.
revoke execute on function public.provider_email() from anon;
