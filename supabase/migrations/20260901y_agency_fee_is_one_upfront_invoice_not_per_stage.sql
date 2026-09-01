-- Founder's instruction, 1 Sep 2026: Yaadly's own agency fee on a marketplace
-- job is one invoice, raised at the start of the job, 15% of the whole
-- accepted quote's labour price. Not split by payment stage, not gated on
-- any stage's evidence. That gating and splitting belongs to how the client
-- pays the WORKER (the job's own Kickoff Pack payment_schedule, evidence
-- gated, untouched by this) - a separate arrangement from Yaadly's own cut,
-- which this migration stops conflating with it.
--
-- raise_job_stage_invoice() is dropped outright rather than left unused: it
-- computes exactly the thing the founder just said not to charge, so a
-- working function that does the wrong thing is a worse thing to leave
-- lying around than no function at all. The one invoice it already raised
-- in testing (INV-2026-0004) stays on the record as what it is, a stale
-- test row from before this decision, not backfilled or voided here.
--
-- A whole-job agency fee invoice is identified by job_id is not null and
-- stage is null, distinct from the old per-stage shape (job_id and stage
-- both set) and from a plain service invoice (job_id null).

drop function if exists public.raise_job_stage_invoice(text, integer);

create or replace function public.raise_job_agency_fee_invoice(p_job text)
returns table(invoice_id text, total_jmd integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job jobs%rowtype;
  v_quote job_quotes%rowtype;
  v_fee integer;
  v_id text;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;

  select * into v_job from jobs where id = p_job;
  if not found then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;
  if coalesce(v_job.client_email, '') = '' then
    raise exception 'This job has no client email on file to invoice.' using errcode = 'check_violation';
  end if;

  select * into v_quote from job_quotes where job_id = p_job and status = 'accepted';
  if not found then
    raise exception 'No accepted quote on this job yet.' using errcode = 'check_violation';
  end if;

  if exists (select 1 from invoices i where i.job_id = p_job and i.stage is null and i.status <> 'void') then
    raise exception 'This job''s agency fee has already been raised.' using errcode = 'check_violation';
  end if;

  v_fee := round(v_quote.labour_jmd * 0.15);

  v_id := public.new_invoice_number();
  insert into public.invoices (id, client_name, client_email, job_id, drafted_by, currency, period_label, notes)
  values (v_id, coalesce(v_job.client_name, v_job.client_email), v_job.client_email, p_job, 'human', 'JMD', 'Agency fee',
    'Yaadly''s own Guarantee & Support fee: 15% of the agreed labour price for this job, due before work starts. Paid to Yaadly. Your tradesperson''s own pay is a separate arrangement, paid to them directly by you, per the payment terms you agreed with them, and is never invoiced by Yaadly.');
  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_id, null, v_job.title || ' — Yaadly''s agency fee, 15% of the labour price', 1, v_fee, 'manual');

  return query select v_id, v_fee;
end $function$;

revoke all on function public.raise_job_agency_fee_invoice(text) from public;
grant execute on function public.raise_job_agency_fee_invoice(text) to authenticated;
