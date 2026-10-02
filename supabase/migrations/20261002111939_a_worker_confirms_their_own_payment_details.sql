-- A worker confirms their own payment details with a tick, after a code
-- emailed to them; changed details wait 48 hours. The phone call-back goes.
--
-- Founder, 2 Oct 2026: "Remove the call back and just make it a tick process
-- where they confirm their details and tick a box to confirm they have
-- provided the correct details". Put to her: the person who gets into a
-- worker's login ticks the box too. She chose "Tick box + hold on changes":
-- first details, a tick and payable at once; changed details, a tick, an
-- alert to the worker, and payable after 48 hours unless they say it was not
-- them. Then: "a special code they have to type to get into their payments,
-- or a link that is sent to their emails", "Email now, WhatsApp later", and
-- the email carries a link that opens the payments page as well as the code.
--
-- WHAT CHANGES
--   1. worker_profiles.pay_details_*: when the worker ticked, which wording
--      they ticked, when their details last changed, the hold, and when they
--      said a change was not them. Nobody writes these directly, an admin
--      included: only the functions below and the trigger do.
--   2. pay_details_code_fresh(): the signed-in person came in by a code or a
--      link in the last 15 minutes. Read off their own sign-in token, so a
--      phone left signed in is not enough.
--   3. confirm_my_payment_details(version): the tick. Needs a fresh code.
--   4. trg_worker_pay_details_guard: new or changed details (Wise, cash
--      pick-up, Stripe recipient or Stripe bank account) clear the tick. A
--      change to details the worker had already given also holds them for
--      48 hours. The first details a worker ever gives are not held.
--   5. pay_details_not_me(email): the worker, or Yaadly for them, says a
--      change was not theirs. Nothing is paid until an admin clears it with
--      clear_pay_details_dispute(email), which also needs a fresh tick.
--   6. worker_pay_details_problem(email): why a worker cannot be paid yet,
--      or null. worker_bank_checked() keeps its name for its callers and now
--      means "no problem". mark_worker_paid() and mark_materials_sent() say
--      the reason instead of asking for a call-back.
--   7. set_cash_pickup() needs a fresh code too.
--   8. The four workers already called back carry over as confirmed.
--
-- NOT HERE: the email with the code and link, the alert when details change,
-- the portal tick box, the desk. Those are the next pieces. Until the portal
-- piece is live a worker cannot tick, so only the carried over workers can be
-- paid; apply this with the portal piece, not before.
--
-- WHAT THIS DOES NOT DO. The tick records that the worker said their details
-- were right. Whether that puts a loss on the worker when the account was
-- wrong is a legal question for the adviser, not settled by this file.
--
-- NO HUMAN GATE MOVES. Every payment is still one named person's click,
-- after the client has paid. The call-back, a second person's check, is
-- replaced by the worker's own confirmation behind a fresh emailed code, and
-- a 48 hour hold on changes.

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'worker_profiles'
                    and column_name = 'cash_pickup_name') then
    raise exception 'Apply 20261001194258 (MoneyGram) first. This migration restates the functions it defines.';
  end if;
end $$;

-- ------------------------------------------------------------------ columns

alter table public.worker_profiles
  add column if not exists pay_details_confirmed_at      timestamptz,
  add column if not exists pay_details_confirmed_version text,
  add column if not exists pay_details_changed_at        timestamptz,
  add column if not exists pay_details_hold_until        timestamptz,
  add column if not exists pay_details_disputed_at       timestamptz;

comment on column public.worker_profiles.pay_details_confirmed_at is
  'When the worker ticked to confirm their payment details are correct, after a fresh emailed code. Cleared when the details change. 20261002111939.';
comment on column public.worker_profiles.pay_details_confirmed_version is
  'Which wording the worker ticked (the portal''s PAY_DETAILS_VERSION), or call-back-carried-over.';
comment on column public.worker_profiles.pay_details_changed_at is
  'When the worker''s payment details last changed. Stamped by trigger.';
comment on column public.worker_profiles.pay_details_hold_until is
  'Changed details cannot be paid before this: 48 hours after a change to details the worker had already given.';
comment on column public.worker_profiles.pay_details_disputed_at is
  'When the worker said a change to their details was not them. Nothing is paid until an admin clears it.';

-- ------------------------------------------------------------------ the fresh code

create or replace function public.pay_details_code_fresh()
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then exists (
    select 1 from jsonb_array_elements(auth.jwt() -> 'amr') e
     where (e ->> 'timestamp') ~ '^[0-9]+$'
       and (e ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - 900
  ) else false end;
$function$;

comment on function public.pay_details_code_fresh() is
  'True when the signed-in person came in by an emailed code or link in the last 15 minutes, read off their sign-in token (amr). 20261002111939.';

revoke execute on function public.pay_details_code_fresh() from public, anon;
grant execute on function public.pay_details_code_fresh() to authenticated;

-- ------------------------------------------------------------------ the guard

create or replace function public.worker_pay_details_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_writer  boolean := coalesce(current_setting('yaadly.pay_details_writer', true), '') = 'on';
  v_details boolean;
  v_had     boolean;
begin
  if tg_op = 'INSERT' then
    if not v_writer and (new.pay_details_confirmed_at is not null or new.pay_details_confirmed_version is not null
        or new.pay_details_hold_until is not null or new.pay_details_disputed_at is not null) then
      raise exception 'A worker confirms their own payment details, with the code Yaadly emails them.'
        using errcode = 'check_violation';
    end if;
    new.pay_details_changed_at := case
      when new.wise_recipient_id is not null or new.cash_pickup_name is not null or new.stripe_payout_method_id is not null
      then now() end;
    return new;
  end if;

  if not v_writer and (
       new.pay_details_confirmed_at is distinct from old.pay_details_confirmed_at
    or new.pay_details_confirmed_version is distinct from old.pay_details_confirmed_version
    or new.pay_details_changed_at is distinct from old.pay_details_changed_at
    or new.pay_details_hold_until is distinct from old.pay_details_hold_until
    or new.pay_details_disputed_at is distinct from old.pay_details_disputed_at) then
    raise exception 'A worker confirms their own payment details, with the code Yaadly emails them. They are not written directly.'
      using errcode = 'check_violation';
  end if;

  v_details := new.wise_recipient_id is distinct from old.wise_recipient_id
            or new.cash_pickup_name is distinct from old.cash_pickup_name
            or new.cash_pickup_parish is distinct from old.cash_pickup_parish
            or new.stripe_payout_method_id is distinct from old.stripe_payout_method_id;

  -- A new Stripe recipient has no bank account yet, so it is not held, but
  -- the tick no longer describes what Stripe will pay.
  if v_details or new.stripe_recipient_id is distinct from old.stripe_recipient_id then
    new.pay_details_confirmed_at := null;
    new.pay_details_confirmed_version := null;
  end if;

  if v_details then
    v_had := old.pay_details_changed_at is not null or old.pay_details_confirmed_at is not null
          or old.wise_recipient_id is not null or old.cash_pickup_name is not null
          or old.stripe_payout_method_id is not null;
    if v_had then
      -- Only ever later: taking details off and putting new ones on does not
      -- shorten the wait.
      new.pay_details_hold_until := greatest(coalesce(old.pay_details_hold_until, now()), now() + interval '48 hours');
    end if;
    new.pay_details_changed_at := now();
  end if;
  return new;
end
$function$;

revoke all on function public.worker_pay_details_guard() from public, anon, authenticated;

drop trigger if exists trg_worker_pay_details_guard on public.worker_profiles;
create trigger trg_worker_pay_details_guard
  before insert or update on public.worker_profiles
  for each row execute function public.worker_pay_details_guard();

-- ------------------------------------------------------------------ why not, yet

create or replace function public.worker_pay_details_problem(p_worker_email text)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_email    text := lower(btrim(coalesce(p_worker_email, '')));
  v_who      text := coalesce(nullif(btrim(p_worker_email), ''), 'the worker');
  v_rows     int;
  v_disputed timestamptz;
  v_hold     timestamptz;
  v_changed  timestamptz;
  v_unticked int;
begin
  select count(*), max(pay_details_disputed_at), max(pay_details_hold_until), max(pay_details_changed_at),
         count(*) filter (where pay_details_confirmed_at is null)
    into v_rows, v_disputed, v_hold, v_changed, v_unticked
    from worker_profiles
   where v_email <> '' and lower(coalesce(worker_email, '')) = v_email;

  if v_rows = 0 then
    return format('No worker profile has the email %s.', v_who);
  end if;
  if v_disputed is not null then
    return format('%s told Yaadly on %s that a change to their payment details was not them. Nothing is paid until that is sorted out with them and cleared on Pay workers.',
      v_who, to_char(v_disputed at time zone 'America/Jamaica', 'FMDD Mon YYYY'));
  end if;
  if v_hold is not null and v_hold > now() then
    return format('%s changed their payment details on %s. Changed details can be paid from %s Jamaica time, 48 hours after the change, unless they say it was not them.',
      v_who, to_char(coalesce(v_changed, now()) at time zone 'America/Jamaica', 'FMDD Mon YYYY'),
      to_char(v_hold at time zone 'America/Jamaica', 'FMDD Mon YYYY at FMHH12:MI am'));
  end if;
  if v_unticked > 0 then
    return format('%s has not confirmed their payment details since they were last given. They do it on "How Yaadly pays you" in their portal, with the code Yaadly emails them.', v_who);
  end if;
  return null;
end
$function$;

comment on function public.worker_pay_details_problem(text) is
  'Why a worker cannot be paid yet (not confirmed, changed details on hold, or disputed), or null when they can. 20261002111939.';

revoke execute on function public.worker_pay_details_problem(text) from public, anon;
grant execute on function public.worker_pay_details_problem(text) to authenticated, service_role;

-- The name stays: mark_worker_paid, mark_materials_sent and yaad-payout-send
-- all ask it. It no longer means a call-back.
create or replace function public.worker_bank_checked(p_worker_email text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.worker_pay_details_problem(p_worker_email) is null;
$function$;

comment on function public.worker_bank_checked(text) is
  'True when the worker can be paid on their details: confirmed by them with a fresh code, not on hold, not disputed. Since 20261002111939; was the phone call-back.';

revoke execute on function public.worker_bank_checked(text) from public, anon, authenticated;

-- ------------------------------------------------------------------ the tick

create or replace function public.confirm_my_payment_details(p_version text)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := nullif(btrim(lower(coalesce(auth.jwt() ->> 'email', ''))), '');
  v_n     int;
begin
  if auth.uid() is null or v_email is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;
  -- The wording on the portal and this version move together (web PAY_DETAILS_VERSION).
  if p_version is distinct from 'pay-details-v1' then
    raise exception 'This page is out of date. Reload it and tick again.' using errcode = 'check_violation';
  end if;
  if not public.pay_details_code_fresh() then
    raise exception 'Enter the code Yaadly emailed you, or open the link in that email, then tick again.' using errcode = '28000';
  end if;
  if exists (select 1 from worker_profiles where lower(coalesce(worker_email, '')) = v_email
               and pay_details_disputed_at is not null) then
    raise exception 'You told Yaadly a change to your payment details was not you, so payments are paused. Yaadly will contact you.'
      using errcode = 'check_violation';
  end if;

  perform set_config('yaadly.pay_details_writer', 'on', true);
  update worker_profiles
     set pay_details_confirmed_at = now(), pay_details_confirmed_version = p_version
   where lower(coalesce(worker_email, '')) = v_email;
  get diagnostics v_n = row_count;
  perform set_config('yaadly.pay_details_writer', 'off', true);
  if v_n = 0 then
    raise exception 'There is no Yaadly worker profile for this sign-in.' using errcode = 'check_violation';
  end if;
  return now();
end
$function$;

comment on function public.confirm_my_payment_details(text) is
  'The worker ticks to confirm the payment details they gave are correct. Needs a code or link from the last 15 minutes. 20261002111939.';

revoke execute on function public.confirm_my_payment_details(text) from public, anon;
grant execute on function public.confirm_my_payment_details(text) to authenticated;

-- ------------------------------------------------------------------ not me

create or replace function public.pay_details_not_me(p_worker_email text)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := nullif(btrim(lower(coalesce(p_worker_email, ''))), '');
  v_self  text := nullif(btrim(lower(coalesce(auth.jwt() ->> 'email', ''))), '');
  v_n     int;
begin
  -- The worker themselves, an admin, or the service role (the "this was not
  -- me" link in the alert email, which carries its own signed token).
  if not (coalesce(auth.jwt() ->> 'role', '') = 'service_role' or public.is_admin()
          or (v_self is not null and v_self = v_email)) then
    raise exception 'Not allowed.' using errcode = '28000';
  end if;
  if v_email is null then
    raise exception 'Say which worker.' using errcode = 'check_violation';
  end if;
  perform set_config('yaadly.pay_details_writer', 'on', true);
  update worker_profiles set pay_details_disputed_at = coalesce(pay_details_disputed_at, now())
   where lower(coalesce(worker_email, '')) = v_email;
  get diagnostics v_n = row_count;
  perform set_config('yaadly.pay_details_writer', 'off', true);
  if v_n = 0 then
    raise exception 'No worker profile has that email.' using errcode = 'check_violation';
  end if;
  return now();
end
$function$;

comment on function public.pay_details_not_me(text) is
  'The worker says a change to their payment details was not them. Pauses all payment to them until an admin clears it. 20261002111939.';

revoke execute on function public.pay_details_not_me(text) from public, anon;
grant execute on function public.pay_details_not_me(text) to authenticated, service_role;

create or replace function public.clear_pay_details_dispute(p_worker_email text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := nullif(btrim(lower(coalesce(p_worker_email, ''))), '');
  v_n     int;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  perform set_config('yaadly.pay_details_writer', 'on', true);
  -- Cleared, and the worker ticks again: whatever was sorted out, the tick
  -- describes the details as they are now.
  update worker_profiles
     set pay_details_disputed_at = null, pay_details_confirmed_at = null, pay_details_confirmed_version = null
   where lower(coalesce(worker_email, '')) = v_email and pay_details_disputed_at is not null;
  get diagnostics v_n = row_count;
  perform set_config('yaadly.pay_details_writer', 'off', true);
  if v_n = 0 then
    raise exception 'That worker has nothing to clear.' using errcode = 'check_violation';
  end if;
end
$function$;

comment on function public.clear_pay_details_dispute(text) is
  'An admin clears a worker''s "not me" once it is sorted out with them. The worker then confirms their details again. 20261002111939.';

revoke execute on function public.clear_pay_details_dispute(text) from public, anon;
grant execute on function public.clear_pay_details_dispute(text) to authenticated;

-- ------------------------------------------------------------------ pick-up needs the code too

create or replace function public.set_cash_pickup(p_name text, p_parish text)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_name   text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  v_parish text := nullif(btrim(coalesce(p_parish, '')), '');
  v_n      int;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;
  -- 20261002111939: payment details change only with a fresh emailed code.
  if not public.pay_details_code_fresh() then
    raise exception 'Enter the code Yaadly emailed you, or open the link in that email, then try again.' using errcode = '28000';
  end if;

  if v_name is null then
    update worker_profiles set cash_pickup_name = null, cash_pickup_parish = null
     where worker_user = v_uid;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'There is no Yaadly worker profile for this sign-in.' using errcode = 'check_violation';
    end if;
    return null;
  end if;

  if not public.moneygram_payouts_on() then
    raise exception 'Cash pick-up is not open yet. Yaadly will tell you when it is.' using errcode = 'check_violation';
  end if;
  if length(v_name) < 3 or length(v_name) > 80 or v_name !~ '[[:alpha:]]' then
    raise exception 'Type your full name exactly as it shows on your ID.' using errcode = 'check_violation';
  end if;
  if v_parish is null or v_parish not in (
       'Kingston', 'St Andrew', 'St Catherine', 'Clarendon', 'Manchester',
       'St Elizabeth', 'Westmoreland', 'Hanover', 'St James', 'Trelawny',
       'St Ann', 'St Mary', 'Portland', 'St Thomas') then
    raise exception 'Choose the parish you will collect in.' using errcode = 'check_violation';
  end if;

  update worker_profiles set cash_pickup_name = v_name, cash_pickup_parish = v_parish
   where worker_user = v_uid;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'There is no Yaadly worker profile for this sign-in.' using errcode = 'check_violation';
  end if;
  return now();
end
$function$;

-- ------------------------------------------------------------------ the gates, reworded

-- Restates 20261001194258's mark_worker_paid; only the details check changes.
create or replace function public.mark_worker_paid(p_invoice text, p_method text, p_ref text default ''::text, p_fee integer default null)
returns timestamptz
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
  -- 20261002111939: paid only on details the worker confirmed, not on hold, not disputed.
  v_why := public.worker_pay_details_problem(v_inv.worker_email);
  if v_why is not null then
    raise exception '%', v_why using errcode = 'check_violation';
  end if;
  -- 20260917180000: a worker is paid only after the client has paid for the work.
  v_why := public.worker_pay_client_unpaid(v_inv.id);
  if v_why is not null then
    raise exception '%', v_why using errcode = 'check_violation';
  end if;
  -- 20260916120000: "paid by Stripe" only ever follows a payout that went out.
  if v_method = 'stripe' and not exists (
       select 1 from stripe_payouts sp
        where sp.invoice_id = v_inv.id
          and sp.outbound_payment_id = v_ref
          and sp.status in ('processing', 'posted')) then
    raise exception 'No Stripe payout with id % is recorded for %. Pay with Stripe from Pay workers; do not record a Stripe payment by hand.',
      coalesce(nullif(v_ref, ''), '(none)'), v_inv.id
      using errcode = 'check_violation';
  end if;
  -- 20261001194258: MoneyGram cash pick-up.
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

-- Restates the live mark_materials_sent (20260916120000); only the details check changes.
create or replace function public.mark_materials_sent(p_release uuid, p_method text, p_ref text default ''::text)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rel    materials_releases%rowtype;
  v_method text := nullif(btrim(lower(coalesce(p_method, ''))), '');
  v_ref    text := btrim(coalesce(p_ref, ''));
  v_worker text;
  v_why    text;
  v_at     timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  if v_method is null or v_method not in ('bank_transfer', 'stripe') then
    raise exception 'Say how it was sent: bank_transfer or stripe.'
      using errcode = 'check_violation';
  end if;

  select * into v_rel from materials_releases where id = p_release for update;
  if not found then
    raise exception 'No such materials release.' using errcode = 'check_violation';
  end if;
  if v_rel.released_at is null then
    raise exception 'That tranche has not been released, so there is nothing to send.' using errcode = 'check_violation';
  end if;
  if v_rel.sent_at is not null then
    raise exception 'This materials money was already marked sent on % by %.',
      to_char(v_rel.sent_at at time zone 'America/Jamaica', 'FMDD Mon YYYY'), v_rel.sent_by
      using errcode = 'check_violation';
  end if;
  -- 20261002111939: sent only on details the worker confirmed, not on hold, not disputed.
  select worker_email into v_worker from jobs where id = v_rel.job_id;
  v_why := public.worker_pay_details_problem(v_worker);
  if v_why is not null then
    raise exception '%', v_why using errcode = 'check_violation';
  end if;
  -- 20260916120000: "sent by Stripe" only ever follows a payout that went out.
  if v_method = 'stripe' and not exists (
       select 1 from stripe_payouts sp
        where sp.materials_release_id = v_rel.id
          and sp.outbound_payment_id = v_ref
          and sp.status in ('processing', 'posted')) then
    raise exception 'No Stripe payout with id % is recorded for this tranche. Pay with Stripe from the desk; do not record a Stripe payment by hand.',
      coalesce(nullif(v_ref, ''), '(none)')
      using errcode = 'check_violation';
  end if;

  update materials_releases
     set sent_at = now(), sent_method = v_method, sent_ref = v_ref
   where id = p_release
  returning sent_at into v_at;

  return v_at;
end
$function$;

-- ------------------------------------------------------------------ carry over

-- A worker already checked by phone has had a stronger check than a tick.
select set_config('yaadly.pay_details_writer', 'on', true);
update public.worker_profiles
   set pay_details_confirmed_at = bank_callback_at, pay_details_confirmed_version = 'call-back-carried-over'
 where bank_callback_at is not null and pay_details_confirmed_at is null;
select set_config('yaadly.pay_details_writer', 'off', true);

commit;
