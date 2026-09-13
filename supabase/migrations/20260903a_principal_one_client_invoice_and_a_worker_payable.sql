-- Founder's instruction, 3 Sep 2026: "build to principal now". Yaadly sells
-- the job to the client and subcontracts the tradesperson. The client does
-- not contract with the worker, so the client is not billed for the worker
-- and the worker is not charged a fee.
--
-- WHAT WAS WRONG, and it was live. Two documents were raised per job:
-- raise_job_agency_fee_invoice() billed the client 15% of labour, and
-- raise_job_worker_pay_invoice() billed the client the worker's FULL labour
-- plus materials with the note "no fee added ... pay them directly". At the
-- same time the worker's own screens (QuotePanel, FeeBreakdown) showed him
-- his labour less 12% and the words "You receive". So the client was told to
-- pay him 100% and he was told he gets 88%, and nothing anywhere collected
-- the 12%: no invoice type, no payable_to value, no function. The founder's
-- own question, "how do I take my fees from the worker", had no answer in
-- the code because the mechanism was never built.
--
-- Being principal dissolves it rather than plumbing it. There is no fee to
-- collect from him, because Yaadly engages him at his quoted price less 12%
-- and simply pays him that. The 12% is never collected because it is never
-- paid out. Nothing of his passes through Yaadly, which is the whole reason
-- for the structure: taking money from one party to pass to another can be a
-- regulated payment service, and buying and reselling work is not.
--
-- So: ONE invoice to the client, all in, and ONE payable recording what
-- Yaadly owes the worker.
--
--   client invoice  = labour + 15% of labour + materials at cost
--   worker payable  = labour - 12% of labour + materials at cost
--   Yaadly margin   = 27% of labour, materials passed through at cost
--
-- Every figure is unchanged from what both sides were already shown. Only
-- who owes whom has changed.
--
-- SECURITY, and this is the part that is easy to get wrong. Under the old
-- shape the worker payable carried the CLIENT's email, because the client
-- was the one paying it. Under this shape the client must never read it: it
-- is Yaadly's cost base, and invoices_client_read matches on
-- lower(client_email) = the caller's JWT email, so leaving the client there
-- would hand them Yaadly's margin on a plate. client_email is NOT NULL, so
-- a worker payable now carries a sentinel at .invalid, a TLD RFC 2606
-- reserves so it can never be a real mailbox and can never match a real
-- session. The worker still reads his own via worker_email and
-- invoices_worker_read, untouched by this migration.
--
-- The old functions are dropped outright rather than left unused, following
-- the precedent 20260901y set with raise_job_stage_invoice: a working
-- function that computes the wrong money is worse to leave lying around than
-- no function at all.
--
-- NOT DONE HERE, deliberately: raise_job_stage_worker_pay_invoice(job, stage)
-- still apportions the OLD shape across payment stages. It needs the same
-- treatment and is a separate change, called out in RUNBOOK.md, because its
-- stage apportionment reads the Kickoff Pack and the quote pack draft and
-- deserves its own review rather than being rewritten in passing.
--
-- ALSO NOT DONE: nothing here switches on taking a client's payment. This
-- migration changes what the documents say, not how money moves. Both are
-- still admin-raised and admin-marked-paid off platform, exactly as before.
-- docs/payments.html still promises no client payment is taken until legal
-- sign-off and insurance are in hand, and that promise is untouched.

comment on column public.invoices.payable_to is
  'Who receives the money on this document. yaadly: the client pays Yaadly, one all-in price for the job. worker: Yaadly pays the tradesperson, being their quoted labour less 12% plus materials at cost. Under the principal structure the client is never billed for the worker, so a payable_to=worker row carries a sentinel client_email and is readable only by the named worker and by admins.';

-- ------------------------------------------------------- the client's bill

drop function if exists public.raise_job_agency_fee_invoice(text);

create or replace function public.raise_job_client_invoice(p_job text)
returns table(invoice_id text, total_jmd integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job       jobs%rowtype;
  v_quote     job_quotes%rowtype;
  v_labour    integer;
  v_materials integer;
  v_fee       integer;
  v_total     integer;
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

  select * into v_quote from job_quotes where job_id = p_job and status = 'accepted';
  if not found then
    raise exception 'No accepted quote on this job yet.' using errcode = 'check_violation';
  end if;

  -- Same uniqueness test the agency fee invoice used: one whole-job document
  -- payable to Yaadly, no stage set.
  if exists (
    select 1 from invoices i
     where i.job_id = p_job and i.stage is null
       and i.payable_to = 'yaadly' and i.status <> 'void'
  ) then
    raise exception 'This job has already been invoiced to the client.' using errcode = 'check_violation';
  end if;

  v_labour    := round(coalesce(v_quote.labour_jmd, 0));
  v_materials := round(coalesce(v_quote.materials_jmd, 0));
  v_fee       := round(v_labour * 0.15);
  v_total     := v_labour + v_fee + v_materials;

  v_id := public.new_invoice_number();
  insert into public.invoices (id, client_name, client_email, job_id, drafted_by, currency, period_label, payable_to, notes)
  values (v_id, coalesce(v_job.client_name, v_job.client_email), v_job.client_email, p_job, 'human', 'JMD', 'Job', 'yaadly',
    'One price for the whole job, bought from Yaadly. It covers the work itself, materials at cost with nothing added, and Yaadly''s 15% Guarantee & Support fee for the vetting, the evidence chain and the dispute service. You do not pay the tradesperson: Yaadly engages and pays them. If the work is wrong, that is ours to put right.');

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
  'The client''s single all-in bill for a managed job: labour, Yaadly''s 15%, and materials at cost. Raised once per job. Replaces raise_job_agency_fee_invoice, which billed only the fee and left the worker to be paid separately by the client.';

-- ------------------------------------------------- what Yaadly owes the worker

drop function if exists public.raise_job_worker_pay_invoice(text);

create or replace function public.raise_job_worker_payable(p_job text)
returns table(invoice_id text, total_jmd integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job       jobs%rowtype;
  v_quote     job_quotes%rowtype;
  v_labour    integer;
  v_materials integer;
  v_margin    integer;
  v_rate      integer;
  v_total     integer;
  v_id        text;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;

  select * into v_job from jobs where id = p_job;
  if not found then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;
  -- Unchanged discipline: this records finished, approved work, never an
  -- estimate. A named human approving the evidence is what moves the job to
  -- complete, so this cannot exist before that decision was taken.
  if v_job.status <> 'complete' then
    raise exception 'This job is not complete yet. A worker payable is a record of finished, approved work, not an estimate.' using errcode = 'check_violation';
  end if;

  select * into v_quote from job_quotes where job_id = p_job and status = 'accepted';
  if not found then
    raise exception 'No accepted quote on this job.' using errcode = 'check_violation';
  end if;
  if coalesce(v_quote.worker_email, '') = '' then
    raise exception 'This job''s accepted quote has no worker email, so the tradesperson could not read their own payable.' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from invoices i
     where i.job_id = p_job and i.payable_to = 'worker'
       and i.stage is null and i.status <> 'void'
  ) then
    raise exception 'This job''s worker payable has already been raised.' using errcode = 'check_violation';
  end if;

  v_labour    := round(coalesce(v_quote.labour_jmd, 0));
  v_materials := round(coalesce(v_quote.materials_jmd, 0));
  v_margin    := round(v_labour * 0.12);
  v_rate      := v_labour - v_margin;
  v_total     := v_rate + v_materials;

  v_id := public.new_invoice_number();
  -- client_email is a sentinel, not an oversight: see the header. The client
  -- must not be able to read what Yaadly pays its subcontractor.
  insert into public.invoices (id, client_name, client_email, worker_email, job_id, drafted_by, currency, period_label, payable_to, notes)
  values (v_id, 'Yaadly Ltd', 'payable@yaadly.invalid', v_quote.worker_email, p_job, 'human', 'JMD', 'Work completed', 'worker',
    'What Yaadly owes ' || coalesce(v_quote.worker_name, 'the tradesperson') || ' for this job. Yaadly engaged them at their quoted labour price less 12%, agreed in writing before they accepted, plus materials at cost with nothing deducted. Yaadly pays this directly. The client is not a party to it.');

  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_id, null, v_job.title || ', agreed rate, quoted labour less 12%', 1, v_rate, 'manual');
  if v_materials > 0 then
    insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
    values (v_id, null, 'Materials, at cost, nothing deducted', 1, v_materials, 'manual');
  end if;

  return query select v_id, v_total;
end $function$;

revoke all on function public.raise_job_worker_payable(text) from public;
grant execute on function public.raise_job_worker_payable(text) to authenticated;

comment on function public.raise_job_worker_payable(text) is
  'What Yaadly owes the tradesperson on a completed managed job: their quoted labour less the agreed 12%, plus materials at cost. Replaces raise_job_worker_pay_invoice, which billed the CLIENT the worker''s full labour and told them to pay the worker directly.';
