-- Founder instruction, 9 September 2026: Yaadly's margin on the tradesperson's
-- side comes down from 12% to 5%. Yaadly engages the tradesperson at their
-- quoted labour price less 5%, and pays them that, plus materials at cost.
-- The client side (15% Guarantee and Support fee) is untouched. Blended
-- margin on labour becomes 20%, from 27%.
--
-- WHAT WAS FOUND ON THE WAY IN, and why this file is longer than "change one
-- number". Checked live on 9 September before writing this: neither
-- raise_job_worker_payable() (20260903a) nor raise_job_stage_worker_payable()
-- (20260903b) exists in production. The client half of 20260903a was applied
-- (raise_job_client_invoice, the payable_to column, the RLS policies are all
-- live), but the worker half was not, and the two old-shape functions,
-- raise_job_worker_pay_invoice() and raise_job_stage_worker_pay_invoice(),
-- are still there and the stage trigger still calls the old one. So live
-- Postgres computes no worker margin at all today: it bills the CLIENT the
-- worker's full labour with the words "pay them directly", which is the
-- arrangement the 3 September principal structure replaced and the sentence
-- the 9 September copy sweep banned. The 12% only ever existed in the repo
-- and on the worker's screens.
--
-- So this migration is written to be applied ON ITS OWN and land the correct
-- end state whether or not 20260903a and 20260903b were ever applied:
--
--   1. drops the two old-shape functions if they are still there
--   2. defines both principal-shape payables at 5%
--   3. points the stage-approval trigger at the stage payable
--   4. keeps the sentinel repair from 20260903b, harmless if already run
--   5. moves the Worker Guidelines to v1.6, because the signed text says 12%
--
-- The function bodies are 20260903a and 20260903b line for line, with 0.12
-- becoming 0.05 and the wording following it. Nothing about WHO raises a
-- payable or WHEN changes: the whole-job one is admin-raised on a complete
-- job, the stage one fires from a named human approving a stage, and the
-- trigger still swallows its own failure so bookkeeping can never block an
-- approval.
--
--   client invoice  = labour + 15% of labour + materials at cost   (unchanged)
--   worker payable  = labour -  5% of labour + materials at cost   (was 12%)
--   Yaadly margin   = 20% of labour, materials passed through at cost
--
-- RE-SIGNING. current_doc_version() reads app_settings and the worker gate
-- requires a signature at exactly that version. Live at the time of writing:
-- worker_guidelines_version is '1.5', and doc_signatures holds four rows,
-- all at '1.3', none at '1.5'. So the bump to '1.6' adds nobody to the
-- re-sign list: the four people already had to re-sign for the 3 September
-- wording and simply re-sign onto v1.6 instead.
--
-- Guardrail note. A named human still raises the whole-job payable and still
-- approves every stage. A cheaper margin is not a reason to release anything
-- on a timer, and nothing here does.

drop function if exists public.raise_job_worker_pay_invoice(text);
drop function if exists public.raise_job_stage_worker_pay_invoice(text, integer);

comment on column public.invoices.payable_to is
  'Who receives the money on this document. yaadly: the client pays Yaadly, one all-in price for the job. worker: Yaadly pays the tradesperson, being their quoted labour less 5% plus materials at cost. Under the principal structure the client is never billed for the worker, so a payable_to=worker row carries a sentinel client_email and is readable only by the named worker and by admins.';

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
  v_margin    := round(v_labour * 0.05);
  v_rate      := v_labour - v_margin;
  v_total     := v_rate + v_materials;

  v_id := public.new_invoice_number();
  -- client_email is a sentinel, not an oversight: see 20260903a. The client
  -- must not be able to read what Yaadly pays its subcontractor.
  insert into public.invoices (id, client_name, client_email, worker_email, job_id, drafted_by, currency, period_label, payable_to, notes)
  values (v_id, 'Yaadly Ltd', 'payable@yaadly.invalid', v_quote.worker_email, p_job, 'human', 'JMD', 'Work completed', 'worker',
    'What Yaadly owes ' || coalesce(v_quote.worker_name, 'the tradesperson') || ' for this job. Yaadly engaged them at their quoted labour price less 5%, agreed in writing before they accepted, plus materials at cost with nothing deducted. Yaadly pays this directly. The client is not a party to it.');

  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_id, null, v_job.title || ', agreed rate, quoted labour less 5%', 1, v_rate, 'manual');
  if v_materials > 0 then
    insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
    values (v_id, null, 'Materials, at cost, nothing deducted', 1, v_materials, 'manual');
  end if;

  return query select v_id, v_total;
end $function$;

revoke all on function public.raise_job_worker_payable(text) from public;
grant execute on function public.raise_job_worker_payable(text) to authenticated;

comment on function public.raise_job_worker_payable(text) is
  'What Yaadly owes the tradesperson on a completed managed job: their quoted labour less the agreed 5%, plus materials at cost. Margin cut from 12% to 5% on 9 September 2026, founder instruction. Replaces raise_job_worker_pay_invoice, which billed the CLIENT the worker''s full labour and told them to pay the worker directly.';

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
  v_margin        integer;
  v_rate          integer;
  v_materials_amt integer;
  v_amount        integer;
  v_id            text;
  v_desc          text;
begin
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
     order by q.created_at desc
     limit 1;
  end if;

  if v_pct is null then
    v_from_pack := false;
    if p_stage = 1 then
      v_pct := 25;
      v_stage_name := 'Stage 1';
    elsif p_stage = 2 then
      v_pct := 75;
      v_stage_name := 'Stage 2, final';
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

  -- Unchanged: materials land in full on whichever stage filed the receipt,
  -- at cost, never reduced by the 5%. The margin is on labour only.
  select exists (
    select 1 from evidence e
     where e.job_id = p_job and coalesce(e.stage, 1) = p_stage and e.kind = 'materials'
  ) into v_has_materials;
  v_materials_amt := case when v_has_materials then coalesce(v_quote.materials_jmd, 0) else 0 end;

  v_amount := v_rate + v_materials_amt;
  if v_amount <= 0 then return; end if;

  v_desc := coalesce(v_stage_name, 'Stage ' || p_stage);
  v_id := public.new_invoice_number();

  insert into public.invoices (id, client_name, client_email, worker_email, job_id, stage, drafted_by, currency, period_label, payable_to, notes)
  values (v_id, 'Yaadly Ltd', 'payable@yaadly.invalid', v_quote.worker_email, p_job, p_stage, 'human', 'JMD', v_desc, 'worker',
    'What Yaadly owes ' || coalesce(v_quote.worker_name, 'the tradesperson') || ' for "' || v_desc || '," raised the moment the client approved this stage. '
      || 'Their quoted labour for this stage less the agreed 5%'
      || (case when v_has_materials then ', plus materials at cost with nothing deducted' else '' end) || '.'
      || (case when v_from_pack then '' else ' No payment schedule was on file for this job, so this uses Yaadly''s default split, 25% on the first stage and the rest on the second.' end)
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

revoke all on function public.raise_job_stage_worker_payable(text, integer) from public;
grant execute on function public.raise_job_stage_worker_payable(text, integer) to authenticated;

comment on function public.raise_job_stage_worker_payable(text, integer) is
  'What Yaadly owes the tradesperson for one approved stage: that stage''s share of quoted labour less the agreed 5%, plus materials at cost on whichever stage filed the receipt. Margin cut from 12% to 5% on 9 September 2026, founder instruction. Replaces raise_job_stage_worker_pay_invoice, which billed the CLIENT the worker''s full labour share and told them to pay him directly.';

-- The trigger keeps its name and its posture: a failure here is logged and
-- never allowed to block the client's approval, because the approval is the
-- consequential act and this is bookkeeping that follows it. Live, this
-- still called the old-shape function; this is what repoints it.
create or replace function public.raise_worker_pay_invoice_on_stage_approval()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    perform public.raise_job_stage_worker_payable(new.job_id, new.stage);
  exception when others then
    raise warning 'raise_job_stage_worker_payable(%, %) failed: %', new.job_id, new.stage, sqlerrm;
  end;
  return new;
end $function$;

-- Carried over from 20260903b, harmless if it already ran: a worker payable
-- raised under the old shape carried the client's email, which
-- invoices_client_read would match.
update public.invoices
   set client_name = 'Yaadly Ltd',
       client_email = 'payable@yaadly.invalid'
 where payable_to = 'worker'
   and client_email <> 'payable@yaadly.invalid';

-- The signed text. web/lib/legal-copy.json moves to Worker Guidelines v1.6
-- in the same commit; this is the database half, same shape as 20260903k.
update public.app_settings set value = '1.6' where key = 'worker_guidelines_version';
