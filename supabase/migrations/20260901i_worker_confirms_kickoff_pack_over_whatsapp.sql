-- Founder's own correction, live, testing the journey end to end: "this
-- need to go through whatsapp, it should not be done through the portal."
-- She is right and CLAUDE.md already says so, in words written before
-- tonight: "The worker in Portland is on a phone mid-job and will do
-- everything over WhatsApp. The worker web surface stays thin on purpose:
-- structured onboarding with credentials, and file upload. Nothing else."
--
-- Tonight's Kickoff Pack rework (20260901f) gave the worker a portal
-- button, "Confirm as the worker", to agree their own Kickoff Pack. That
-- is exactly the kind of surface §9 rules out. Reading the pack over
-- WhatsApp (the message already links to it, text is fine to read on a
-- phone) stays as it was; CONFIRMING it needs a WhatsApp reply, the same
-- family as choose_worker_via_whatsapp and approve_stage_via_whatsapp: a
-- phone number is the credential, and more than one pending item at once
-- refuses rather than guessing which one was meant.
--
-- agree_kickoff_pack()'s own logic (find which side this signed-in email
-- is, insert the agreement, check for both) is pulled into
-- _do_agree_kickoff_pack() so the portal path and the WhatsApp path share
-- one core, the same shape as _do_choose_worker() under choose_worker()
-- and choose_worker_via_whatsapp(). The portal path still requires the
-- pack's own confirm_code (a stale link must fail on a revision that
-- changed); the WhatsApp path does not, the same way choosing a worker by
-- WhatsApp code needs no separate confirm code beyond the phone match
-- itself - the phone on record IS the credential for that door.

create or replace function public._do_agree_kickoff_pack(p_pack_id text, p_side text, p_email text)
returns table(agreed_side text, both_confirmed boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pack kickoff_packs%rowtype;
  v_both boolean;
begin
  select * into v_pack from kickoff_packs where id = p_pack_id;
  if not found then raise exception 'No such Kickoff Pack.' using errcode = 'check_violation'; end if;

  insert into public.kickoff_pack_agreements (pack_id, rev, side, email, agreed_at)
  values (p_pack_id, v_pack.rev, p_side, p_email, now())
  on conflict (pack_id, rev, side) do nothing;

  v_both :=
    exists (select 1 from public.kickoff_pack_agreements
             where pack_id = p_pack_id and rev = v_pack.rev and side = 'client')
    and exists (select 1 from public.kickoff_pack_agreements
             where pack_id = p_pack_id and rev = v_pack.rev and side = 'worker');

  if v_both and v_pack.both_confirmed_at is null then
    update public.kickoff_packs set both_confirmed_at = now() where id = p_pack_id;
  end if;

  return query select p_side, v_both;
end $function$;

create or replace function public.agree_kickoff_pack(p_pack_id text, p_code text)
returns table(agreed_side text, both_confirmed boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pack  kickoff_packs%rowtype;
  v_job   jobs%rowtype;
  v_quote job_quotes%rowtype;
  v_email text := lower(nullif(btrim(auth.jwt()->>'email'), ''));
  v_side  text;
begin
  if v_email is null then
    raise exception 'Sign in to confirm this pack.' using errcode = '28000';
  end if;

  select * into v_pack from kickoff_packs where id = p_pack_id;
  if not found then raise exception 'No such Kickoff Pack.' using errcode = 'check_violation'; end if;
  if v_pack.status <> 'approved' then
    raise exception 'This pack has not been issued yet.' using errcode = 'check_violation';
  end if;
  if v_pack.confirm_code is null or upper(btrim(p_code)) <> v_pack.confirm_code then
    raise exception 'That confirmation code does not match the current version of this pack. Open it again for the latest link.'
      using errcode = 'check_violation';
  end if;

  select * into v_job from jobs where id = v_pack.job_id;
  if v_pack.quote_id is not null then
    select * into v_quote from job_quotes where id = v_pack.quote_id;
  end if;

  if lower(coalesce(v_job.client_email,'')) = v_email then
    v_side := 'client';
  elsif v_quote.id is not null and lower(coalesce(v_quote.worker_email,'')) = v_email then
    v_side := 'worker';
  elsif lower(coalesce(v_job.worker_email,'')) = v_email then
    v_side := 'worker';
  else
    raise exception 'Only the client or worker on this job may confirm it.' using errcode = '28000';
  end if;

  return query select * from public._do_agree_kickoff_pack(p_pack_id, v_side, v_email);
end $function$;

create or replace function public.agree_kickoff_pack_via_whatsapp(p_phone text)
returns table(agreed_side text, both_confirmed boolean, job_id text, pack_id text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tail text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9);
  v_count integer;
  v_pack_id text;
  v_side text;
  v_email text;
  v_job_id text;
begin
  if length(v_tail) < 7 then
    raise exception 'No usable phone number.';
  end if;

  -- Every approved, not-yet-confirmed-by-this-phone pack this phone is a
  -- party to, from both directions at once: this phone as the job's
  -- client, or this phone as the worker on the quote a pack was drafted
  -- against. Exactly one across both is required to act without asking
  -- which job was meant, same discipline choose_worker_via_whatsapp uses.
  with candidates as (
    select p.id as pack_id, p.job_id, 'client' as side, lower(j.client_email) as email
      from kickoff_packs p
      join jobs j on j.id = p.job_id
     where p.status = 'approved'
       and right(regexp_replace(coalesce(j.client_phone,''), '\D', '', 'g'), 9) = v_tail
       and not exists (
         select 1 from kickoff_pack_agreements a
          where a.pack_id = p.id and a.rev = p.rev and a.side = 'client'
       )
    union all
    select p.id as pack_id, p.job_id, 'worker' as side, lower(q.worker_email) as email
      from kickoff_packs p
      join job_quotes q on q.id = p.quote_id
      join worker_profiles wp on lower(wp.worker_email) = lower(q.worker_email)
     where p.status = 'approved'
       and right(regexp_replace(coalesce(wp.phone,''), '\D', '', 'g'), 9) = v_tail
       and not exists (
         select 1 from kickoff_pack_agreements a
          where a.pack_id = p.id and a.rev = p.rev and a.side = 'worker'
       )
  )
  select count(*), (array_agg(pack_id))[1], (array_agg(side))[1], (array_agg(email))[1], (array_agg(job_id))[1]
    into v_count, v_pack_id, v_side, v_email, v_job_id
    from candidates;

  if coalesce(v_count, 0) = 0 then
    raise exception 'No Kickoff Pack is waiting on your confirmation right now.';
  end if;
  if v_count > 1 then
    raise exception 'More than one Kickoff Pack is waiting on you. Use the link to confirm the right one.';
  end if;

  return query
    select r.agreed_side, r.both_confirmed, v_job_id, v_pack_id
      from public._do_agree_kickoff_pack(v_pack_id, v_side, v_email) r;
end $function$;

revoke all on function public._do_agree_kickoff_pack(text, text, text) from public;
grant execute on function public._do_agree_kickoff_pack(text, text, text) to service_role;

revoke all on function public.agree_kickoff_pack_via_whatsapp(text) from public;
grant execute on function public.agree_kickoff_pack_via_whatsapp(text) to service_role, authenticated;
