-- On a job billed by stage, each stage is paid before it starts.
--
-- Founder, 28 September 2026: "can't move on without each stage being paid
-- by the client first", "if the client pays the full bill, fine", "to move
-- along the stages", and "the 15 is always paid before a job starts, in full,
-- never split through a job".
--
-- Until now a quote could say by_stage (20260914092546) and nothing followed
-- from it: the client was sent one whole-job bill, and nothing stopped a stage
-- being worked before its money was in. That was "piece 3", never built.
--
-- WHAT THIS DOES, by_stage jobs only. A job billed in full is unchanged.
--   1. raise_job_client_invoice() drafts TWO bills instead of one:
--        the start bill: Yaadly's 15% on ALL the labour, never split, plus
--          materials at cost. It carries the fee line, so paying it starts
--          the job exactly as today (starts_job, start_job_on_agency_fee_paid).
--        the stage 1 bill: stage 1's share of the labour, nothing else.
--   2. When the client approves a stage, the next stage's bill is drafted
--      (trigger on stage_approvals). Drafted only: a named person sends it,
--      and marks it paid, as every invoice.
--   3. Work on a stage cannot be evidenced until that stage's bill is paid
--      (evidence_on_the_working_stage). Materials evidence is let through:
--      materials are paid for on the start bill.
--
-- The share of each stage is the one raise_job_stage_worker_payable() already
-- pays the worker from: the approved Kickoff Pack's schedule, else the approved
-- quote pack's, stage by stage, round(labour * percent / 100). So the client's
-- stage bill and the worker's stage pay are cut from the same figure.
-- worker_pay_client_unpaid() already waits for a stage-numbered client bill to
-- be paid before that stage's pay (20260919160000), so nothing changes there.
--
-- Live definitions restated: raise_job_client_invoice (20260928235000) and
-- evidence_on_the_working_stage (20260914095005). The only changes are the
-- by_stage branch in the first and the paid-stage check in the second.

-- ------------------------------------------------------------------ helpers

create or replace function public._stage_share(p_job text, p_stage integer)
returns table(stage_name text, pct numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_name text;
  v_pct  numeric;
begin
  select p.docs -> 'payment_schedule' -> 'stages' -> (p_stage - 1) ->> 'stage',
         (p.docs -> 'payment_schedule' -> 'stages' -> (p_stage - 1) ->> 'proportion_percent')::numeric
    into v_name, v_pct
    from kickoff_packs p
   where p.job_id = p_job and p.status = 'approved'
   order by p.updated_at desc
   limit 1;
  if v_pct is null then
    select q.docs -> 'payment_stages' -> (p_stage - 1) ->> 'stage',
           (q.docs -> 'payment_stages' -> (p_stage - 1) ->> 'proportion_percent')::numeric
      into v_name, v_pct
      from quote_pack_drafts q
     where q.job_id = p_job and q.status = 'approved'
     order by q.approved_at desc nulls last, q.created_at desc
     limit 1;
  end if;
  return query select v_name, v_pct;
end $function$;

create or replace function public._job_is_billed_by_stage(p_job text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from job_quotes q
                  where q.job_id = p_job and q.status = 'accepted' and q.billing_mode = 'by_stage');
$function$;

-- The bill for one stage's labour, drafted. Null if there is nothing to bill
-- (no such stage on the schedule, a zero share, or it already exists).
create or replace function public._draft_client_stage_bill(p_job text, p_stage integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job   jobs%rowtype;
  v_quote job_quotes%rowtype;
  v_name  text;
  v_pct   numeric;
  v_amt   integer;
  v_id    text;
begin
  if exists (select 1 from invoices i
              where i.job_id = p_job and i.stage = p_stage and coalesce(i.payable_to, 'yaadly') = 'yaadly'
                and i.addon_id is null and i.status <> 'void') then
    return null;
  end if;
  select * into v_job from jobs where id = p_job;
  select * into v_quote from job_quotes where job_id = p_job and status = 'accepted';
  if v_job.id is null or v_quote.id is null or coalesce(v_job.client_email, '') = '' then
    return null;
  end if;
  select s.stage_name, s.pct into v_name, v_pct from public._stage_share(p_job, p_stage) s;
  if v_pct is null or v_pct <= 0 then
    return null;
  end if;
  v_amt := round(coalesce(v_quote.labour_jmd, 0) * v_pct / 100);
  if v_amt <= 0 then
    return null;
  end if;

  v_id := public.new_invoice_number();
  insert into public.invoices (id, client_name, client_email, job_id, stage, drafted_by, currency, period_label, payable_to, notes)
  values (v_id, coalesce(v_job.client_name, v_job.client_email), v_job.client_email, p_job, p_stage, 'human', 'JMD',
    'Stage ' || p_stage || coalesce(': ' || v_name, ''), 'yaadly',
    'Stage ' || p_stage || coalesce(', ' || v_name, '') || ', of this job, billed before the stage starts: this stage''s share of the agreed labour, '
      || trim(to_char(v_pct, 'FM990.##')) || '%. Yaadly''s 15% Guarantee & Support fee was billed in full before the job started and is not charged again. '
      || 'Work on this stage starts once it is paid. You do not pay the tradesperson: Yaadly engages and pays them.');
  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source, sort)
  values (v_id, null, v_job.title || ', stage ' || p_stage || coalesce(': ' || v_name, '') || ', the work (' || trim(to_char(v_pct, 'FM990.##')) || '% of the labour)', 1, v_amt, 'manual', 0);
  return v_id;
end $function$;

revoke all on function public._stage_share(text, integer) from public, anon, authenticated;
revoke all on function public._job_is_billed_by_stage(text) from public, anon, authenticated;
revoke all on function public._draft_client_stage_bill(text, integer) from public, anon, authenticated;

-- ------------------------------------------------ the job's bills, by stage

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
       and i.addon_id is null   -- 20260928235000
  ) then
    raise exception 'This job has already been invoiced to the client.' using errcode = 'check_violation';
  end if;

  v_mat_already := exists (
    select 1 from invoices i
     where i.job_id = p_job and i.stage = 0
       and i.payable_to = 'yaadly' and i.status <> 'void'
  );

  v_labour    := round(coalesce(v_quote.labour_jmd, 0));
  v_materials := case when v_mat_already then 0 else round(coalesce(v_quote.materials_jmd, 0)) end;
  v_fee       := round(v_labour * 0.15);

  -- 20260929100000: by stage. The start bill is the 15% on all the labour,
  -- never split, plus materials at cost; stage 1's labour is its own bill.
  if coalesce(v_quote.billing_mode, 'in_full') = 'by_stage' then
    if (select s.pct from public._stage_share(p_job, 1) s) is null then
      raise exception 'This job is billed by stage but has no approved payment schedule to bill stage 1 from.' using errcode = 'check_violation';
    end if;
    v_total := v_fee + v_materials;
    v_id := public.new_invoice_number();
    insert into public.invoices (id, client_name, client_email, job_id, drafted_by, currency, period_label, payable_to, notes)
    values (v_id, coalesce(v_job.client_name, v_job.client_email), v_job.client_email, p_job, 'human', 'JMD', 'Before the job starts', 'yaadly',
      'Paid before the job starts. Yaadly''s 15% Guarantee & Support fee on the whole agreed labour, billed once and never split across the job'
        || case when v_materials > 0 then ', and the materials at cost with nothing added' else '' end
        || '. The work itself is billed stage by stage, each stage before it starts. You do not pay the tradesperson: Yaadly engages and pays them.');
    insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source, sort, is_fee)
    values (v_id, null, 'Guarantee & Support, 15%', 1, v_fee, 'manual', 1, true);
    if v_materials > 0 then
      insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source, sort)
      values (v_id, null, 'Materials, at cost, nothing added', 1, v_materials, 'manual', 2);
    end if;
    perform public._draft_client_stage_bill(p_job, 1);
    return query select v_id, v_total;
    return;
  end if;

  v_total     := v_labour + v_fee + v_materials;

  v_id := public.new_invoice_number();
  insert into public.invoices (id, client_name, client_email, job_id, drafted_by, currency, period_label, payable_to, notes)
  values (v_id, coalesce(v_job.client_name, v_job.client_email), v_job.client_email, p_job, 'human', 'JMD', 'Job', 'yaadly',
    case when v_mat_already
      then 'The rest of the price for this job, bought from Yaadly. It covers the work itself and Yaadly''s 15% Guarantee & Support fee for the vetting, the evidence chain and the dispute service. The materials were invoiced separately at the start and are not billed again here. You do not pay the tradesperson: Yaadly engages and pays them. If the work is wrong, that is ours to put right.'
      else 'One price for the whole job, bought from Yaadly. It covers the work itself, materials at cost with nothing added, and Yaadly''s 15% Guarantee & Support fee for the vetting, the evidence chain and the dispute service. You do not pay the tradesperson: Yaadly engages and pays them. If the work is wrong, that is ours to put right.'
    end);

  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source, sort)
  values (v_id, null, v_job.title || ', the work', 1, v_labour, 'manual', 0);
  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source, sort, is_fee)
  values (v_id, null, 'Guarantee & Support, 15%', 1, v_fee, 'manual', 1, true);
  if v_materials > 0 then
    insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source, sort)
    values (v_id, null, 'Materials, at cost, nothing added', 1, v_materials, 'manual', 2);
  end if;

  return query select v_id, v_total;
end $function$;

-- ------------------------------------ approving a stage drafts the next bill

create or replace function public.draft_next_stage_bill_on_approval()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if public._job_is_billed_by_stage(new.job_id)
     and new.stage < coalesce(public.job_final_stage_count(new.job_id), 1) then
    perform public._draft_client_stage_bill(new.job_id, new.stage + 1);
  end if;
  return new;
exception when others then
  -- A bill that could not be drafted must never stop an approval being
  -- recorded. The desk can raise it by hand; the stage stays closed to work
  -- until it is paid, so nothing moves on without it.
  return new;
end $function$;

revoke all on function public.draft_next_stage_bill_on_approval() from public, anon, authenticated;
drop trigger if exists trg_draft_next_stage_bill on public.stage_approvals;
create trigger trg_draft_next_stage_bill
  after insert on public.stage_approvals
  for each row execute function public.draft_next_stage_bill_on_approval();

-- -------------------------------------- no work on a stage until it is paid

create or replace function public.evidence_on_the_working_stage()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role  text;
  v_stage integer;
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
  if v_role not in ('authenticated', 'anon') then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;

  select j.stage into v_stage from public.jobs j where j.id = new.job_id;
  if not found then
    -- No such job. The insert policy refuses it; nothing to say here.
    return new;
  end if;
  v_stage := coalesce(v_stage, 0);

  if v_stage < 1 then
    raise exception 'Stage 1 has not started on this job, so no evidence can be filed yet. It starts once the Guarantee & Support invoice is paid.'
      using errcode = 'check_violation';
  end if;

  if coalesce(new.stage, 1) > v_stage then
    raise exception 'Stage % is locked. Evidence goes on stage %, the stage being worked, and stage % opens once the stages before it are signed off.',
      coalesce(new.stage, 1), v_stage, coalesce(new.stage, 1)
      using errcode = 'check_violation';
  end if;

  if coalesce(new.stage, 1) < v_stage then
    raise exception 'Stage % is signed off and closed. Evidence goes on stage %, the stage being worked.',
      coalesce(new.stage, 1), v_stage
      using errcode = 'check_violation';
  end if;

  -- 20260929100000: on a job billed by stage, a stage is worked only once its
  -- bill is paid. Materials evidence is let through: materials were paid for
  -- on the bill that started the job.
  if coalesce(new.kind, 'work') <> 'materials'
     and public._job_is_billed_by_stage(new.job_id)
     and not exists (
       select 1 from public.invoices i
        where i.job_id = new.job_id and i.stage = v_stage and coalesce(i.payable_to, 'yaadly') = 'yaadly'
          and i.addon_id is null and i.status = 'paid'
     ) then
    raise exception 'Stage % starts once its bill is paid. Nothing can be filed on it until then.', v_stage
      using errcode = 'check_violation';
  end if;

  return new;
end
$function$;
