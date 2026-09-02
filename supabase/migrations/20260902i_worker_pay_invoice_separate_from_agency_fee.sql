-- Founder's instruction, 2 Sep 2026: Yaadly raises TWO invoices per booked
-- job, not one. The agency fee invoice (20260901y) already exists: Yaadly's
-- own 15%, billed to the client, paid to Yaadly. This adds the second,
-- separate document: what the client owes the WORKER, labour plus
-- materials at cost, raised once the job is complete and the client has
-- approved the evidence. The two are paid separately, to different
-- parties, and neither is contingent on the other existing.
--
-- This is a document, not a payment rail. No money moves through Yaadly on
-- this invoice: the client still pays the worker directly, exactly as
-- 20260901v's own comment already said, this just gives that arrangement a
-- paper record instead of leaving it entirely informal. Nothing here holds
-- funds, chooses a provider, or changes a release condition, so it is not
-- the "payment integration" CLAUDE.md 9 reserves for after the legal
-- review; it is Yaadly's existing invoicing pattern, reused for a second
-- payee, admin-raised and admin-marked-paid exactly like the first one.
--
-- payable_to distinguishes the two invoice types on an otherwise shared
-- table. Every existing row defaults to 'yaadly', so nothing already
-- raised changes meaning.
alter table public.invoices add column if not exists payable_to text not null default 'yaadly';
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invoices'::regclass and conname = 'invoices_payable_to_check'
  ) then
    alter table public.invoices
      add constraint invoices_payable_to_check
      check (payable_to in ('yaadly', 'worker'));
  end if;
end $$;

comment on column public.invoices.payable_to is
  'Who this invoice is actually paid to, off-platform in both cases. yaadly: Yaadly''s own fee. worker: what the client owes the tradesperson, raised as a record only, Yaadly never touches this money.';

-- Only once the job is COMPLETE: raising this earlier would be inviting a
-- client to pay before the work, and evidence, exist. One per job, same
-- discipline as the agency fee invoice.
create or replace function public.raise_job_worker_pay_invoice(p_job text)
returns table(invoice_id text, total_jmd integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job jobs%rowtype;
  v_quote job_quotes%rowtype;
  v_amount integer;
  v_id text;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;

  select * into v_job from jobs where id = p_job;
  if not found then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;
  if v_job.status <> 'complete' then
    raise exception 'This job is not complete yet. A worker pay invoice is a record of finished, approved work, not an estimate.' using errcode = 'check_violation';
  end if;
  if coalesce(v_job.client_email, '') = '' then
    raise exception 'This job has no client email on file to invoice.' using errcode = 'check_violation';
  end if;

  select * into v_quote from job_quotes where job_id = p_job and status = 'accepted';
  if not found then
    raise exception 'No accepted quote on this job.' using errcode = 'check_violation';
  end if;

  if exists (select 1 from invoices i where i.job_id = p_job and i.payable_to = 'worker' and i.status <> 'void') then
    raise exception 'This job''s worker pay invoice has already been raised.' using errcode = 'check_violation';
  end if;

  v_amount := round(coalesce(v_quote.labour_jmd, 0) + coalesce(v_quote.materials_jmd, 0));

  v_id := public.new_invoice_number();
  insert into public.invoices (id, client_name, client_email, job_id, drafted_by, currency, period_label, payable_to, notes)
  values (v_id, coalesce(v_job.client_name, v_job.client_email), v_job.client_email, p_job, 'human', 'JMD', 'Work completed', 'worker',
    'What you agreed to pay ' || coalesce(v_quote.worker_name, 'your tradesperson') || ' for this job: their labour price plus materials at cost, no fee added. This is a record, not a bill to Yaadly: pay them directly, the way you already agreed. Yaadly does not hold or move this money.');
  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_id, null, v_job.title || ' — ' || coalesce(v_quote.worker_name, 'tradesperson') || '''s labour and materials, at cost', 1, v_amount, 'manual');

  return query select v_id, v_amount;
end $function$;

revoke all on function public.raise_job_worker_pay_invoice(text) from public;
grant execute on function public.raise_job_worker_pay_invoice(text) to authenticated;
