-- A worker can be paid by Stripe Global Payouts, by a named person's click.
--
-- Founder, 16 Sep 2026: "build this out". Global Payouts turned out to be
-- enabled on the live Stripe account already (Dashboard, Recipients, Jamaica
-- offered), card payments were proven live the same morning, and Stripe
-- support had confirmed the corridor: the worker receives J$, Stripe converts
-- from GBP, the fees fall on Yaadly, landing 1 to 7 business days.
--
-- WHAT CHANGES
--   invoices.paid_method             may now be 'stripe' as well as
--                                    'bank_transfer'.
--   materials_releases.sent_method   the same.
--   stripe_payouts                   NEW. One row per payout Yaadly sends
--                                    through Stripe: who sent it, what the
--                                    worker receives, what left the GBP
--                                    account, the fees and rate the person
--                                    saw before pressing Send, Stripe's
--                                    payout id and its status as last read.
--   mark_worker_paid()               accepts 'stripe', and only with a
--   mark_materials_sent()            stripe_payouts row for that invoice or
--                                    tranche carrying the same Stripe id.
--                                    So "paid by Stripe" cannot be recorded
--                                    by hand on the desk: it can only follow
--                                    a payout that actually went out.
--
-- WHAT DOES NOT CHANGE
--   Nothing sends by itself. yaad-payout-send makes the Stripe quote, shows
--   it to a person on the desk, and only on their second, separate click
--   creates the payout and then calls mark_worker_paid with THEIR session, so
--   paid_by is the person, never the function (CLAUDE.md §2).
--   The call-back gate (20260914240000) still stands for every method: a
--   Stripe recipient typed their details into Stripe's form, but nobody is
--   paid until a person has phoned them and pressed Call-back done.
--   Wise stays the way workers are paid unless the founder says otherwise;
--   this adds a second way, it removes nothing.
--
-- WHY A FAILED PAYOUT DOES NOT UN-PAY THE INVOICE
--   Stripe posts a payout asynchronously; it can fail or be returned days
--   later. The invoice record is frozen once paid (20260914230000), by design.
--   The stripe_payouts row carries the later status, the desk shows it in
--   red, and a person decides what to do: pay again, or correct with a note.
--   Nothing silently flips money records.

begin;

-- ---------------------------------------------------------------- methods

alter table public.invoices drop constraint if exists invoices_paid_method_check;
alter table public.invoices add constraint invoices_paid_method_check
  check (paid_method is null or paid_method in ('bank_transfer', 'stripe'));
comment on column public.invoices.paid_method is
  'How a worker''s pay went out: bank_transfer (Wise, by hand) or stripe (Global Payouts, yaad-payout-send). Required to mark a worker pay invoice paid; null on client bills. 20260916120000.';

alter table public.materials_releases drop constraint if exists materials_releases_sent_method_check;
alter table public.materials_releases add constraint materials_releases_sent_method_check
  check (sent_method is null or sent_method in ('bank_transfer', 'stripe'));
comment on column public.materials_releases.sent_method is
  'How the materials money was sent: bank_transfer (Wise, by hand) or stripe (Global Payouts). Yaadly stores no worker bank details: the payee lives in Wise or in Stripe. 20260916120000.';

-- ---------------------------------------------------------------- the record

create table if not exists public.stripe_payouts (
  id                    uuid primary key default gen_random_uuid(),
  invoice_id            text references public.invoices(id),
  materials_release_id  uuid references public.materials_releases(id),
  job_id                text,
  worker_email          text not null,
  recipient_id          text not null,
  payout_method_id      text,
  financial_account     text not null,
  amount_value          bigint not null,
  amount_currency       text not null,
  debited_value         bigint,
  debited_currency      text,
  fees                  jsonb not null default '[]'::jsonb,
  fx_rate               text,
  quote_id              text,
  quote_is_estimate     boolean not null default false,
  outbound_payment_id   text unique,
  status                text not null default 'processing',
  status_detail         text,
  receipt_url           text,
  trace_id              text,
  expected_arrival      timestamptz,
  livemode              boolean not null default false,
  sent_by               text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint stripe_payouts_status_check
    check (status in ('processing', 'posted', 'failed', 'canceled', 'returned')),
  constraint stripe_payouts_one_target_check
    check (((invoice_id is not null)::int + (materials_release_id is not null)::int) = 1)
);

comment on table public.stripe_payouts is
  'One row per payout Yaadly sent a worker through Stripe Global Payouts. amount_* is what the worker receives (minor units, JMD x100); debited_* is what left the GBP financial account; fees and fx_rate are what the person saw before pressing Send. status follows Stripe as last read by yaad-payout-send. Written only by that function with the service role. 20260916120000.';
comment on column public.stripe_payouts.sent_by is
  'The named person who pressed Send on the desk. Read from their session by yaad-payout-send, never from the request body.';
comment on column public.stripe_payouts.quote_is_estimate is
  'true when Stripe would not give a quote in advance and the fees shown were the published rates, not a locked quote.';

create index if not exists stripe_payouts_invoice_idx  on public.stripe_payouts (invoice_id);
create index if not exists stripe_payouts_release_idx  on public.stripe_payouts (materials_release_id);
create index if not exists stripe_payouts_status_idx   on public.stripe_payouts (status) where status <> 'posted';

alter table public.stripe_payouts enable row level security;

drop policy if exists stripe_payouts_admin_select on public.stripe_payouts;
create policy stripe_payouts_admin_select on public.stripe_payouts
  for select to authenticated using (public.is_admin());
-- No insert, update or delete policy on purpose: only the service role, which
-- is only yaad-payout-send, writes here. The desk reads it.

revoke all on public.stripe_payouts from anon;
grant select on public.stripe_payouts to authenticated;

-- ---------------------------------------------------------------- the gates

create or replace function public.mark_worker_paid(p_invoice text, p_method text, p_ref text default ''::text)
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
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  if v_method is null or v_method not in ('bank_transfer', 'stripe') then
    raise exception 'Say how it was paid: bank_transfer or stripe.'
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

  update invoices
     set status = 'paid', paid_method = v_method, paid_reference = v_ref
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
  v_ref    text := btrim(coalesce(p_ref, ''));
  v_worker text;
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
  -- 20260914240000: nobody is paid on details nobody has checked by phone.
  select worker_email into v_worker from jobs where id = v_rel.job_id;
  if not public.worker_bank_checked(v_worker) then
    raise exception 'Call % back on the number you have for them, check their bank details, and press Call-back done on Pay workers first. Their details have not been checked by phone since they were last given.',
      coalesce(nullif(btrim(v_worker), ''), 'the worker')
      using errcode = 'check_violation';
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

commit;
