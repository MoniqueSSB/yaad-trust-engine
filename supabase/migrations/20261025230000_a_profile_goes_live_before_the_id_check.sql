-- A profile goes live before the ID check. 25 Oct 2026.
--
-- Founder, in her words: "Sign up is too stages. one just to create your
-- profile with your name, email and picture optional with information about
-- yourself. Once that is done then it is approved and you have a profile, to
-- quote jobs you need the rest", then "profile stage then id stage", "a phone
-- number is essential", "email is optional" (needed at the ID stage, so they
-- can sign in to quote), proof of address removed, and the TRN moved to just
-- before the first payment. "yes build it and make it live now".
--
-- Until now one gate did everything: a profile could not go live without an
-- approved ID check and an approved TRN, and going live was also what let a
-- worker quote. Nothing on the desk could make a profile live at all, so a
-- person could press Pass twice (APP-DFDA56) and nothing visible happened.
--
-- Now there are three moments, each a named person's click:
--
--   profile stage pass   pass_profile_stage(). The profile goes live on the
--                        job board. Needs a name and a phone number.
--   ID stage pass        pass_id_stage(). The worker can quote and be booked.
--                        Needs an email, an approved ID check, the Guidelines
--                        signed, and referees or a skills video.
--   TRN approved         set_application_trn(). The worker can be paid.
--
-- What does not change: every one of those is a person at the desk. Nothing
-- here passes, publishes or approves anybody on its own. Quoting, the job
-- alerts and the client shortlist all move from "live" to "ID stage passed"
-- in this same change, so there is never a moment when a worker who has only
-- passed the profile stage can quote.

-- ── 1. The ID stage, recorded on the profile ──────────────────────────────
alter table public.worker_profiles add column if not exists id_checked_at timestamptz;
alter table public.worker_profiles add column if not exists id_checked_by text;

comment on column public.worker_profiles.id_checked_at is
  'When a person passed this worker''s ID stage (pass_id_stage). Quoting, job alerts and the client shortlist need it. NULL means the profile is live on the board but cannot quote.';

-- Every profile live today went through the old gate, which demanded an
-- approved ID check and an approved TRN, so each has passed the ID stage.
-- Recorded as such rather than as a person, because no person pressed it.
-- The publish gate is held off for this one statement only: it is the old
-- gate's own verdict being carried across, not a new pass, and the new ID
-- stage check (section 2) would otherwise ask these rows for a skills video
-- the old gate never asked for. All six live rows on 25 Oct 2026 were tests.
alter table public.worker_profiles disable trigger trg_profile_publish_checks;
update public.worker_profiles
   set id_checked_at = coalesce(updated_at, now()),
       id_checked_by = 'live before the two stages (25 Oct 2026)'
 where active is true and id_checked_at is null;
alter table public.worker_profiles enable trigger trg_profile_publish_checks;

-- ── 2. The gates on the profile itself ────────────────────────────────────
create or replace function public.enforce_profile_publish_checks()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  app record;
  has_video boolean;
  refs_done boolean;
begin
  -- Rows made by hand at the desk have no application to check against.
  if new.application_id is null then
    return new;
  end if;

  select persona_status, trn_status, signed_at,
         coalesce(nullif(btrim(email), ''), '') as email,
         coalesce(nullif(btrim(phone), ''), '') as phone,
         coalesce(btrim(ref1), '') as ref1, coalesce(btrim(ref2), '') as ref2, coalesce(btrim(ref3), '') as ref3
    into app
    from applications
   where id = new.application_id;

  if app is null then
    raise exception 'Cannot publish: no application % exists.', new.application_id;
  end if;

  -- The profile stage: going live on the job board.
  if new.active is true and not (tg_op = 'UPDATE' and old.active is true) then
    if coalesce(btrim(new.name), '') = '' then
      raise exception 'Cannot put this profile live: it has no name.';
    end if;
    if coalesce(btrim(new.phone), '') = '' and app.phone = '' then
      raise exception 'Cannot put % live: no phone number. It is how they are reached: WhatsApp, the job alerts and the link to their ID stage all go to it.', new.name;
    end if;
  end if;

  -- The ID stage: being allowed to quote.
  if new.id_checked_at is not null and (tg_op = 'INSERT' or old.id_checked_at is null) then
    if new.active is not true then
      raise exception 'Pass the profile stage for % first. The ID stage is for a profile that is already live.', new.name;
    end if;
    if coalesce(btrim(new.worker_email), '') = '' and app.email = '' then
      raise exception 'Cannot pass the ID stage for %: no email address. They sign in with it to quote, and the Guidelines signature and the portal are keyed on it.', new.name;
    end if;
    if coalesce(app.persona_status, '') not in ('approved', 'completed') then
      raise exception 'Cannot pass the ID stage for %: the identity check reads "%". It must be approved or completed, confirmed by our server against Persona.', new.name, coalesce(app.persona_status, 'nothing yet');
    end if;
    if app.signed_at is null then
      raise exception 'Cannot pass the ID stage for %: the Worker Guidelines are not signed.', new.name;
    end if;
    refs_done := app.ref1 <> '' and app.ref2 <> '' and app.ref3 <> '';
    select exists (
      select 1 from vetting_documents v
       where v.application_id = new.application_id and v.doc_type = 'intro_video'
    ) into has_video;
    if not refs_done and not has_video then
      raise exception 'Cannot pass the ID stage for %: no referees and no skills video. One of the two is needed.', new.name;
    end if;
  end if;

  return new;
end $function$;

-- ── 3. Quoting needs the ID stage ─────────────────────────────────────────
create or replace function public.enforce_vetted_worker_on_quote()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  wp record;
  j record;
  total integer;
  top_tier_jmd constant integer := 105000;
begin
  select * into wp from public.worker_profiles
   where lower(worker_email) = lower(coalesce(new.worker_email, '')) and active;

  if wp is null then
    raise exception
      'Only an active vetted worker can submit a quote (no active worker profile for %).',
      coalesce(nullif(btrim(new.worker_email), ''), '(no email)')
      using errcode = 'check_violation';
  end if;

  -- 25 Oct 2026: a live profile is the profile stage only. Quoting is the ID
  -- stage, passed by a person.
  if wp.id_checked_at is null then
    raise exception
      'Finish your ID stage before you quote: your email, your ID check, the Guidelines, and referees or a skills video. Yaadly checks them, usually within a day.'
      using errcode = 'check_violation';
  end if;

  if coalesce(wp.vetting_state, 'probation') = 'verified' then
    return new;
  end if;

  if coalesce(wp.vetting_state, '') = 'suspended' then
    raise exception 'This account is suspended and cannot quote.'
      using errcode = 'check_violation';
  end if;

  total := coalesce(new.labour_jmd, 0) + coalesce(new.materials_jmd, 0);

  if total >= top_tier_jmd then
    raise exception
      'While your account is in Probation you can quote standard jobs, but not work over about J$%. Finish your police check and your telephoned references and this opens up.',
      top_tier_jmd
      using errcode = 'check_violation';
  end if;

  select * into j from public.jobs where id = new.job_id;

  -- j.id, not j. See the note at the top.
  if j.id is not null and coalesce(j.access_type, '') <> '' then
    if j.access_type ~* '(key|keys)' then
      raise exception
        'While your account is in Probation you cannot take a job where you would hold keys. Finish your police check and your telephoned references and this opens up.'
        using errcode = 'check_violation';
    end if;
    if j.access_type ~* '(on site|occupied|lives there|at home)' then
      raise exception
        'While your account is in Probation you cannot take a job inside an occupied home. Finish your police check and your telephoned references and this opens up.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$function$;

-- ── 4. Job alerts and the client shortlist: only workers who can quote ─────
create or replace function public.match_workers_for_job(p_job text, p_limit integer default 25)
returns table(worker_email text, name text, trade text, parish text, jobs_done integer, match_reason text, rank_score integer)
language sql
stable security definer
set search_path to 'public'
as $function$
  with j as (
    select id,
           trade_key(trade)  as tk,
           parish_key(parish) as pk
    from jobs
    where id = p_job
      and open is true
      and coalesce(worker_email,'') = ''
      and stage = 0
  )
  select w.worker_email,
         w.name,
         w.trade,
         w.parish,
         w.jobs_completed,
         case
           when trade_key(w.trade) = j.tk and parish_key(w.parish) = j.pk then 'trade and parish'
           when trade_key(w.trade) = j.tk then 'trade, different parish'
           else 'parish, related trade'
         end,
         (case when trade_key(w.trade)  = j.tk then 100 else 0 end)
       + (case when parish_key(w.parish) = j.pk then 50  else 0 end)
       + least(w.jobs_completed, 25)
    from worker_profiles w
    cross join j
   where w.active
     and w.id_checked_at is not null
     and coalesce(w.worker_email,'') <> ''
     and exists (
       select 1 from doc_signatures ds
        where ds.doc_type = 'worker_guidelines'
          and lower(ds.signer_email) = lower(w.worker_email)
          and (current_doc_version('worker_guidelines') is null
               or ds.doc_version = current_doc_version('worker_guidelines'))
     )
     and (trade_key(w.trade) = j.tk or parish_key(w.parish) = j.pk)
     and not exists (
       select 1 from job_alerts a
        where a.job_id = j.id
          and lower(a.worker_email) = lower(w.worker_email)
          and a.status = 'sent'
     )
   order by 7 desc, w.jobs_completed desc
   limit greatest(p_limit, 1);
$function$;

create or replace function public.shortlist_candidates_for_job(p_job text, p_limit integer default 12)
returns table(worker_email text, name text, trade text, parish text, areas text, lane text, years integer, jobs_completed integer, about text, slug text, match_reason text, rank_score integer)
language sql
stable security definer
set search_path to 'public'
as $function$
  with j as (
    select id,
           trade_key(trade)   as tk,
           parish_key(parish) as pk
      from jobs
     where id = p_job
  )
  select w.worker_email,
         w.name,
         w.trade,
         w.parish,
         w.areas,
         w.lane,
         w.years,
         w.jobs_completed,
         w.about,
         w.slug,
         case
           when trade_key(w.trade) = j.tk and parish_key(w.parish) = j.pk then 'trade and parish'
           when trade_key(w.trade) = j.tk then 'trade, different parish'
           else 'parish, related trade'
         end,
         (case when trade_key(w.trade)  = j.tk then 100 else 0 end)
       + (case when parish_key(w.parish) = j.pk then 50  else 0 end)
       + least(coalesce(w.jobs_completed, 0), 25)
    from worker_profiles w
    cross join j
   where w.active
     and w.id_checked_at is not null
     and coalesce(w.is_test, false) = false
     and coalesce(w.worker_email, '') <> ''
     and exists (
       select 1 from doc_signatures ds
        where ds.doc_type = 'worker_guidelines'
          and lower(ds.signer_email) = lower(w.worker_email)
          and (current_doc_version('worker_guidelines') is null
               or ds.doc_version = current_doc_version('worker_guidelines'))
     )
     and (trade_key(w.trade) = j.tk or parish_key(w.parish) = j.pk)
   order by 12 desc, w.jobs_completed desc nulls last, w.name
   limit greatest(1, least(p_limit, 30));
$function$;

-- ── 5. Being paid needs an approved TRN ───────────────────────────────────
-- A worker whose profile came from an application must have that
-- application's TRN approved by a person. A profile made by hand at the desk
-- has no application and is not held here; it went live under the old gate.
create or replace function public.worker_trn_ready(p_worker_email text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select not exists (
    select 1
      from worker_profiles w
      join applications a on a.id = w.application_id
     where lower(coalesce(w.worker_email, '')) = lower(btrim(coalesce(p_worker_email, '')))
       and coalesce(a.trn_status, 'not_given') <> 'approved'
  );
$function$;

revoke all on function public.worker_trn_ready(text) from public, anon, authenticated;
grant execute on function public.worker_trn_ready(text) to service_role;

create or replace function public.mark_worker_paid(p_invoice text, p_method text, p_ref text default ''::text, p_fee integer default null::integer)
returns timestamp with time zone
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inv    invoices%rowtype;
  v_method text := nullif(btrim(lower(coalesce(p_method, ''))), '');
  v_ref    text := btrim(coalesce(p_ref, ''));
  v_at     timestamptz;
  v_why    text;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  if v_method is null or v_method not in ('bank_transfer', 'stripe', 'moneygram') then
    raise exception 'Say how it was paid: bank_transfer, stripe or moneygram.'
      using errcode = 'check_violation';
  end if;

  select * into v_inv from invoices where id = p_invoice for update;
  if not found then
    raise exception 'No such invoice.' using errcode = 'check_violation';
  end if;
  if v_inv.payable_to is distinct from 'worker' then
    raise exception 'Invoice % is a client''s bill, not a worker''s pay. Mark it paid on Invoices.', v_inv.id
      using errcode = 'check_violation';
  end if;
  if v_inv.status = 'paid' then
    raise exception 'Invoice % was already marked paid on %.', v_inv.id,
      coalesce(to_char(v_inv.paid_at at time zone 'America/Jamaica', 'FMDD Mon YYYY'), 'an earlier date')
        || case when btrim(coalesce(v_inv.paid_by, '')) <> '' then ' by ' || v_inv.paid_by else '' end
      using errcode = 'check_violation';
  end if;
  if v_inv.status <> 'sent' then
    raise exception 'Invoice % is %, not sent, so nothing is owed on it yet.', v_inv.id, v_inv.status
      using errcode = 'check_violation';
  end if;
  if not public.worker_bank_checked(v_inv.worker_email) then
    raise exception 'Call % back on the number you have for them, check their bank or pick-up details, and press Call-back done on Pay workers first. Their details have not been checked by phone since they were last given.',
      coalesce(nullif(btrim(v_inv.worker_email), ''), 'the worker')
      using errcode = 'check_violation';
  end if;
  -- 25 Oct 2026: the TRN is asked just before the first payment, not before
  -- quoting, so this is where it is held.
  if not public.worker_trn_ready(v_inv.worker_email) then
    raise exception 'Approve the TRN for % on Applications first. It is asked just before their first payment, and their invoice to Yaadly is raised against it.',
      coalesce(nullif(btrim(v_inv.worker_email), ''), 'the worker')
      using errcode = 'check_violation';
  end if;
  v_why := public.worker_pay_client_unpaid(v_inv.id);
  if v_why is not null then
    raise exception '%', v_why using errcode = 'check_violation';
  end if;
  if v_method = 'stripe' and not exists (
       select 1 from stripe_payouts sp
        where sp.invoice_id = v_inv.id
          and sp.outbound_payment_id = v_ref
          and sp.status in ('processing', 'posted')) then
    raise exception 'No Stripe payout with id % is recorded for %. Pay with Stripe from Pay workers; do not record a Stripe payment by hand.',
      coalesce(nullif(v_ref, ''), '(none)'), v_inv.id
      using errcode = 'check_violation';
  end if;
  if v_method = 'moneygram' then
    if not public.moneygram_payouts_on() then
      raise exception 'MoneyGram pick-up is switched off. It opens once MoneyGram Business has approved Yaadly.'
        using errcode = 'check_violation';
    end if;
    if not exists (
         select 1 from worker_profiles w
          where lower(coalesce(w.worker_email, '')) = lower(btrim(coalesce(v_inv.worker_email, '')))
            and w.cash_pickup_name is not null) then
      raise exception '% has not given a name for cash pick-up. Pay them by bank transfer, or ask them to add pick-up on their payment page.',
        coalesce(nullif(btrim(v_inv.worker_email), ''), 'The worker')
        using errcode = 'check_violation';
    end if;
    if v_ref = '' then
      raise exception 'Give the MoneyGram transaction number from Yaadly''s MoneyGram Business receipt. Never the pick-up reference: that is phoned to the worker and not kept.'
        using errcode = 'check_violation';
    end if;
    if p_fee is null or p_fee < 0 or p_fee >= v_inv.total_pence then
      raise exception 'Give the MoneyGram fee that came off this pay. It must be less than the pay itself.'
        using errcode = 'check_violation';
    end if;
  elsif p_fee is not null then
    raise exception 'Only a MoneyGram pick-up records a fee off the worker''s pay.'
      using errcode = 'check_violation';
  end if;

  update invoices
     set status = 'paid', paid_method = v_method, paid_reference = v_ref,
         paid_fee_pence = case when v_method = 'moneygram' then p_fee end
   where id = p_invoice
  returning paid_at into v_at;

  return v_at;
end
$function$;

-- ── 6. The three desk buttons ─────────────────────────────────────────────
create or replace function public.pass_profile_stage(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin text := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
  a record;
  v_years int;
  v_slug text;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  if v_admin is null then
    raise exception 'No signed-in person to attribute this to.' using errcode = '28000';
  end if;

  select * into a from applications where id = p_id for update;
  if not found then
    raise exception 'No such application.' using errcode = 'check_violation';
  end if;
  if a.status = 'started' then
    raise exception 'They never pressed Send, so there is no profile to pass yet.' using errcode = 'check_violation';
  end if;
  if a.status in ('blocked', 'test') then
    raise exception 'This application is %. Change that first.', a.status using errcode = 'check_violation';
  end if;

  update applications
     set status        = 'passed',
         decided_by    = v_admin,
         decided_at    = now(),
         decision_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), decision_note)
   where id = p_id;

  v_years := nullif(regexp_replace(coalesce(a.years, ''), '\D', '', 'g'), '')::int;
  v_slug := coalesce(nullif(btrim(regexp_replace(lower(coalesce(a.name, '')), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'pro')
            || '-' || left(a.id::text, 6);

  insert into worker_profiles (application_id, worker_email, name, trade, parish, areas, years, about, phone, slug, active, vetting_state, updated_at)
  values (
    a.id,
    nullif(btrim(lower(coalesce(a.email, ''))), ''),
    left(coalesce(btrim(a.name), ''), 120),
    nullif(btrim(split_part(coalesce(a.trade, ''), ',', 1)), ''),
    nullif(btrim(split_part(coalesce(a.parish, ''), ',', 1)), ''),
    nullif(left(coalesce(a.parishes, ''), 400), ''),
    v_years,
    nullif(left(btrim(coalesce(a.work, '')), 1000), ''),
    nullif(btrim(coalesce(a.phone, '')), ''),
    v_slug,
    true,
    'probation',
    now()
  )
  on conflict (application_id) do update
     set active       = true,
         phone        = coalesce(nullif(btrim(worker_profiles.phone), ''), excluded.phone),
         worker_email = coalesce(nullif(btrim(worker_profiles.worker_email), ''), excluded.worker_email),
         about        = coalesce(nullif(btrim(worker_profiles.about), ''), excluded.about),
         updated_at   = now();
end;
$function$;

create or replace function public.pass_id_stage(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin text := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
  a record;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  if v_admin is null then
    raise exception 'No signed-in person to attribute this to.' using errcode = '28000';
  end if;

  select * into a from applications where id = p_id;
  if not found then
    raise exception 'No such application.' using errcode = 'check_violation';
  end if;

  -- The email they gave at the ID stage goes onto the profile, where the
  -- portal, the quote gate and the Guidelines signature look for it.
  update worker_profiles
     set id_checked_at = now(),
         id_checked_by = v_admin,
         worker_email  = coalesce(nullif(btrim(worker_email), ''), nullif(btrim(lower(coalesce(a.email, ''))), '')),
         updated_at    = now()
   where application_id = p_id and active is true and id_checked_at is null;

  if not found then
    if exists (select 1 from worker_profiles where application_id = p_id and id_checked_at is not null) then
      raise exception 'The ID stage is already passed for this worker.' using errcode = 'check_violation';
    end if;
    raise exception 'Pass the profile stage first. The ID stage is for a profile that is already live.' using errcode = 'check_violation';
  end if;

  if nullif(btrim(coalesce(p_note, '')), '') is not null then
    update applications set decision_note = btrim(p_note) where id = p_id;
  end if;
end;
$function$;

create or replace function public.set_application_trn(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin text := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
  a record;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  if v_admin is null then
    raise exception 'No signed-in person to attribute this to.' using errcode = '28000';
  end if;
  if p_status not in ('approved', 'rejected') then
    raise exception 'A TRN is approved or rejected.' using errcode = 'check_violation';
  end if;
  select * into a from applications where id = p_id for update;
  if not found then
    raise exception 'No such application.' using errcode = 'check_violation';
  end if;
  if p_status = 'approved' and length(regexp_replace(coalesce(a.trn, ''), '\D', '', 'g')) <> 9 then
    raise exception 'There is no nine digit TRN on this application to approve.' using errcode = 'check_violation';
  end if;
  update applications
     set trn_status = p_status, trn_checked_at = now()
   where id = p_id;
end;
$function$;

-- The worker gives their TRN from their own portal, just before their first
-- payment. Their own application only, found through their signed-in email.
-- It goes in as pending: a person checks it against the name on the ID.
create or replace function public.submit_my_trn(p_trn text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
  v_trn text := regexp_replace(coalesce(p_trn, ''), '\D', '', 'g');
  v_app uuid;
begin
  if v_email is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if length(v_trn) <> 9 then
    raise exception 'A TRN is nine digits.' using errcode = 'check_violation';
  end if;
  select application_id into v_app from worker_profiles
   where lower(coalesce(worker_email, '')) = v_email and application_id is not null
   limit 1;
  if v_app is null then
    raise exception 'No worker profile for this sign in.' using errcode = 'check_violation';
  end if;
  update applications
     set trn = v_trn, trn_status = 'pending', trn_checked_at = null
   where id = v_app and coalesce(trn_status, 'not_given') <> 'approved';
  if not found then
    raise exception 'Your TRN is already approved.' using errcode = 'check_violation';
  end if;
end;
$function$;

revoke all on function public.pass_profile_stage(uuid, text) from public, anon;
revoke all on function public.pass_id_stage(uuid, text) from public, anon;
revoke all on function public.set_application_trn(uuid, text) from public, anon;
revoke all on function public.submit_my_trn(text) from public, anon;
grant execute on function public.pass_profile_stage(uuid, text) to authenticated;
grant execute on function public.pass_id_stage(uuid, text) to authenticated;
grant execute on function public.set_application_trn(uuid, text) to authenticated;
grant execute on function public.submit_my_trn(text) to authenticated;

-- ── 7. The worker hears at each pass ──────────────────────────────────────
-- Profile stage: trg_application_passed (20261025183000) already fires
-- worker_passed when status becomes passed, and that message now says the
-- profile is live and links the ID stage. ID stage: this trigger used to fire
-- worker_cleared the moment a profile went live; going live is now the
-- profile stage, so it fires when the ID stage is passed instead, otherwise
-- every profile stage pass would send two messages.
create or replace function public.notify_worker_cleared()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.id_checked_at is not null
     and old.id_checked_at is null
     and new.id_checked_by is distinct from 'live before the two stages (25 Oct 2026)'
     and coalesce(new.worker_email, '') <> ''
  then
    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'workerEmail', new.worker_email, 'kind', 'worker_cleared'),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
end;
$function$;

comment on trigger trg_worker_cleared on public.worker_profiles is
  'Tells the worker, once, when a person passes their ID stage and they can quote. Fires only when id_checked_at is first set, after the ID stage gate has let it. Sends nothing to anybody else.';

-- ── 8. The job board says which profiles have passed the ID stage ─────────
create or replace view public.public_worker_profiles as
 select name,
    trade,
    parish,
    areas,
    lane,
    jobs_completed,
    about,
    years,
    vetting_state,
    slug,
    (id_checked_at is not null) as id_checked
   from worker_profiles wp
  where active and is_test = false;
