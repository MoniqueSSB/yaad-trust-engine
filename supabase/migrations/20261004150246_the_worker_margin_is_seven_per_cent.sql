-- Founder instruction, 4 October 2026: Yaadly's margin on the tradesperson's
-- side goes from 5% to 7%, for every worker, including those paid by
-- MoneyGram cash pick-up. Her reason: the bank transfer to the worker costs
-- Yaadly money on every payout, and she does not want to carry it. She was
-- shown that a flat 2% over-covers the transfer on a large job and
-- under-covers it on a small one, and chose the single rate anyway.
--
--   client invoice  = labour + 15% of labour + materials at cost   (unchanged)
--   worker payable  = labour -  7% of labour + materials at cost   (was 5%)
--   Yaadly margin   = 22% of labour, materials passed through at cost
--
-- THE PROMISE THIS HAS TO KEEP. Every worker was told in writing, and the
-- payments page still says, that both figures are shown before anyone agrees
-- and "neither moves afterwards". So the new rate cannot reach work that was
-- priced under the old one. The rate is chosen by WHEN the work was agreed:
--
--   a quote given before this migration ran      -> 5%
--   an add-on agreed before this migration ran   -> 5%
--   anything after                               -> 7%
--
-- The switch moment is recorded once, in app_settings.worker_fee_7pc_from,
-- set to the time this file is applied and never moved by a later re-run.
-- public.worker_fee_rate() reads it. Checked live on 4 October before
-- writing this: no real job had an accepted quote waiting on a payable, only
-- two test jobs, so in practice the 5% branch protects nobody yet. It is
-- there so the promise is true in code, not just on the page.
--
-- The three function bodies are the LIVE definitions read with
-- pg_get_functiondef on 4 October 2026, changed only where the rate and the
-- words describing it appear. Who raises a payable, and when, is untouched:
-- the whole-job payable is admin-raised on a complete job, the stage payable
-- follows a named human approving the stage, and an add-on is signed off by a
-- named person. A higher margin is not a reason to release anything on a
-- timer, and nothing here does.
--
-- RE-SIGNING. The signed Worker Guidelines state the worker's side, so the
-- text moves to v1.8 in web/lib/legal-copy.json and worker_guidelines_version
-- moves with it below. Every worker re-signs before taking new work, which is
-- how each of them is told, in writing, before it applies to them.

insert into public.app_settings (key, value)
values ('worker_fee_7pc_from', now()::text)
on conflict (key) do nothing;

create or replace function public.worker_fee_rate(p_agreed_at timestamptz)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when p_agreed_at is not null
     and p_agreed_at < coalesce(
           (select value::timestamptz from app_settings where key = 'worker_fee_7pc_from'),
           '-infinity'::timestamptz)
    then 0.05
    else 0.07
  end
$function$;

comment on function public.worker_fee_rate(timestamptz) is
  'Yaadly''s margin on the worker side for work agreed at p_agreed_at: 0.05 before app_settings.worker_fee_7pc_from, 0.07 from then on (founder, 4 Oct 2026). A price agreed in writing never moves afterwards.';

revoke all on function public.worker_fee_rate(timestamptz) from public, anon, authenticated;

comment on column public.invoices.payable_to is
  'Who receives the money on this document. yaadly: the client pays Yaadly, one all-in price for the job. worker: Yaadly pays the tradesperson, being their quoted labour less 7% (5% on work agreed before 4 Oct 2026) plus materials at cost. Under the principal structure the client is never billed for the worker, so a payable_to=worker row carries a sentinel client_email and is readable only by the named worker and by admins.';

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
  v_fee_rate  numeric;
  v_fee_pct   text;
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
       and i.addon_id is null   -- 20260928235000
  ) then
    raise exception 'This job''s worker payable has already been raised.' using errcode = 'check_violation';
  end if;

  v_labour    := round(coalesce(v_quote.labour_jmd, 0));
  -- Since 20260914112000: only the materials not already paid to the worker,
  -- up front as a tranche or on a stage payable. It was the whole line.
  v_materials := public.materials_owed_to_worker_jmd(p_job);
  -- 20261004150246: the rate in force when the worker gave this quote.
  v_fee_rate  := public.worker_fee_rate(v_quote.created_at);
  v_fee_pct   := trim(to_char(v_fee_rate * 100, 'FM990'));
  v_margin    := round(v_labour * v_fee_rate);
  v_rate      := v_labour - v_margin;
  v_total     := v_rate + v_materials;

  v_id := public.new_invoice_number();
  insert into public.invoices (id, client_name, client_email, worker_email, job_id, drafted_by, currency, period_label, payable_to, worker_labour_jmd, worker_fee_jmd, notes)
  values (v_id, 'Yaadly Ltd', 'payable@yaadly.invalid', v_quote.worker_email, p_job, 'human', 'JMD', 'Work completed', 'worker', v_labour, v_margin,
    'What Yaadly owes ' || coalesce(v_quote.worker_name, 'the tradesperson') || ' for this job. Yaadly engaged them at their quoted labour price less ' || v_fee_pct || '%, agreed in writing before they accepted, plus any materials at cost not already paid to them, with nothing deducted. Yaadly pays this directly. The client is not a party to it.');

  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_id, null, v_job.title || ', agreed rate, quoted labour less ' || v_fee_pct || '%', 1, v_rate, 'manual');
  if v_materials > 0 then
    insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
    values (v_id, null, 'Materials, at cost, nothing deducted', 1, v_materials, 'manual');
  end if;

  return query select v_id, v_total;
end $function$;

create or replace function public.raise_job_stage_worker_payable(p_job text, p_stage integer)
returns table(invoice_id text, total_jmd integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job           jobs%rowtype;
  v_quote         job_quotes%rowtype;
  v_stage_name    text;
  v_pct           numeric;
  v_from_pack     boolean := true;
  v_has_materials boolean;
  v_labour_amt    integer;
  v_fee_rate      numeric;
  v_fee_pct       text;
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

  -- The stage's share of his quoted labour, then the agreed margin, at the
  -- rate in force when the quote was given (20261004150246). Rounding is
  -- applied to the stage amount rather than to the whole job, so the stages
  -- sum to the same figure the whole-job payable would produce, give or take
  -- a dollar of rounding on each.
  v_fee_rate   := public.worker_fee_rate(v_quote.created_at);
  v_fee_pct    := trim(to_char(v_fee_rate * 100, 'FM990'));
  v_labour_amt := round(coalesce(v_quote.labour_jmd, 0) * v_pct / 100);
  v_margin     := round(v_labour_amt * v_fee_rate);
  v_rate       := v_labour_amt - v_margin;

  -- Materials land on whichever stage filed the materials evidence, at cost,
  -- never reduced by the margin. Since 20260914112000 only what the worker has
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
      || 'Their quoted labour for this stage less the agreed ' || v_fee_pct || '%'
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

create or replace function public._sign_off_addon(p_addon uuid, p_by text)
returns table(worker_payable text, second_invoice text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_a        job_addons%rowtype;
  v_job      jobs%rowtype;
  v_fee_rate numeric;
  v_fee_pct  text;
  v_rate     integer;
  v_pay      text;
  v_second   text;
begin
  if coalesce(btrim(p_by), '') = '' then
    raise exception 'A named person has to approve this.' using errcode = '28000';
  end if;
  select * into v_a from job_addons where id = p_addon for update;
  if not found then
    raise exception 'No such add-on.';
  end if;
  if v_a.status <> 'agreed' then
    raise exception 'Only an agreed add-on can be signed off. This one is %.', replace(v_a.status, '_', ' ');
  end if;
  if not exists (select 1 from invoices i
                  where i.addon_id = p_addon and coalesce(i.payable_to, 'yaadly') = 'yaadly' and i.status = 'paid') then
    raise exception 'The add-on''s invoice is not marked paid, so the work should not have started.';
  end if;
  if not exists (select 1 from job_addon_evidence e where e.addon_id = p_addon) then
    raise exception 'No evidence has been filed on this add-on. Sign-off is on evidence.';
  end if;
  select * into v_job from jobs where id = v_a.job_id;
  if coalesce(v_job.worker_email, '') = '' then
    raise exception 'This job has no booked tradesperson to pay.';
  end if;

  update job_addons
     set status = 'signed_off', signed_off_at = now(), signed_off_by = lower(btrim(p_by)), updated_at = now()
   where id = p_addon;

  -- 20261004150246: the rate in force when the add-on was agreed.
  v_fee_rate := public.worker_fee_rate(coalesce(v_a.agreed_at, v_a.created_at));
  v_fee_pct  := trim(to_char(v_fee_rate * 100, 'FM990'));
  v_rate := v_a.amount_jmd - round(v_a.amount_jmd * v_fee_rate);
  v_pay := public.new_invoice_number();
  insert into public.invoices (id, client_name, client_email, worker_email, job_id, addon_id, drafted_by, currency, period_label, payable_to, worker_labour_jmd, worker_fee_jmd, notes)
  values (v_pay, 'Yaadly Ltd', 'payable@yaadly.invalid', v_job.worker_email, v_a.job_id, v_a.id, 'human', 'JMD', 'Add-on completed', 'worker', v_a.amount_jmd, v_a.amount_jmd - v_rate,
    'What Yaadly owes ' || coalesce(v_job.worker_name, 'the tradesperson') || ' for agreed add-on work on this job: the amount agreed with the client less ' || v_fee_pct || '%, with nothing else deducted. Yaadly pays this directly. The client is not a party to it.');
  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_pay, null, 'Add-on: ' || left(regexp_replace(btrim(v_a.scope), '\s+', ' ', 'g'), 100) || ', agreed amount less ' || v_fee_pct || '%', 1, v_rate, 'manual');
  update public.invoices set status = 'sent' where id = v_pay;

  if v_a.terms = 'half_now_half_on_signoff' then
    v_second := public._draft_addon_client_invoice(p_addon, 'second');
  end if;

  perform public._touch_job(v_a.job_id);
  return query select v_pay, v_second;
end $function$;

-- The signed text says 7% from v1.8 (web/lib/legal-copy.json). Every worker
-- re-signs before new work, which is how they are told before it applies.
update public.app_settings set value = '1.8' where key = 'worker_guidelines_version';
