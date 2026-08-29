-- A client who already has an account could not claim a job code at all.
--
-- 20260829c moved binding onto the confirmation click, which is right for
-- somebody signing up for the first time. It quietly assumed every claim comes
-- with a signup. It does not. The founder hit this within the hour: an account
-- from 12 August, already confirmed, a new WhatsApp job to claim, and no route
-- to claim it. Signup refuses, correctly, because the account exists. Nothing
-- else was listening.
--
-- That is not an edge case, it is the second job every returning client ever
-- has, and every one of them would have hit it.
--
-- The confirmation click was never the point. Proving the mailbox was. Somebody
-- signed in on a confirmed account has already proved it, more recently and
-- more strongly than a link in an old email. So they can bind directly.

create or replace function public.claim_code_as_me(p_code text)
returns boolean
language plpgsql
security definer
set search_path to 'public, auth'
as $$
declare
  v_email      text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_code       text := upper(btrim(coalesce(p_code, '')));
  v_confirmed  boolean;
  v_fail_email int;
  v_fail_code  int;
  v_unclaimed  int;
  v_hit        int := 0;
  v_ok         boolean := false;
begin
  if v_email = '' or v_code = '' then return false; end if;

  -- Signed in is not sufficient on its own. An unconfirmed account is exactly
  -- the thing the pend-then-bind flow is holding at arm's length, and it must
  -- not be possible to walk around that by signing in.
  select (email_confirmed_at is not null) into v_confirmed
  from auth.users where lower(email) = v_email limit 1;
  if not coalesce(v_confirmed, false) then return false; end if;

  -- Same limiter as pend_portal_code, and it has to be here too: an account is
  -- cheap, so without this the signed-in route would be the soft way to guess
  -- codes that the signup route refuses to be.
  select count(*) into v_fail_email
  from public.portal_code_attempts
  where lower(email) = v_email and success = false
    and attempted_at > now() - interval '15 minutes';

  select count(*) into v_fail_code
  from public.portal_code_attempts
  where upper(code) = v_code and success = false
    and attempted_at > now() - interval '15 minutes';

  if v_fail_email >= 5 or v_fail_code >= 5 then
    insert into public.portal_code_attempts (email, code, success)
    values (v_email, v_code, false);
    return false;
  end if;

  -- Already theirs. Pressing the button twice is not a failure.
  select exists (
           select 1 from public.jobs
           where lower(client_email) = v_email and upper(portal_code) = v_code
         ) or exists (
           select 1 from public.services
           where lower(client_email) = v_email and upper(portal_code) = v_code
         )
  into v_ok;

  if not v_ok then
    select (
             select count(*) from public.jobs
             where upper(portal_code) = v_code
               and coalesce(btrim(client_email), '') = ''
           ) + (
             select count(*) from public.services
             where upper(portal_code) = v_code
               and coalesce(btrim(client_email), '') = ''
           )
    into v_unclaimed;

    if v_unclaimed = 1 then
      with claimed as (
        update public.jobs set client_email = v_email
        where upper(portal_code) = v_code
          and coalesce(btrim(client_email), '') = ''
        returning 1
      )
      select count(*) into v_hit from claimed;

      if v_hit = 0 then
        with claimed as (
          update public.services set client_email = v_email
          where upper(portal_code) = v_code
            and coalesce(btrim(client_email), '') = ''
          returning 1
        )
        select count(*) into v_hit from claimed;
      end if;

      v_ok := (v_hit = 1);
    end if;
  end if;

  -- Spend any pending claim this person left on the same code, so a signup
  -- attempt that failed on the way here does not sit around waiting to fire.
  if v_ok then
    update public.portal_claims set consumed_at = now()
    where lower(email) = v_email and upper(code) = v_code and consumed_at is null;
  end if;

  insert into public.portal_code_attempts (email, code, success)
  values (v_email, v_code, v_ok);

  return v_ok;
end;
$$;

revoke all on function public.claim_code_as_me(text) from public;
revoke all on function public.claim_code_as_me(text) from anon;
grant execute on function public.claim_code_as_me(text) to authenticated;
grant execute on function public.claim_code_as_me(text) to service_role;
