-- Three things. The first is a founder decision of 28 August 2026; the other
-- two are what it turned over when it was implemented.
--
-- ONE. A job does not reach the board without a nominated materials store.
--
-- 20260828c gated the MONEY on the nomination. That is the moment the rule
-- bites, but it is not the moment the answer is first needed. A worker pricing
-- a job has to know whether he is quoting against a lockable store or against
-- buying in drops and driving the surplus off site every night, because those
-- trips are real work and they go in the quote or they are never paid for.
-- Asking after he has quoted is asking him to eat the difference or revise,
-- and a revised quote costs more trust than the question ever would.
--
-- So the answer is now due at the same moment the signed guidelines are:
-- before anybody sees the job. Same shape as enforce_signed_before_open, and
-- deliberately so, because these are the same kind of fact. A job that cannot
-- be quoted honestly has no business being on a public board.
--
-- Jobs already open when this runs are left where they are. Closing a board
-- retrospectively over a question nobody was asked would punish the client for
-- our timing.

create or replace function public.enforce_store_before_open()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Only the transition into open is checked. An already-open job being
  -- updated for any other reason is not re-judged against a rule that did not
  -- exist when it opened.
  if new.open is not true then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.open is true then
    return new;
  end if;

  if not public.materials_store_nominated(new.id) then
    raise exception
      'Job % cannot go on the board until the client has said where materials are to be kept. A worker cannot price this job honestly without that answer: with nowhere securable he buys in drops and drives the surplus off site nightly, and those trips belong in his quote. Record the answer and this will go through.', new.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_enforce_store_before_open on public.jobs;
create trigger trg_enforce_store_before_open
  before insert or update on public.jobs
  for each row execute function public.enforce_store_before_open();

revoke execute on function public.enforce_store_before_open() from public, anon, authenticated;

-- TWO. The guidelines version in force, and the reason it had drifted.
--
-- app_settings held '1.0' while web/lib/legal-copy.json had moved to '1.2 ·
-- 26 August 2026'. current_doc_version() reads app_settings, and
-- client_go_live() requires the signature's doc_version to equal it exactly.
-- The two signing paths disagreed:
--
--   the job wizard on yaadly.co.uk stamped '1.0' and passed the gate
--   the portal stamped the whole string '1.2 · 26 August 2026' and could
--     never pass it, so a client who signed in the portal was stuck
--
-- Nobody had hit it because doc_signatures is empty. It would have been the
-- first thing to break in December.
--
-- Fixed by making the version a bare number everywhere and carrying the date
-- separately, as display. A date inside a version is a date the gate has to
-- match, and identity and presentation should never have been the same field.
--
-- v1.3 is the materials custody rule plus the two interim corrections: the
-- client guidelines no longer forbid paying the tradesperson directly, which
-- is how a job actually runs while holding is off, and the worker guidelines
-- no longer promise that the client's money is held before he starts, which
-- was untrue and was the sentence a worker was most likely to rely on.
update public.app_settings set value = '1.3' where key = 'client_guidelines_version';
update public.app_settings set value = '1.3' where key = 'worker_guidelines_version';

-- THREE. client_go_live() opens every waiting job in one statement, so one
-- job without a nomination would raise on the trigger above and none of that
-- client's jobs would open at all. The signature would still be recorded,
-- because actions.ts deliberately does not treat a failure here as fatal, but
-- the client would sign and see nothing happen.
--
-- Skipping is the right behaviour rather than failing: the jobs that CAN go
-- live do, and the one that cannot is waiting on a question only its own
-- client can answer, in the portal, on that job. Nothing else in the function
-- changes.
create or replace function public.client_go_live()
returns table (job_id text)
language plpgsql
security definer
set search_path to 'public, auth'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_name  text;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  -- Possession of an email address is not proof you can read that mailbox.
  -- Without this check anyone could post a job in a stranger's name and have
  -- it go live to workers, which is the whole reason accounts are created
  -- unconfirmed in the first place.
  select lower(btrim(u.email)) into v_email
    from auth.users u
   where u.id = v_uid and u.email_confirmed_at is not null;

  if v_email is null or v_email = '' then
    raise exception 'Confirm your email address first.' using errcode = '28000';
  end if;

  -- The name comes off the signature rather than a form field, so the profile
  -- carries the name they actually signed with.
  select s.signer_name into v_name
    from public.doc_signatures s
   where s.doc_type = 'client_guidelines'
     and lower(s.signer_email) = v_email
     and (public.current_doc_version('client_guidelines') is null
          or s.doc_version = public.current_doc_version('client_guidelines'))
   order by s.signed_at desc nulls last
   limit 1;

  if v_name is null or btrim(v_name) = '' then
    raise exception 'Sign the current Client Guidelines first.'
      using errcode = 'check_violation';
  end if;

  insert into public.client_profiles (user_id, email, name, active)
  values (v_uid, v_email, v_name, true)
  on conflict (email) do update
     set user_id    = excluded.user_id,
         name       = excluded.name,
         active     = true,
         updated_at = now();

  -- Only jobs that were waiting on exactly this. A job somebody deliberately
  -- left as a draft stays a draft: signing the terms is consent to the terms,
  -- not blanket consent to publish everything they ever started.
  return query
    update public.jobs j
       set open = true
     where lower(j.client_email) = v_email
       and j.open is false
       and j.status = 'awaiting_client_setup'
       and coalesce(j.worker_email, '') = ''
       and coalesce(j.stage, 0) = 0
       and public.materials_store_nominated(j.id)
    returning j.id;
end;
$function$;

revoke all on function public.client_go_live() from public;
grant execute on function public.client_go_live() to authenticated;
