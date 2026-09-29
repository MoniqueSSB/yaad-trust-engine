-- The worker's pay invoice shows Yaadly's 5% worker fee (28 Sep 2026).
--
-- Founder: the worker fee should show "on the worker's pay invoice". Both
-- functions that raise a pay invoice already work out the quoted labour and
-- the 5% and then keep only what is left (the agreed rate), so the fee could
-- not be shown exactly: working it back from the rate can be a dollar out,
-- and pay raised before 9 Sep 2026 was at 12%, not 5%. From now on each pay
-- invoice records both figures as it is raised, and the invoice, the PDF
-- and the desk show: quoted labour, less Yaadly's 5%, equals the agreed rate.
--
-- Nothing about the money changes. The same figures are computed the same
-- way; the functions below are the live definitions of 28 Sep 2026 with the
-- two columns added to their insert and nothing else touched. Pay invoices
-- raised before this migration have no figures, are not backfilled, and show
-- no breakdown, rather than a guessed one.

alter table public.invoices
  add column if not exists worker_labour_jmd integer,
  add column if not exists worker_fee_jmd integer;

alter table public.invoices drop constraint if exists invoices_worker_fee_figures;
alter table public.invoices add constraint invoices_worker_fee_figures check (
  (worker_labour_jmd is null and worker_fee_jmd is null)
  or (payable_to = 'worker' and worker_labour_jmd >= 0 and worker_fee_jmd >= 0 and worker_fee_jmd <= worker_labour_jmd)
);

comment on column public.invoices.worker_labour_jmd is
  'Worker pay invoices only: the quoted labour this invoice pays for, before Yaadly''s worker fee, whole J$. Recorded when raised; null on pay raised before 28 Sep 2026.';
comment on column public.invoices.worker_fee_jmd is
  'Worker pay invoices only: Yaadly''s worker fee kept out of worker_labour_jmd (5% since 9 Sep 2026), whole J$. The labour line on the invoice is worker_labour_jmd minus this.';

CREATE OR REPLACE FUNCTION public.raise_job_stage_worker_payable(p_job text, p_stage integer)
 RETURNS TABLE(invoice_id text, total_jmd integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job           jobs%rowtype;
  v_quote         job_quotes%rowtype;
  v_stage_name    text;
  v_pct           numeric;
  v_from_pack     boolean := true;
  v_has_materials boolean;
  v_labour_amt    integer;
  v_margin        integer;
  v_rate          integer;
  v_materials_amt integer;
  v_amount        integer;
  v_id            text;
  v_desc          text;
begin
  -- The hold point. A payable follows a named human approving the stage and
  -- nothing else, so without the approval on record there is nothing to raise.
  if not exists (
    select 1 from stage_approvals s where s.job_id = p_job and s.stage = p_stage
  ) then
    return;
  end if;

  select * into v_job from jobs where id = p_job;
  if v_job.id is null then return; end if;

  select * into v_quote from job_quotes where job_id = p_job and status = 'accepted';
  if v_quote.id is null then return; end if;

  -- The worker has to be nameable, because invoices_worker_read is how he
  -- reads his own payable.
  if coalesce(v_quote.worker_email, '') = '' then return; end if;

  if exists (
    select 1 from invoices i
     where i.job_id = p_job and i.payable_to = 'worker' and i.stage = p_stage and i.status <> 'void'
  ) then
    return;
  end if;

  select p.docs -> 'payment_schedule' -> 'stages' -> (p_stage - 1) ->> 'stage',
         (p.docs -> 'payment_schedule' -> 'stages' -> (p_stage - 1) ->> 'proportion_percent')::numeric
    into v_stage_name, v_pct
    from kickoff_packs p
   where p.job_id = p_job and p.status = 'approved'
   order by p.updated_at desc
   limit 1;

  if v_pct is null then
    select q.docs -> 'payment_stages' -> (p_stage - 1) ->> 'stage',
           (q.docs -> 'payment_stages' -> (p_stage - 1) ->> 'proportion_percent')::numeric
      into v_stage_name, v_pct
      from quote_pack_drafts q
     where q.job_id = p_job and q.status = 'approved'
     order by q.approved_at desc nulls last, q.created_at desc
     limit 1;
  end if;

  if v_pct is null then
    v_from_pack := false;
    if p_stage = 1 then
      v_pct := 100;
      v_stage_name := 'The whole job';
    else
      return;
    end if;
  end if;

  -- The stage's share of his quoted labour, then the agreed 5%. Rounding is
  -- applied to the stage amount rather than to the whole job, so the stages
  -- sum to the same figure the whole-job payable would produce, give or take
  -- a dollar of rounding on each.
  v_labour_amt := round(coalesce(v_quote.labour_jmd, 0) * v_pct / 100);
  v_margin     := round(v_labour_amt * 0.05);
  v_rate       := v_labour_amt - v_margin;

  -- Materials land on whichever stage filed the materials evidence, at cost,
  -- never reduced by the 5%. Since 20260914112000 only what the worker has
  -- not already been paid: a tranche released up front, or materials on an
  -- earlier stage's payable, is not paid again.
  select exists (
    select 1 from evidence e
     where e.job_id = p_job and coalesce(e.stage, 1) = p_stage and e.kind = 'materials'
  ) into v_has_materials;
  v_materials_amt := case when v_has_materials then public.materials_owed_to_worker_jmd(p_job) else 0 end;

  v_amount := v_rate + v_materials_amt;
  if v_amount <= 0 then return; end if;

  v_desc := coalesce(v_stage_name, 'Stage ' || p_stage);
  v_id := public.new_invoice_number();

  insert into public.invoices (id, client_name, client_email, worker_email, job_id, stage, drafted_by, currency, period_label, payable_to, worker_labour_jmd, worker_fee_jmd, notes)
  values (v_id, 'Yaadly Ltd', 'payable@yaadly.invalid', v_quote.worker_email, p_job, p_stage, 'human', 'JMD', v_desc, 'worker', v_labour_amt, v_margin,
    'What Yaadly owes ' || coalesce(v_quote.worker_name, 'the tradesperson') || ' for "' || v_desc || '," raised the moment the client approved this stage. '
      || 'Their quoted labour for this stage less the agreed 5%'
      || (case when v_materials_amt > 0 then ', plus materials at cost with nothing deducted, less any materials money already paid to them' else '' end) || '.'
      || (case when v_from_pack then '' else ' No payment schedule was on file for this job, so it was treated as one stage: the whole job.' end)
      || ' Yaadly pays this directly. The client is not a party to it.');

  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_id, null, v_job.title || ', ' || coalesce(v_quote.worker_name, 'tradesperson') || ', ' || v_desc || ', agreed rate', 1, v_rate, 'manual');
  if v_materials_amt > 0 then
    insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
    values (v_id, null, 'Materials, at cost, nothing deducted', 1, v_materials_amt, 'manual');
  end if;

  -- Lines first, then sent: the order 20260902m had to fix once already.
  update public.invoices set status = 'sent' where id = v_id;

  return query select v_id, v_amount;
end $function$;

CREATE OR REPLACE FUNCTION public.raise_job_worker_payable(p_job text)
 RETURNS TABLE(invoice_id text, total_jmd integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Since 20260914112000: only the materials not already paid to the worker,
  -- up front as a tranche or on a stage payable. It was the whole line.
  v_materials := public.materials_owed_to_worker_jmd(p_job);
  v_margin    := round(v_labour * 0.05);
  v_rate      := v_labour - v_margin;
  v_total     := v_rate + v_materials;

  v_id := public.new_invoice_number();
  insert into public.invoices (id, client_name, client_email, worker_email, job_id, drafted_by, currency, period_label, payable_to, worker_labour_jmd, worker_fee_jmd, notes)
  values (v_id, 'Yaadly Ltd', 'payable@yaadly.invalid', v_quote.worker_email, p_job, 'human', 'JMD', 'Work completed', 'worker', v_labour, v_margin,
    'What Yaadly owes ' || coalesce(v_quote.worker_name, 'the tradesperson') || ' for this job. Yaadly engaged them at their quoted labour price less 5%, agreed in writing before they accepted, plus any materials at cost not already paid to them, with nothing deducted. Yaadly pays this directly. The client is not a party to it.');

  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_id, null, v_job.title || ', agreed rate, quoted labour less 5%', 1, v_rate, 'manual');
  if v_materials > 0 then
    insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
    values (v_id, null, 'Materials, at cost, nothing deducted', 1, v_materials, 'manual');
  end if;

  return query select v_id, v_total;
end $function$;
