-- Prove the mailbox before the job moves.
--
-- 20260829b fixed the blocker: a WhatsApp job carries no email, so the code
-- alone had to be enough to claim it, and the email typed at signup got bound
-- to the job there and then. That unblocked real clients, and it left one
-- thing I flagged and Monique pushed back on, correctly.
--
-- Binding at signup trusts a string somebody typed. Two ways that goes wrong,
-- and the boring one is the one that will actually happen:
--
--   the typo   -- a client fat-fingers their own address on a phone. The typo
--                is now permanently bound to their job, they never get the
--                confirmation email, and they are locked out of their own job
--                until somebody unbinds it by hand.
--   the guess  -- somebody who guesses a live code attaches an address they do
--                not have to read, and the real client is locked out the same
--                way.
--
-- So: signing up no longer binds anything. It records a PENDING claim. The
-- confirmation link is what binds, because clicking it is the only thing that
-- proves the address is real and theirs. A typo now costs nothing: no link is
-- ever clicked, no claim is ever consumed, and the client tries again.
--
-- Pending claims deliberately do not block each other. If two people pend the
-- same code, whoever confirms first binds it and the other claim is spent
-- unbound. Blocking on a pending claim would hand anybody a way to freeze a
-- job they had merely guessed at.

create table if not exists public.portal_claims (
  id          bigserial primary key,
  email       text not null,
  code        text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  consumed_at timestamptz
);

create index if not exists portal_claims_open
  on public.portal_claims (lower(email))
  where consumed_at is null;

-- On with no policy: denied to everyone by default, reachable only through the
-- security definer functions below and the service role.
alter table public.portal_claims enable row level security;
revoke all on public.portal_claims from anon, authenticated;

-- 1. Signing up: check, and pend. Never bind. --------------------------------

create or replace function public.pend_portal_code(p_email text, p_code text)
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
  v_ok         boolean := false;
  v_pend       boolean := false;
begin
  if v_email = '' or v_code = '' then
    return false;
  end if;

  -- Both sides, for the reason given in 20260829b: counting failures per
  -- email alone lets an attacker rotate the email and guess one code freely.
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
    values (p_email, v_code, false);
    return false;
  end if;

  -- Already theirs. Signing up again after a deleted account, or simply
  -- pressing the button twice. Nothing to pend, nothing to bind.
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

    -- Exactly one, for the same reason as before: a code sitting on two
    -- unclaimed rows is a question for a human, not a coin toss.
    if v_unclaimed = 1 then
      insert into public.portal_claims (email, code) values (v_email, v_code);
      v_ok   := true;
      v_pend := true;
    end if;
  end if;

  insert into public.portal_code_attempts (email, code, success)
  values (p_email, v_code, v_ok);

  return v_ok;
end;
$$;

-- 2. Confirming: bind. -------------------------------------------------------

create or replace function public.bind_confirmed_portal_claims(p_email text)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_claim record;
  v_hit   int;
  v_bound int := 0;
begin
  if v_email = '' then return 0; end if;

  for v_claim in
    select id, code from public.portal_claims
    where lower(email) = v_email
      and consumed_at is null
      and expires_at > now()
    order by created_at
  loop
    -- The WHERE clause is the lock. A second confirmer re-reads the row, finds
    -- client_email no longer empty, matches nothing, and binds nothing.
    with claimed as (
      update public.jobs set client_email = v_email
      where upper(portal_code) = v_claim.code
        and coalesce(btrim(client_email), '') = ''
      returning 1
    )
    select count(*) into v_hit from claimed;

    if v_hit = 0 then
      with claimed as (
        update public.services set client_email = v_email
        where upper(portal_code) = v_claim.code
          and coalesce(btrim(client_email), '') = ''
        returning 1
      )
      select count(*) into v_hit from claimed;
    end if;

    -- Spent either way. A claim that lost the race does not get to sit around
    -- waiting for the winner's job to somehow come free.
    update public.portal_claims set consumed_at = now() where id = v_claim.id;
    v_bound := v_bound + v_hit;
  end loop;

  return v_bound;
end;
$$;

-- 3. The thing that notices a confirmation. ----------------------------------
-- This runs inside GoTrue's own transaction. If it ever raises, the client
-- cannot confirm their email at all, which would be a far worse bug than the
-- one this file fixes. So it swallows everything: binding is allowed to fail,
-- confirming is not.

create or replace function public.portal_claim_on_confirm()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_now_confirmed boolean;
begin
  if tg_op = 'INSERT' then
    v_now_confirmed := new.email_confirmed_at is not null;
  else
    v_now_confirmed := new.email_confirmed_at is not null
                   and old.email_confirmed_at is null;
  end if;

  if v_now_confirmed and coalesce(new.email, '') <> '' then
    begin
      perform public.bind_confirmed_portal_claims(new.email);
    exception when others then
      null;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_portal_claim_on_confirm on auth.users;
create trigger trg_portal_claim_on_confirm
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.portal_claim_on_confirm();

-- 4. The safety net. ---------------------------------------------------------
-- The trigger is the mechanism, and it is deliberately silent when it fails.
-- Silent plus sole would mean a client confirms, signs in, and finds an empty
-- portal with nothing to tell anyone. So the portal door calls this on the way
-- in. It binds nothing the caller did not already pend under their own
-- confirmed address, so it is safe to expose to a signed-in user.

create or replace function public.bind_my_portal_claims()
returns int
language plpgsql
security definer
set search_path to 'public, auth'
as $$
declare
  v_email     text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_confirmed boolean;
begin
  if v_email = '' then return 0; end if;

  select (email_confirmed_at is not null) into v_confirmed
  from auth.users where lower(email) = v_email limit 1;

  if not coalesce(v_confirmed, false) then return 0; end if;

  return public.bind_confirmed_portal_claims(v_email);
end;
$$;

-- 5. Who may ask. ------------------------------------------------------------

revoke all on function public.pend_portal_code(text, text) from public;
revoke all on function public.pend_portal_code(text, text) from anon;
revoke all on function public.pend_portal_code(text, text) from authenticated;
grant execute on function public.pend_portal_code(text, text) to service_role;

revoke all on function public.bind_confirmed_portal_claims(text) from public;
revoke all on function public.bind_confirmed_portal_claims(text) from anon;
revoke all on function public.bind_confirmed_portal_claims(text) from authenticated;
grant execute on function public.bind_confirmed_portal_claims(text) to service_role;

revoke all on function public.bind_my_portal_claims() from public;
revoke all on function public.bind_my_portal_claims() from anon;
grant execute on function public.bind_my_portal_claims() to authenticated;
grant execute on function public.bind_my_portal_claims() to service_role;

-- 6. The signup-time binder is retired. --------------------------------------
-- claim_portal_code() bound on sight. Nothing calls it now, and leaving a
-- function lying around whose whole job is to attach a stranger's email to a
-- job is not a thing to leave lying around.

drop function if exists public.claim_portal_code(text, text);
