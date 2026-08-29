-- A job that came in on WhatsApp could never be claimed.
--
-- Reported live: a real client described a job on WhatsApp, got job card
-- JOB-WA-1787995411470 and code 44188B, followed the link, and was told "that
-- code and email do not match a job we hold". The code was right. The email
-- was right. The job was there.
--
-- verify_portal_code() asks for a row where BOTH portal_code and client_email
-- match. WhatsApp intake has a phone number and never an email: the intake
-- agent is told to leave client_email empty unless the client happened to
-- type one into a chat message, which nobody does. So the webhook writes
-- client_email '' and the row can never satisfy the check. Every WhatsApp job
-- was born unclaimable. Four of the four on the database are in that state,
-- and the same is true of nine of ten jobs overall.
--
-- The gate itself is right and stays: the portal is not open sign-up. What
-- was wrong is treating the email as something we already hold. For a job
-- nobody has claimed, the code IS the credential, and claiming it is the
-- moment the client's email gets attached. That attachment is also what makes
-- the job visible: every portal policy matches lower(client_email) against
-- the signed-in email, so an unbound job stays invisible even to an account
-- that exists.
--
-- First claim wins. Once a code is bound to an email, only that email gets
-- back in, which is the old behaviour exactly.

-- 1. Throttle by code, not only by email --------------------------------
-- The old limiter counted failures per email. That was enough while the
-- attacker had to know the email already on the job. It is not enough now
-- that a code alone can claim an unbound job: rotating the email resets the
-- counter and the same code can be guessed for free. Count both sides.

alter table public.portal_code_attempts add column if not exists code text;

create index if not exists portal_code_attempts_email_recent
  on public.portal_code_attempts (lower(email), attempted_at desc);
create index if not exists portal_code_attempts_code_recent
  on public.portal_code_attempts (upper(code), attempted_at desc);

-- 2. Claiming ------------------------------------------------------------

create or replace function public.claim_portal_code(p_email text, p_code text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email      text := lower(btrim(coalesce(p_email, '')));
  v_code       text := upper(btrim(coalesce(p_code, '')));
  v_fail_email int;
  v_fail_code  int;
  v_unclaimed  int;
  v_hit        int := 0;
  v_ok         boolean := false;
begin
  if v_email = '' or v_code = '' then
    return false;
  end if;

  select count(*) into v_fail_email
  from public.portal_code_attempts
  where lower(email) = v_email
    and success = false
    and attempted_at > now() - interval '15 minutes';

  select count(*) into v_fail_code
  from public.portal_code_attempts
  where upper(code) = v_code
    and success = false
    and attempted_at > now() - interval '15 minutes';

  if v_fail_email >= 5 or v_fail_code >= 5 then
    insert into public.portal_code_attempts (email, code, success)
    values (p_email, v_code, false);
    return false;
  end if;

  -- Already bound to this person. Signing up again after an account is
  -- deleted, or simply pressing the button twice, still works.
  select exists (
           select 1 from public.jobs
           where lower(client_email) = v_email and upper(portal_code) = v_code
         ) or exists (
           select 1 from public.services
           where lower(client_email) = v_email and upper(portal_code) = v_code
         )
  into v_ok;

  -- Nobody has claimed it. This is the WhatsApp case.
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

    -- Codes are random and carry no cross-table uniqueness constraint. If one
    -- ever lands on two unclaimed rows, which job the client meant is not a
    -- guess this function should be making. Refuse and let a human sort it.
    if v_unclaimed = 1 then
      -- The WHERE clause is the lock. Under READ COMMITTED a second claimer
      -- re-reads the row after the first commits, finds client_email no longer
      -- empty, matches nothing, and updates nothing.
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

  insert into public.portal_code_attempts (email, code, success)
  values (p_email, v_code, v_ok);

  return v_ok;
end;
$$;

-- 3. Only the service role may ask ---------------------------------------
-- verify_portal_code was executable by anon, so the rate-limited guess could
-- be made straight against PostgREST with the publishable key, without going
-- anywhere near the edge function. That was already too generous. It is not
-- survivable once a correct guess binds a job, so both are closed to
-- everything except the service role that yaad-portal-signup runs as.

revoke all on function public.claim_portal_code(text, text) from public, anon, authenticated;
grant execute on function public.claim_portal_code(text, text) to service_role;

revoke all on function public.verify_portal_code(text, text) from public, anon, authenticated;
grant execute on function public.verify_portal_code(text, text) to service_role;

-- 4. Longer codes from here on -------------------------------------------
-- Six hex characters is 16.7 million, and a code is now sufficient on its own
-- to claim an unclaimed job. Per-code throttling stops anyone hammering one
-- code, but not a broad sweep. Eight characters costs the client two more
-- keystrokes in the rare case they type it instead of following the link, and
-- multiplies a sweep by 256. Codes already issued keep working: they are data,
-- not a default.

alter table public.jobs
  alter column portal_code
  set default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

alter table public.services
  alter column portal_code
  set default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
