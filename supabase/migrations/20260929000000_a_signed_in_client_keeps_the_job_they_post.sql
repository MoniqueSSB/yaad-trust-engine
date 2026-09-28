-- A signed-in client keeps the job they post, 29 September 2026.
--
-- Found 28 Sep 2026: a job posted from the website by somebody who already
-- had a portal account never reached their portal. The job form saves the job
-- anonymously (yaad-post-job, draft mode, no personal data) and sends the
-- contact details separately (yaad-enquiry), so the only thing that ever joins
-- the two is the "Set up my portal" link on the confirmation screen, which
-- carries the job's code. Somebody who is already signed in has no reason to
-- click a link that says "set up", and did not.
--
-- Founder decision, 28 Sep 2026 ("do it now"): when the person posting is
-- already signed in, with the same email they typed on the form, the job joins
-- their portal there and then.
--
-- WHY THIS IS SAFE. It is exactly the join link's path, called by somebody who
-- has already proved everything the link asks them to prove:
--   * the session is a signed-in portal account with a CONFIRMED email, the
--     same condition bind_my_portal_claims() applies;
--   * the caller holds the job id AND its portal code, which only the browser
--     that created the draft was ever given;
--   * the claim goes through pend_portal_code(), so the same failed attempt
--     limits apply (five a quarter hour per email and per code) and a job that
--     already has a client can never be taken;
--   * it binds through bind_confirmed_portal_claims(), the function the join
--     link already uses, so there is no second way to write client_email.
-- The form only calls it when the email typed on the form matches the
-- signed-in account. That check is in the browser and is a courtesy, not the
-- control: the control is that the job goes to the signed-in, confirmed
-- account and to no other address.

create or replace function public.claim_my_posted_job(p_job text, p_code text)
returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_code  text := upper(btrim(coalesce(p_code, '')));
begin
  if v_uid is null then
    raise exception 'Sign in to your portal first.' using errcode = '28000';
  end if;

  select lower(btrim(u.email)) into v_email
    from auth.users u
   where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null or v_email = '' then
    return false;
  end if;

  -- The code must belong to the job named, not merely to some job.
  if v_code = '' or not exists (
       select 1 from public.jobs
        where id = btrim(coalesce(p_job, '')) and upper(portal_code) = v_code
     ) then
    insert into public.portal_code_attempts (email, code, success) values (v_email, v_code, false);
    return false;
  end if;

  if not public.pend_portal_code(v_email, v_code) then
    return false;
  end if;

  perform public.bind_confirmed_portal_claims(v_email);

  return exists (
    select 1 from public.jobs
     where id = btrim(p_job) and lower(client_email) = v_email
  );
end;
$$;

comment on function public.claim_my_posted_job(text, text) is
  'A signed-in, confirmed client claims the job they just posted, by its id and portal code, through the same pend and bind the join link uses. Never takes a job that already has a client.';

revoke all on function public.claim_my_posted_job(text, text) from public, anon;
grant execute on function public.claim_my_posted_job(text, text) to authenticated;
