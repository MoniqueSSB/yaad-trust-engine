-- A card payment is recorded, not trusted.
--
-- Founder's instruction, 14 September 2026: a client can pay an invoice by
-- card from the portal (Stripe, test mode first). yaad-checkout makes the
-- Stripe payment page; yaad-stripe-webhook hears that the card was charged
-- and writes a row here.
--
-- WHAT THIS TABLE IS NOT. It is not the invoice's paid flag, and nothing in
-- this migration, or in either function, writes invoices.status. An invoice
-- is marked paid by a named person at the desk, as it always has been,
-- because paying the invoice that starts a job is what starts the job
-- (start_job_on_agency_fee_paid). A payment row says "Stripe reports this
-- was charged"; the desk decides what that means. CLAUDE.md §2 and §9.
--
-- APPEND ONLY, BY THE SERVICE ROLE. There are no insert, update or delete
-- policies, so no signed-in user (client or admin) can write a payment row
-- through the API. Only the webhook, holding the service role key, writes,
-- and only after checking Stripe's signature.
--
-- status: 'succeeded' when the amount and currency Stripe reports match the
-- invoice; 'mismatch' when they do not, kept so a person looks at it rather
-- than dropped, because a real card was charged either way.
-- amount_minor is exactly what Stripe reported (J$ in cents); amount_stored
-- is the same amount in Yaadly's own units for that currency (J$ in whole
-- dollars), so it compares directly with invoices.total_pence.

create table if not exists public.invoice_payments (
  id            bigint generated always as identity primary key,
  invoice_id    text not null references public.invoices(id),
  provider      text not null check (provider in ('stripe')),
  provider_ref  text not null unique,
  payment_intent text,
  amount_minor  bigint not null,
  amount_stored bigint not null,
  currency      text not null,
  livemode      boolean not null default false,
  status        text not null check (status in ('succeeded', 'mismatch')),
  received_at   timestamptz not null default now()
);

create index if not exists invoice_payments_invoice_idx on public.invoice_payments(invoice_id);

alter table public.invoice_payments enable row level security;

drop policy if exists invoice_payments_admin_read  on public.invoice_payments;
drop policy if exists invoice_payments_client_read on public.invoice_payments;

create policy invoice_payments_admin_read on public.invoice_payments
  for select to authenticated using (public.is_admin());

-- The same rule as invoices_client_read: a client sees payments against
-- their own non-draft invoices, matched on the signed-in email.
create policy invoice_payments_client_read on public.invoice_payments
  for select to authenticated using (
    exists (
      select 1 from public.invoices i
       where i.id = invoice_payments.invoice_id
         and i.status <> 'draft'
         and lower(i.client_email) = lower(auth.jwt() ->> 'email')
    )
  );

revoke all on public.invoice_payments from anon;
revoke insert, update, delete on public.invoice_payments from authenticated;
grant select on public.invoice_payments to authenticated;

comment on table public.invoice_payments is
  'Card payments Stripe reports against an invoice. Recorded by yaad-stripe-webhook only. Never marks an invoice paid: a named person does that at the desk. 20260914120000.';
