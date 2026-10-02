-- A worker with no bank account can be paid by MoneyGram cash pick-up.
--
-- Founder, 1 Oct 2026, reversing part of 14 Sep 2026 ("bank transfer only,
-- never cash"): "do western union pick up section for now for people that
-- don't have bank details", "as i dont want to cut out those workers". Then:
-- the worker pays the pick-up fee and is told so ("fee are deducted from
-- their total"), and it "has to done from my business account not my
-- personal". Western Union offers no sender route in a company's name for
-- cash pick-up, MoneyGram Business does, so: "Yes do the Money gram one".
--
-- WHAT CHANGES
--   1. app_settings 'moneygram_payouts', 'off' until MoneyGram Business has
--      approved Yaadly Ltd. moneygram_payouts_on() reads it. While it is off
--      a worker cannot choose pick-up and nobody can be marked paid by it.
--   2. worker_profiles.cash_pickup_name and cash_pickup_parish: the name
--      exactly as it shows on the worker's ID, and where they will collect.
--      Nothing else. No ID number, no pick-up reference. Set by the worker
--      with set_cash_pickup(); changing either clears the call-back, the
--      same as new bank details do, so a changed name is never paid unchecked.
--   3. invoices.paid_fee_pence: the MoneyGram fee that came off the worker's
--      pay. Same unit as total_pence (whole J$ for JMD). Only on a worker's
--      pay marked paid by MoneyGram, required there, written once.
--   4. mark_worker_paid() takes p_fee and accepts 'moneygram' only when the
--      switch is on, the worker has given a pick-up name, the call-back is
--      done, and a MoneyGram transaction number and the fee are given.
--
-- NO HUMAN GATE MOVES. Marking a worker paid is still one named person's
-- click, after the client has paid, after the call-back. MoneyGram is only a
-- third way the money goes out.
--
-- NOT HERE, ON PURPOSE
--   * Materials money (mark_materials_sent) stays bank transfer or Stripe.
--     Whether materials money can go by pick-up, and who pays that fee, is
--     the founder's call and not yet made.
--   * jobs.pay_method (the worker's own note, record_pay_info) is unchanged.
--   * The pick-up reference is never stored or messaged by Yaadly. It is a
--     key to cash: it is phoned to the worker.

begin;

-- ------------------------------------------------------------------ the switch

insert into public.app_settings (key, value)
values ('moneygram_payouts', 'off')
on conflict (key) do nothing;

create or replace function public.moneygram_payouts_on()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select value = 'on' from public.app_settings where key = 'moneygram_payouts'), false);
$function$;

comment on function public.moneygram_payouts_on() is
  'True once MoneyGram Business has approved Yaadly Ltd and the founder has set app_settings moneygram_payouts to on. 20261001194258.';

revoke execute on function public.moneygram_payouts_on() from public, anon;
grant execute on function public.moneygram_payouts_on() to authenticated;

-- ------------------------------------------------------------------ the worker's pick-up details

alter table public.worker_profiles
  add column if not exists cash_pickup_name   text,
  add column if not exists cash_pickup_parish text,
  add column if not exists cash_pickup_set_at timestamptz;

comment on column public.worker_profiles.cash_pickup_name is
  'For a worker with no bank account: their name exactly as it shows on their ID, for MoneyGram cash pick-up. Set by set_cash_pickup(). 20261001194258.';
comment on column public.worker_profiles.cash_pickup_parish is
  'The parish the worker will collect a MoneyGram pick-up in. 20261001194258.';
comment on column public.worker_profiles.cash_pickup_set_at is
  'When the worker last gave pick-up details. Stamped by trigger. New details clear the call-back.';

-- Restates the live guard (20260914240000) and adds the pick-up details to
-- what counts as new details.
create or replace function public.worker_bank_callback_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_who text := nullif(btrim(lower(coalesce(auth.jwt() ->> 'email', ''))), '');
begin
  if tg_op = 'INSERT' then
    if new.bank_callback_at is not null or btrim(coalesce(new.bank_callback_by, '')) <> '' then
      raise exception 'A call-back is recorded after the worker''s details exist, with confirm_bank_callback().'
        using errcode = 'check_violation';
    end if;
    new.cash_pickup_set_at := case when new.cash_pickup_name is null then null else now() end;
    return new;
  end if;

  -- New details: stamp them, and the old call-back no longer counts.
  if new.wise_recipient_id is distinct from old.wise_recipient_id then
    new.wise_recipient_set_at := case when new.wise_recipient_id is null then null else now() end;
    new.bank_callback_at := null;
    new.bank_callback_by := '';
  end if;
  if new.cash_pickup_name is distinct from old.cash_pickup_name
     or new.cash_pickup_parish is distinct from old.cash_pickup_parish then
    new.cash_pickup_set_at := case when new.cash_pickup_name is null then null else now() end;
    new.bank_callback_at := null;
    new.bank_callback_by := '';
  end if;
  if new.wise_recipient_id is distinct from old.wise_recipient_id
     or new.cash_pickup_name is distinct from old.cash_pickup_name
     or new.cash_pickup_parish is distinct from old.cash_pickup_parish then
    return new;
  end if;

  if new.wise_recipient_set_at is distinct from old.wise_recipient_set_at then
    new.wise_recipient_set_at := old.wise_recipient_set_at;
  end if;
  if new.cash_pickup_set_at is distinct from old.cash_pickup_set_at then
    new.cash_pickup_set_at := old.cash_pickup_set_at;
  end if;

  if new.bank_callback_at is distinct from old.bank_callback_at
     or new.bank_callback_by is distinct from old.bank_callback_by then
    if new.bank_callback_at is null then
      new.bank_callback_by := '';
      return new;
    end if;
    if v_who is null then
      raise exception 'A named person records the call-back. Nobody is signed in.' using errcode = '28000';
    end if;
    new.bank_callback_at := now();
    new.bank_callback_by := v_who;
  end if;
  return new;
end
$function$;

revoke all on function public.worker_bank_callback_guard() from public, anon, authenticated;

-- A worker sets or clears their own pick-up details. Workers cannot update
-- worker_profiles directly (RLS lets only an admin), so this is the one door.
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

comment on function public.set_cash_pickup(text, text) is
  'A signed-in worker gives (or, with an empty name, removes) the name on their ID and the parish for MoneyGram cash pick-up. Refused while moneygram_payouts is off. Clears the call-back. 20261001194258.';

revoke execute on function public.set_cash_pickup(text, text) from public, anon;
grant execute on function public.set_cash_pickup(text, text) to authenticated;

-- ------------------------------------------------------------------ the fee on the invoice

alter table public.invoices
  add column if not exists paid_fee_pence integer;

comment on column public.invoices.paid_fee_pence is
  'The MoneyGram fee that came off a worker''s pay, so the worker collected total_pence less this. Same unit as total_pence (whole J$ for JMD). Only on payable_to worker paid by moneygram. Written once, by mark_worker_paid(). 20261001194258.';

alter table public.invoices drop constraint if exists invoices_paid_method_check;
alter table public.invoices add constraint invoices_paid_method_check
  check (paid_method is null or paid_method in ('bank_transfer', 'stripe', 'moneygram'));

alter table public.invoices drop constraint if exists invoices_moneygram_is_worker_pay;
alter table public.invoices add constraint invoices_moneygram_is_worker_pay
  check (paid_method is distinct from 'moneygram' or payable_to = 'worker');

alter table public.invoices drop constraint if exists invoices_paid_fee_check;
alter table public.invoices add constraint invoices_paid_fee_check
  check (
    (paid_method is distinct from 'moneygram' and paid_fee_pence is null)
    or (paid_method = 'moneygram' and paid_fee_pence is not null
        and paid_fee_pence >= 0 and paid_fee_pence < total_pence)
  );

-- The fee is part of the payment record, so it is written with it and then
-- frozen, the same as paid_method and paid_reference in invoice_status_guard.
create or replace function public.invoice_paid_fee_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.paid_fee_pence is not null then
      raise exception 'A pick-up fee is recorded when the worker is marked paid, not before.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.paid_fee_pence is distinct from old.paid_fee_pence
     and not (old.status = 'sent' and new.status = 'paid') then
    raise exception 'The pick-up fee on invoice % is recorded once, when it is marked paid. It is not changed.', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end
$function$;

revoke all on function public.invoice_paid_fee_guard() from public, anon, authenticated;

drop trigger if exists trg_invoice_paid_fee_guard on public.invoices;
create trigger trg_invoice_paid_fee_guard
  before insert or update on public.invoices
  for each row execute function public.invoice_paid_fee_guard();

-- ------------------------------------------------------------------ the gate

-- Restates the live mark_worker_paid (20260917180000) with p_fee and the
-- moneygram branch. Callers passing three named arguments still resolve here.
drop function if exists public.mark_worker_paid(text, text, text);

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
  -- 20260914240000: nobody is paid on details nobody has checked by phone.
  if not public.worker_bank_checked(v_inv.worker_email) then
    raise exception 'Call % back on the number you have for them, check their bank or pick-up details, and press Call-back done on Pay workers first. Their details have not been checked by phone since they were last given.',
      coalesce(nullif(btrim(v_inv.worker_email), ''), 'the worker')
      using errcode = 'check_violation';
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
  -- 20261001194258: MoneyGram cash pick-up, from Yaadly's MoneyGram Business
  -- account, for a worker who has given the name on their ID.
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

comment on function public.mark_worker_paid(text, text, text, integer) is
  'A named admin records that a worker''s pay went out: bank_transfer, stripe (only after a recorded payout) or moneygram (only while switched on, for a worker with a pick-up name, with the transaction number and the fee that came off). After the call-back and after the client has paid. 20261001194258.';

revoke execute on function public.mark_worker_paid(text, text, text, integer) from public, anon;
grant execute on function public.mark_worker_paid(text, text, text, integer) to authenticated, service_role;

commit;
