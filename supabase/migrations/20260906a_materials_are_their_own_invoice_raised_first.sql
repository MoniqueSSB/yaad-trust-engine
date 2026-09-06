-- Materials become their own invoice, raised and paid before anything is bought.
--
-- Step 6 of specs/MATERIALS-ROUTE-FLOW-SPEC.md, Route A. Until now
-- raise_job_client_invoice() raised ONE all-in document covering labour, the
-- 15% and materials, which is right for a job where nothing is bought up
-- front and wrong for the route the founder chose: the client pays for the
-- materials stage, then Yaadly releases that money to the worker, then he
-- buys. One document at the end cannot fund a purchase at the beginning.
--
-- THE THING THAT MUST NOT HAPPEN IS A DOUBLE BILL. Two documents can now
-- carry the same materials figure, so each function refuses when the other
-- has already covered it. raise_job_materials_invoice() refuses once the
-- all-in bill has gone out, and raise_job_client_invoice() drops its
-- materials line when a live materials invoice exists and says so in its own
-- notes. Both directions are asserted in supabase/tests/materials_invoice_guards.sql.
--
-- stage = 0 marks the materials document. stage IS NULL stays what it was,
-- the whole-job bill, so the existing uniqueness test in
-- raise_job_client_invoice is untouched; 1..n stay the per-stage fee
-- invoices from 20260901v. Nothing about a Route B job reaches here: the
-- client is buying, materials_jmd is 0 by quote_materials_match_route, and
-- this function refuses that job by name rather than raising a zero.
--
-- RAISING IS STILL A NAMED HUMAN. Admin only, no trigger, no timer. Under
-- CLAUDE.md section 2 an invoice is a consequential step and nothing here
-- fires on its own.

create or replace function public.raise_job_materials_invoice(p_job text)
returns table(invoice_id text, total_jmd integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job       jobs%rowtype;
  v_quote     job_quotes%rowtype;
  v_materials integer;
  v_id        text;
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

  if v_job.materials_by = 'client' then
    raise exception 'The client is supplying the materials on this job, so there is nothing for Yaadly to invoice them for. The worker quotes labour only and lists what the client needs to buy.'
      using errcode = 'check_violation';
  end if;

  select * into v_quote from job_quotes where job_id = p_job and status = 'accepted';
  if not found then
    raise exception 'No accepted quote on this job yet.' using errcode = 'check_violation';
  end if;

  v_materials := round(coalesce(v_quote.materials_jmd, 0));
  if v_materials <= 0 then
    raise exception 'The accepted quote on this job carries no materials, so there is no materials stage to raise.'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from invoices i
     where i.job_id = p_job and i.stage = 0
       and i.payable_to = 'yaadly' and i.status <> 'void'
  ) then
    raise exception 'The materials stage on this job has already been invoiced.' using errcode = 'check_violation';
  end if;

  -- The all-in bill already carried the materials. Raising them again here
  -- would bill the same money twice.
  if exists (
    select 1 from invoices i
     where i.job_id = p_job and i.stage is null
       and i.payable_to = 'yaadly' and i.status <> 'void'
  ) then
    raise exception 'The whole job has already been invoiced to the client, and that bill included the materials. Void it first if the materials need to go out on their own.'
      using errcode = 'check_violation';
  end if;

  v_id := public.new_invoice_number();
  insert into public.invoices (id, client_name, client_email, job_id, drafted_by, currency, period_label, payable_to, stage, notes)
  values (v_id, coalesce(v_job.client_name, v_job.client_email), v_job.client_email, p_job, 'human', 'JMD', 'Materials', 'yaadly', 0,
    'The materials for this job, at cost with nothing added. This is the first stage of the price you agreed, and it is paid before anything is bought. You will see the receipt and photographs of the materials on your property before any labour is paid for. You are buying the job from Yaadly: you do not pay the tradesperson and this is not money set aside for them.');

  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_id, null, 'Materials, at cost, nothing added', 1, v_materials, 'manual');

  return query select v_id, v_materials;
end $function$;

revoke all on function public.raise_job_materials_invoice(text) from public;
grant execute on function public.raise_job_materials_invoice(text) to authenticated;

comment on function public.raise_job_materials_invoice(text) is
  'Route A only. The materials stage of a managed job as its own document, paid before anything is bought, so the money exists to release to the worker. Refuses a client-supplied job, a quote with no materials, a second raise, and a job whose all-in bill already covered the materials. Admin only: raising an invoice is a named human decision.';

-- ------------------------------------- the all-in bill stops double-billing

-- Unchanged except for the materials half. Rewritten in full rather than
-- patched because it is a money function and a reader should see the whole
-- thing in one place, not reconstruct it from two migrations.
create or replace function public.raise_job_client_invoice(p_job text)
returns table(invoice_id text, total_jmd integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job         jobs%rowtype;
  v_quote       job_quotes%rowtype;
  v_labour      integer;
  v_materials   integer;
  v_fee         integer;
  v_total       integer;
  v_id          text;
  v_mat_already boolean;
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

  if exists (
    select 1 from invoices i
     where i.job_id = p_job and i.stage is null
       and i.payable_to = 'yaadly' and i.status <> 'void'
  ) then
    raise exception 'This job has already been invoiced to the client.' using errcode = 'check_violation';
  end if;

  -- The materials stage went out on its own document, so this one must not
  -- carry them again. This is the whole reason both functions exist.
  v_mat_already := exists (
    select 1 from invoices i
     where i.job_id = p_job and i.stage = 0
       and i.payable_to = 'yaadly' and i.status <> 'void'
  );

  v_labour    := round(coalesce(v_quote.labour_jmd, 0));
  v_materials := case when v_mat_already then 0 else round(coalesce(v_quote.materials_jmd, 0)) end;
  v_fee       := round(v_labour * 0.15);
  v_total     := v_labour + v_fee + v_materials;

  v_id := public.new_invoice_number();
  insert into public.invoices (id, client_name, client_email, job_id, drafted_by, currency, period_label, payable_to, notes)
  values (v_id, coalesce(v_job.client_name, v_job.client_email), v_job.client_email, p_job, 'human', 'JMD', 'Job', 'yaadly',
    case when v_mat_already
      then 'The rest of the price for this job, bought from Yaadly. It covers the work itself and Yaadly''s 15% Guarantee & Support fee for the vetting, the evidence chain and the dispute service. The materials were invoiced separately at the start and are not billed again here. You do not pay the tradesperson: Yaadly engages and pays them. If the work is wrong, that is ours to put right.'
      else 'One price for the whole job, bought from Yaadly. It covers the work itself, materials at cost with nothing added, and Yaadly''s 15% Guarantee & Support fee for the vetting, the evidence chain and the dispute service. You do not pay the tradesperson: Yaadly engages and pays them. If the work is wrong, that is ours to put right.'
    end);

  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_id, null, v_job.title || ', the work', 1, v_labour, 'manual');
  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_id, null, 'Guarantee & Support, 15%', 1, v_fee, 'manual');
  if v_materials > 0 then
    insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
    values (v_id, null, 'Materials, at cost, nothing added', 1, v_materials, 'manual');
  end if;

  return query select v_id, v_total;
end $function$;

revoke all on function public.raise_job_client_invoice(text) from public;
grant execute on function public.raise_job_client_invoice(text) to authenticated;

comment on function public.raise_job_client_invoice(text) is
  'The client''s bill for a managed job: labour, Yaadly''s 15%, and materials at cost UNLESS the materials already went out on their own stage 0 document, in which case they are omitted and the notes say so. Raised once per job. The pair with raise_job_materials_invoice exists so materials can be paid before they are bought without the client being billed for them twice.';
