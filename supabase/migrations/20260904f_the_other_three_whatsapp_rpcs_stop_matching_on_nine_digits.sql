-- The other three WhatsApp RPCs stop matching on nine digits.
--
-- 20260904b introduced same_phone() and converted approve_stage_via_whatsapp,
-- the one that raises a worker payable, and said plainly what it was leaving:
-- agree_quote_via_whatsapp, agree_kickoff_pack_via_whatsapp and
-- choose_worker_via_whatsapp still compared the last nine digits, which makes
-- a UK number and a Jamaican number ending the same way one person. They were
-- left because rewriting five security definer money functions in one sweep,
-- without running supabase/tests against them, is not something to do in
-- passing. This is that work, done on its own, with its own test rig file
-- (supabase/tests/whatsapp_phone_guards.sql).
--
-- SIX COMPARISONS ACROSS THREE FUNCTIONS, and all six are the same edit:
--   agree_quote_via_whatsapp          client, then worker
--   agree_kickoff_pack_via_whatsapp   client, then worker
--   choose_worker_via_whatsapp        client
--
-- Every body below was read out of leffyisvfvjwzilydlwf on 4 September 2026
-- with pg_get_functiondef, not copied from a migration file, because a
-- superseded migration is how a redefinition silently reverts somebody's fix.
-- Nothing else in any of them is changed: the same candidate ordering, the
-- same "more than one price is open" refusals, the same exception wording, the
-- same delegation to the _do_ functions that actually move anything.
--
-- ONE DELIBERATE BEHAVIOUR CHANGE, the same one 20260904b made: the minimum
-- usable length goes from 7 digits to 9, matching same_phone(). Twilio only
-- ever sends E.164, so every real caller is 11 or more digits.
--
-- WHAT DOES NOT CHANGE. These are still reached only from yaad-inbound on the
-- service role, after it has matched the sender's number to the job and asked
-- for the job's own code back. This is the second of the two checks, not the
-- only one.

-- ── 1. agree_quote_via_whatsapp ──────────────────────────────────────────

create or replace function public.agree_quote_via_whatsapp(p_job text, p_phone text)
returns table(agreed_side text, both_confirmed boolean, out_job_id text, out_quote_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job public.jobs%rowtype;
  v_quote public.job_quotes%rowtype;
  v_side text;
  v_email text;
  v_open_count integer;
  v_both boolean;
begin
  if length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 9 then
    raise exception 'No usable phone number.';
  end if;

  select * into v_job from public.jobs where id = p_job;
  if v_job.id is null then
    raise exception 'No such job.';
  end if;

  if public.same_phone(v_job.client_phone, p_phone) then
    select count(*) into v_open_count from public.job_quotes q where q.job_id = p_job and q.status = 'submitted';
    if coalesce(v_open_count, 0) = 0 then
      raise exception 'No open price on this job to confirm.';
    end if;
    if v_open_count > 1 then
      raise exception 'More than one price is open on this job. Say which worker you mean.';
    end if;
    select * into v_quote from public.job_quotes q where q.job_id = p_job and q.status = 'submitted';
    v_side := 'client';
    v_email := lower(coalesce(v_job.client_email, ''));
  else
    select q.* into v_quote
      from public.job_quotes q
      join public.worker_profiles wp on lower(wp.worker_email) = lower(q.worker_email)
     where q.job_id = p_job and q.status = 'submitted'
       and public.same_phone(wp.phone, p_phone);
    if v_quote.id is null then
      raise exception 'No open price on this job is waiting on your confirmation.';
    end if;
    v_side := 'worker';
    v_email := lower(v_quote.worker_email);
  end if;

  insert into public.quote_agreements (quote_id, side, email)
  values (v_quote.id, v_side, v_email)
  on conflict (quote_id, side) do nothing;

  select (count(*) filter (where side = 'client') > 0) and (count(*) filter (where side = 'worker') > 0)
    into v_both
    from public.quote_agreements where quote_id = v_quote.id;

  if v_both then
    perform set_config('yaadly.choosing', '1', true);
    update public.job_quotes set status = 'quote_confirmed', updated_at = now() where id = v_quote.id;
    perform set_config('yaadly.choosing', '', true);
  end if;

  return query select v_side, coalesce(v_both, false), p_job, v_quote.id;
end;
$function$;

-- ── 2. agree_kickoff_pack_via_whatsapp ───────────────────────────────────

create or replace function public.agree_kickoff_pack_via_whatsapp(p_job text, p_phone text)
returns table(agreed_side text, both_confirmed boolean, job_id text, pack_id text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pack_id text;
  v_side text;
  v_email text;
begin
  if length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 9 then
    raise exception 'No usable phone number.';
  end if;

  select p.id, 'client', lower(j.client_email)
    into v_pack_id, v_side, v_email
    from kickoff_packs p
    join jobs j on j.id = p.job_id
   where p.job_id = p_job
     and p.status = 'approved'
     and public.same_phone(j.client_phone, p_phone)
     and not exists (
       select 1 from kickoff_pack_agreements a
        where a.pack_id = p.id and a.rev = p.rev and a.side = 'client'
     )
   order by p.updated_at desc
   limit 1;

  if v_pack_id is null then
    select p.id, 'worker', lower(q.worker_email)
      into v_pack_id, v_side, v_email
      from kickoff_packs p
      join job_quotes q on q.id = p.quote_id
      join worker_profiles wp on lower(wp.worker_email) = lower(q.worker_email)
     where p.job_id = p_job
       and p.status = 'approved'
       and public.same_phone(wp.phone, p_phone)
       and not exists (
         select 1 from kickoff_pack_agreements a
          where a.pack_id = p.id and a.rev = p.rev and a.side = 'worker'
       )
     order by p.updated_at desc
     limit 1;
  end if;

  if v_pack_id is null then
    raise exception 'No Kickoff Pack on this job is waiting on your confirmation right now.';
  end if;

  return query
    select r.agreed_side, r.both_confirmed, p_job, v_pack_id
      from public._do_agree_kickoff_pack(v_pack_id, v_side, v_email) r;
end $function$;

-- ── 3. choose_worker_via_whatsapp ────────────────────────────────────────

create or replace function public.choose_worker_via_whatsapp(p_job text, p_phone text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  j record;
  v_count integer;
  v_quote uuid;
begin
  if length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 9 then
    raise exception 'No usable phone number.';
  end if;

  select * into j from public.jobs where id = p_job;
  if j.id is null then
    raise exception 'No such job.';
  end if;

  if not public.same_phone(j.client_phone, p_phone) then
    raise exception 'That number is not on record for this job.';
  end if;

  select count(*), (array_agg(id))[1]
    into v_count, v_quote
    from public.job_quotes
   where job_id = p_job and status in ('quote_confirmed', 'kickoff_requested');

  if coalesce(v_count, 0) = 0 then
    raise exception 'No price is open on this job to accept.';
  end if;

  if v_count > 1 then
    raise exception 'More than one price is open on this job. Use the link to choose.';
  end if;

  return public._do_choose_worker(p_job, v_quote);
end;
$function$;

-- Grants restated exactly as they stood. All three are reached only from
-- yaad-inbound on the service role; a client-side session has no business
-- calling any of them.
revoke all on function public.agree_quote_via_whatsapp(text, text) from anon, authenticated, public;
revoke all on function public.agree_kickoff_pack_via_whatsapp(text, text) from anon, authenticated, public;
revoke all on function public.choose_worker_via_whatsapp(text, text) from anon, authenticated, public;
grant execute on function public.agree_quote_via_whatsapp(text, text) to service_role;
grant execute on function public.agree_kickoff_pack_via_whatsapp(text, text) to service_role;
grant execute on function public.choose_worker_via_whatsapp(text, text) to service_role;
