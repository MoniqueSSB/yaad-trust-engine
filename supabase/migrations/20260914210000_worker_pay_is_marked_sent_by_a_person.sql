-- A worker's pay is marked sent by a named person, once, and only then is the
-- worker told it is on its way.
--
-- Founder, 14 Sep 2026: "SET UP THIS WORKFLOW NOW IN THE PORTAL", of the
-- interim way to pay a worker while Stripe enables cross-border payouts: pay
-- from the business bank app, then record it on the desk. Materials money
-- already worked that way (mark_materials_sent, 20260914190000). A worker's
-- pay invoice did not: the desk's only control was a generic "Mark as paid"
-- prompt shared with client bills. It recorded no person, no method, could be
-- edited afterwards, and told the worker nothing.
--
-- Yaadly stores no worker bank details (founder, 14 Sep 2026). The payee
-- lives in the business bank's own app; nothing here names an account.
--
-- WHAT CHANGES
--   1. invoices.paid_by and invoices.paid_method. paid_by is written by the
--      trigger from the signed-in person on every invoice marked paid, client
--      bills included, never by the caller. paid_method is 'bank_transfer'
--      only for now; Stripe is added in its own migration once Global Payouts
--      can actually pay Jamaica, so the check cannot be met by a button that
--      does not work yet. Blank on every existing row.
--   2. invoice_status_guard, redefined with the same rules as before plus:
--      a worker's pay invoice goes to paid only with a method recorded (so the
--      generic prompt, or a plain UPDATE, cannot skip the record), and once an
--      invoice is paid its payment record (paid_at, paid_by, paid_method,
--      paid_reference) is never changed.
--   3. mark_worker_paid(invoice, method, reference): admin only, on a sent
--      worker pay invoice, once.
--   4. The worker is told: when a worker pay invoice goes to paid, the shared
--      trigger shape calls yaad-notify-client with kind worker_paid and the
--      invoice id. Never text. The function reads the row itself.
--
-- NO HUMAN GATE MOVES. Marking a worker paid is a named person saying they
-- sent the money. It moves no money itself. The stage approval that raises
-- the pay invoice (20260913223042) is untouched.

begin;

alter table public.invoices
  add column if not exists paid_by     text not null default '',
  add column if not exists paid_method text;

alter table public.invoices drop constraint if exists invoices_paid_method_check;
alter table public.invoices add constraint invoices_paid_method_check
  check (paid_method is null or paid_method in ('bank_transfer'));

comment on column public.invoices.paid_by is
  'Who marked this invoice paid: the signed-in admin''s email, written by invoice_status_guard, never by the caller. Blank on invoices paid before 20260914210000.';
comment on column public.invoices.paid_method is
  'How a worker''s pay went out. bank_transfer only, until Stripe Global Payouts is live. Required to mark a worker pay invoice paid; null on client bills. Yaadly stores no worker bank details. 20260914210000.';

-- ------------------------------------------------------------------ guard

create or replace function public.invoice_status_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_unpriced integer;
  v_lines    integer;
  v_who      text := nullif(btrim(lower(coalesce(auth.jwt() ->> 'email', ''))), '');
begin
  -- A paid invoice's payment record is written once (20260914210000).
  if old.status = 'paid' then
    if new.paid_at is distinct from old.paid_at or new.paid_by is distinct from old.paid_by
       or new.paid_method is distinct from old.paid_method or new.paid_reference is distinct from old.paid_reference then
      raise exception 'Invoice % was marked paid on %. That record is not changed: add a note instead.',
        old.id, coalesce(to_char(old.paid_at at time zone 'America/Jamaica', 'FMDD Mon YYYY'), 'an earlier date')
          || case when btrim(coalesce(old.paid_by, '')) <> '' then ' by ' || old.paid_by else '' end
        using errcode = 'check_violation';
    end if;
  end if;

  if new.status = old.status then
    if new.status <> 'paid'
       and (new.paid_method is distinct from old.paid_method or new.paid_by is distinct from old.paid_by) then
      raise exception 'How an invoice was paid is recorded when it is marked paid, not before.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.status = 'draft' and new.status = 'sent' then
    select count(*) filter (where price_source = 'needs_price'), count(*)
      into v_unpriced, v_lines
      from public.invoice_lines where invoice_id = new.id;
    if v_lines = 0 then
      raise exception 'invoice % has no lines', new.id;
    end if;
    if v_unpriced > 0 then
      raise exception 'invoice % has % line(s) the agent could not price. Price them or remove them before sending.', new.id, v_unpriced;
    end if;
    new.sent_at := now();

  elsif old.status = 'sent' and new.status = 'paid' then
    if not public.is_admin() then
      raise exception 'only a signed-in Yaadly admin may mark an invoice paid';
    end if;
    if new.payable_to = 'worker' and new.paid_method is null then
      raise exception 'Pay the worker from your business bank app, then press Mark as sent on the desk''s Pay workers view. That records how the money went and tells the worker.'
        using errcode = 'check_violation';
    end if;
    new.paid_at := now();
    new.paid_by := coalesce(v_who, '');

  elsif new.status = 'void' and old.status in ('draft','sent') then
    if not public.is_admin() then
      raise exception 'only a signed-in Yaadly admin may void an invoice';
    end if;

  else
    raise exception 'invoice % cannot go from % to %', new.id, old.status, new.status;
  end if;

  new.updated_at := now();
  return new;
end $function$;

-- ------------------------------------------------------------------ the step

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

  update invoices
     set status = 'paid', paid_method = v_method, paid_reference = btrim(coalesce(p_ref, ''))
   where id = p_invoice
  returning paid_at into v_at;

  return v_at;
end
$function$;

comment on function public.mark_worker_paid(text, text, text) is
  'A named admin records that a worker''s pay invoice has been paid to them: how, and the transfer reference. Once, never changed. Fires the worker''s WhatsApp. Moves no money itself. 20260914210000.';

revoke execute on function public.mark_worker_paid(text, text, text) from public, anon;
grant execute on function public.mark_worker_paid(text, text, text) to authenticated;

-- ------------------------------------------------------------------ the worker is told

create or replace function public.notify_worker_paid()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.payable_to = 'worker' and new.job_id is not null
     and new.status = 'paid' and old.status is distinct from 'paid' then
    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id,
        'kind', 'worker_paid', 'meta', jsonb_build_object('invoiceId', new.id)),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
end
$function$;

revoke all on function public.notify_worker_paid() from public, anon, authenticated;

drop trigger if exists trg_notify_worker_paid on public.invoices;
create trigger trg_notify_worker_paid
  after update of status on public.invoices
  for each row execute function public.notify_worker_paid();

commit;
