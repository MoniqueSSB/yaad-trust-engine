-- Founder's correction, same session as 20260902i: the worker pay invoice
-- should not wait for the whole job to close, and it should not be an
-- admin's separate errand to remember. It raises itself, per stage, the
-- moment the client approves that stage's evidence, computed strictly from
-- the payment terms both sides already agreed to. "It should not be us
-- deciding what goes in, it should be the worker and client payment terms
-- that are being raised against" - the founder's own words.
--
-- reuses invoices.stage, already present and otherwise unused since the
-- old per-stage AGENCY fee invoice was retired (20260901y). Here it marks
-- which stage of the WORKER's pay this invoice is for, distinguished from
-- the whole-job worker invoice (20260902i, stage is null) by payable_to
-- plus a populated stage.
create or replace function public.raise_job_stage_worker_pay_invoice(p_job text, p_stage integer)
returns table(invoice_id text, total_jmd integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job jobs%rowtype;
  v_quote job_quotes%rowtype;
  v_stage_name text;
  v_pct numeric;
  v_has_materials boolean;
  v_labour_amt integer;
  v_materials_amt integer;
  v_amount integer;
  v_id text;
  v_desc text;
begin
  select * into v_job from jobs where id = p_job;
  if v_job.id is null then return; end if;

  select * into v_quote from job_quotes where job_id = p_job and status = 'accepted';
  if v_quote.id is null then return; end if;

  if coalesce(v_job.client_email, '') = '' then return; end if;

  -- Already raised for this exact stage: never raise a second one.
  if exists (
    select 1 from invoices i
     where i.job_id = p_job and i.payable_to = 'worker' and i.stage = p_stage and i.status <> 'void'
  ) then
    return;
  end if;

  -- The stage's own terms, same document and same priority order as
  -- sync_job_status() (20260902h): a Kickoff Pack's payment_schedule
  -- first, an approved Quote Pack draft's flat payment_stages second. A
  -- job can only ever have gone through one of the two.
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
     order by q.created_at desc
     limit 1;
  end if;

  -- No agreed terms naming this stage: nothing to raise against, and
  -- guessing a split is exactly what was ruled out. Silent no-op, not an
  -- error, so a stage approval on a job with no pack never fails on this.
  if v_pct is null then return; end if;

  v_labour_amt := round(coalesce(v_quote.labour_jmd, 0) * v_pct / 100);

  -- Materials are never split by proportion, they are "at cost," and the
  -- record of which stage they belong to is the evidence itself: whether
  -- a kind='materials' row was actually filed against this stage. Not an
  -- assumption made here, a fact read off what was actually filed.
  select exists (
    select 1 from evidence e
     where e.job_id = p_job and coalesce(e.stage, 1) = p_stage and e.kind = 'materials'
  ) into v_has_materials;
  v_materials_amt := case when v_has_materials then coalesce(v_quote.materials_jmd, 0) else 0 end;

  v_amount := v_labour_amt + v_materials_amt;
  if v_amount <= 0 then return; end if;

  v_desc := coalesce(v_stage_name, 'Stage ' || p_stage);
  v_id := public.new_invoice_number();
  insert into public.invoices (id, client_name, client_email, job_id, stage, drafted_by, currency, period_label, payable_to, notes)
  values (v_id, coalesce(v_job.client_name, v_job.client_email), v_job.client_email, p_job, p_stage, 'human', 'JMD', v_desc, 'worker',
    'What you agreed to pay ' || coalesce(v_quote.worker_name, 'your tradesperson') || ' for "' || v_desc || '," approved and on the record. This is a record, not a bill to Yaadly: pay them directly, the way you already agreed. Yaadly does not hold or move this money.');
  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_id, null, v_job.title || ' — ' || coalesce(v_quote.worker_name, 'tradesperson') || ', ' || v_desc, 1, v_amount, 'manual');

  return query select v_id, v_amount;
end $function$;

revoke all on function public.raise_job_stage_worker_pay_invoice(text, integer) from public;
grant execute on function public.raise_job_stage_worker_pay_invoice(text, integer) to authenticated;

-- The trigger: fires the instant the client's own approval lands, which is
-- the human-confirmed moment this whole feature hangs off. A failure here
-- (no pack yet, some data problem) is logged, never allowed to block the
-- approval itself: the client's evidence sign-off is the consequential
-- act, this is bookkeeping that follows it, not a precondition on it.
create or replace function public.raise_worker_pay_invoice_on_stage_approval()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    perform public.raise_job_stage_worker_pay_invoice(new.job_id, new.stage);
  exception when others then
    raise warning 'raise_job_stage_worker_pay_invoice(%, %) failed: %', new.job_id, new.stage, sqlerrm;
  end;
  return new;
end $function$;

drop trigger if exists trg_raise_worker_pay_on_stage_approval on public.stage_approvals;
create trigger trg_raise_worker_pay_on_stage_approval
  after insert on public.stage_approvals
  for each row execute function public.raise_worker_pay_invoice_on_stage_approval();
