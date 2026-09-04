-- A phone number stops being its last nine digits.
--
-- Every phone comparison in the WhatsApp path, in the Edge Function and in the
-- four RPCs behind it, has been one line: strip the non-digits, take the last
-- nine, compare. That drops the country code, so a UK number and a Jamaican
-- number ending in the same nine digits are the same person to this code.
--
-- It matters here more than most places. approve_stage_via_whatsapp is reached
-- from an endpoint that runs with --no-verify-jwt, and it fires
-- raise_worker_pay_invoice_on_stage_approval. The number match is one of the
-- two things standing in front of that, the other being the job's own code
-- appearing in the message.
--
-- WHY IT WAS WRITTEN THAT WAY, which is the part worth keeping. Numbers arrive
-- in three shapes: Twilio sends E.164 with the country code, a worker typing
-- their own number into the join form usually does not, and a client's number
-- on a job row is whatever was captured first. Strict equality would refuse a
-- worker who is plainly themselves. The last nine digits made those three
-- shapes agree. It just made too many other things agree as well.
--
-- same_phone() keeps the first behaviour and drops the second. An exact match
-- on the full digit string wins outright. Otherwise one number may be a suffix
-- of the other, but only when the shorter is at least nine digits and the
-- longer is at most four digits longer, which is a country code rather than a
-- different number that happens to end the same way.
--
-- STRICTLY TIGHTER. Every pair this accepts, the last-nine rule already
-- accepted. Nothing that worked stops working.
--
-- SCOPE, STATED PLAINLY. This migration redefines ONE function:
-- approve_stage_via_whatsapp, the one that raises money, whose body is
-- reproduced below unchanged apart from the comparison. agree_quote_via_whatsapp,
-- agree_kickoff_pack_via_whatsapp and choose_worker_via_whatsapp still carry
-- the last-nine form internally. They are now behind the tightened check in
-- yaad-inbound, which decides whether a reply is a candidate for them at all,
-- so a mismatched number no longer reaches them. Rewriting five security
-- definer money functions in one change, without running supabase/tests
-- against them, is its own piece of work and should not ride along in an
-- audit sweep. See RUNBOOK.md.

create or replace function public.same_phone(a text, b text)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  da text := regexp_replace(coalesce(a, ''), '\D', '', 'g');
  db text := regexp_replace(coalesce(b, ''), '\D', '', 'g');
  shorter text;
  longer  text;
begin
  if length(da) < 9 or length(db) < 9 then
    return false;
  end if;
  if da = db then
    return true;
  end if;
  if length(da) <= length(db) then
    shorter := da; longer := db;
  else
    shorter := db; longer := da;
  end if;
  if length(longer) - length(shorter) > 4 then
    return false;
  end if;
  return longer like ('%' || shorter);
end;
$$;

comment on function public.same_phone(text, text) is
  'Are these the same telephone number? Exact on the full digit string, or a suffix match where the difference is no more than a country code. Replaces the last-nine-digits comparison, which treated two numbers in different countries as one person.';

grant execute on function public.same_phone(text, text) to service_role;

-- ── the one that raises money ───────────────────────────────────────────
-- Verified against the live definition in leffyisvfvjwzilydlwf before this was
-- written, rather than trusted from the migration file, because a superseded
-- migration is exactly how a redefinition silently reverts somebody's fix.
-- The live body matched 20260831v.
--
-- Body unchanged apart from the comparison on the line marked below, and the
-- v_tail local it no longer needs. One other behaviour change, stated rather
-- than buried: the minimum usable length goes from 7 digits to 9, matching
-- same_phone(). Twilio only ever sends E.164, so every real caller is 11 or
-- more digits and nothing in production is affected; it closes the case where
-- two seven digit fragments could satisfy the check.

create or replace function public.approve_stage_via_whatsapp(p_job text, p_phone text)
returns table(job_id text, stage integer, evidence_count integer, confirmed_method text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  j record;
begin
  if length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 9 then
    raise exception 'No usable phone number.' using errcode = '28000';
  end if;

  select * into j from public.jobs where id = p_job;
  if j.id is null then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;

  -- The line this migration exists for.
  if not public.same_phone(j.client_phone, p_phone) then
    raise exception 'That number is not on record for this job.' using errcode = '28000';
  end if;

  return query select * from public._do_approve_stage(p_job, j.client_email, 'whatsapp');
end;
$$;

-- Unchanged from 20260831v: reached only from yaad-inbound on the service
-- role, after it has already matched the sender's number to this exact job and
-- asked for the job's own code back. A client-side session has no business
-- calling this.
revoke all on function public.approve_stage_via_whatsapp(text, text) from anon, authenticated, public;
grant execute on function public.approve_stage_via_whatsapp(text, text) to service_role;
