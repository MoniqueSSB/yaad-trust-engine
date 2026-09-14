-- A worker gives their bank details straight to Wise, and nobody is paid
-- until a person has called them back to check.
--
-- Founder, 14 Sep 2026: Yaadly pays workers by bank transfer through its Wise
-- Business account, stores no worker bank details, and asked for "both": the
-- call-back process, and a form in the worker portal that puts the details
-- straight into Wise. Then "yes on both": the Wise access key risk is
-- accepted, and the call-back is REQUIRED before money is marked sent.
--
-- WHAT CHANGES
--   1. worker_profiles.wise_recipient_id and wise_recipient_set_at. Written by
--      yaad-wise-recipient with the service role after Wise accepts the
--      worker's details. Wise's reference only: no account number, no SWIFT,
--      no address is stored here or anywhere in this database.
--   2. worker_profiles.bank_callback_at and bank_callback_by: a named person
--      has phoned the worker on the number already on file and checked the
--      details. Set only through confirm_bank_callback(); stamped by trigger
--      with the signed-in person, whatever the caller wrote. New details (a
--      new Wise reference) clear it, so changed details are never paid
--      unchecked. That is the protection against somebody who gets into a
--      worker's login and puts in their own account.
--   3. mark_worker_paid() and mark_materials_sent() refuse until the worker's
--      call-back is recorded. Details taken by phone need it as well: the
--      call-back is the check, however the details arrived.
--
-- NO HUMAN GATE MOVES; ONE IS ADDED. Marking money sent is still one named
-- person's click. The call-back is a second named person's check before it.

begin;

alter table public.worker_profiles
  add column if not exists wise_recipient_id     text,
  add column if not exists wise_recipient_set_at timestamptz,
  add column if not exists bank_callback_at      timestamptz,
  add column if not exists bank_callback_by      text not null default '';

comment on column public.worker_profiles.wise_recipient_id is
  'Wise''s id for this worker as a recipient in Yaadly''s Wise Business account. The bank details themselves live only in Wise. Written by yaad-wise-recipient. 20260914240000.';
comment on column public.worker_profiles.wise_recipient_set_at is
  'When the worker last gave their bank details through the portal. Stamped by trigger.';
comment on column public.worker_profiles.bank_callback_at is
  'When a person phoned the worker on the number on file and checked their bank details. Cleared whenever new details arrive. Required before money is marked sent. 20260914240000.';
comment on column public.worker_profiles.bank_callback_by is
  'Who did the call-back: the signed-in admin''s email, written by trigger.';

-- ------------------------------------------------------------------ guard

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
    return new;
  end if;

  -- New details: stamp them, and the old call-back no longer counts.
  if new.wise_recipient_id is distinct from old.wise_recipient_id then
    new.wise_recipient_set_at := case when new.wise_recipient_id is null then null else now() end;
    new.bank_callback_at := null;
    new.bank_callback_by := '';
    return new;
  end if;
  if new.wise_recipient_set_at is distinct from old.wise_recipient_set_at then
    new.wise_recipient_set_at := old.wise_recipient_set_at;
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

drop trigger if exists trg_worker_bank_callback_guard on public.worker_profiles;
create trigger trg_worker_bank_callback_guard
  before insert or update on public.worker_profiles
  for each row execute function public.worker_bank_callback_guard();

-- ------------------------------------------------------------------ the call-back

create or replace function public.confirm_bank_callback(p_worker_email text)
returns timestamptz
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
  if v_email is null then
    raise exception 'Say which worker.' using errcode = 'check_violation';
  end if;
  update worker_profiles set bank_callback_at = now()
   where lower(coalesce(worker_email, '')) = v_email;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'No worker profile has that email.' using errcode = 'check_violation';
  end if;
  return now();
end
$function$;

comment on function public.confirm_bank_callback(text) is
  'A named admin records that they phoned the worker on the number on file and checked their bank details. Cleared by new details. Required before money is marked sent. 20260914240000.';

revoke execute on function public.confirm_bank_callback(text) from public, anon;
grant execute on function public.confirm_bank_callback(text) to authenticated;

create or replace function public.worker_bank_checked(p_worker_email text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.worker_profiles
     where lower(coalesce(worker_email, '')) = lower(btrim(coalesce(p_worker_email, '')))
       and bank_callback_at is not null
  );
$function$;

revoke execute on function public.worker_bank_checked(text) from public, anon, authenticated;

-- ------------------------------------------------------------------ the gates

create or replace function public.mark_worker_paid(p_invoice text, p_method text, p_ref text default ''::text)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inv    invoices%rowtype;
  v_method text := nullif(btrim(lower(coalesce(p_method, ''))), '');
  v_at     timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  if v_method is distinct from 'bank_transfer' then
    raise exception 'Only a bank transfer can be recorded for now. Stripe payouts are not set up yet.'
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
    raise exception 'Call % back on the number you have for them, check their bank details, and press Call-back done on Pay workers first. Their details have not been checked by phone since they were last given.',
      coalesce(nullif(btrim(v_inv.worker_email), ''), 'the worker')
      using errcode = 'check_violation';
  end if;

  update invoices
     set status = 'paid', paid_method = v_method, paid_reference = btrim(coalesce(p_ref, ''))
   where id = p_invoice
  returning paid_at into v_at;

  return v_at;
end
$function$;

create or replace function public.mark_materials_sent(p_release uuid, p_method text, p_ref text default ''::text)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rel    materials_releases%rowtype;
  v_method text := nullif(btrim(lower(coalesce(p_method, ''))), '');
  v_worker text;
  v_at     timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  if v_method is distinct from 'bank_transfer' then
    raise exception 'Only a bank transfer can be recorded for now. Stripe payouts are not set up yet.'
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
  -- 20260914240000: nobody is paid on details nobody has checked by phone.
  select worker_email into v_worker from jobs where id = v_rel.job_id;
  if not public.worker_bank_checked(v_worker) then
    raise exception 'Call % back on the number you have for them, check their bank details, and press Call-back done on Pay workers first. Their details have not been checked by phone since they were last given.',
      coalesce(nullif(btrim(v_worker), ''), 'the worker')
      using errcode = 'check_violation';
  end if;

  update materials_releases
     set sent_at = now(), sent_method = v_method, sent_ref = btrim(coalesce(p_ref, ''))
   where id = p_release
  returning sent_at into v_at;

  return v_at;
end
$function$;

commit;
