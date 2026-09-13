-- Finishes what 20260903a started. That migration converted the whole-job
-- pair to the principal structure and deliberately left the per-stage
-- function alone, because its apportionment reads two different pack
-- documents and deserved its own look rather than a rewrite in passing.
--
-- WHY IT COULD NOT STAY. raise_job_stage_worker_pay_invoice() is not called
-- by hand: trg_raise_worker_pay_on_stage_approval fires it automatically the
-- instant a client approves a stage. Left as it was, every stage approval on
-- a job already invoiced by raise_job_client_invoice() would auto-raise a
-- second document billing that same client the worker's full labour share
-- for the stage, described as "pay them directly". The client would be
-- billed twice for the same labour, once inside their all-in invoice and
-- again per stage, with nobody having pressed anything. Harmless while no
-- client payment was being taken. Not harmless now that it is.
--
-- WHAT CHANGES, and it is only these three things:
--   1. The amount becomes the stage's share of labour LESS the agreed 12%,
--      so it is what Yaadly owes, not what the client owes. Materials keep
--      the existing rule exactly: paid in full on whichever stage carries a
--      materials evidence entry, at cost, with nothing deducted.
--   2. The counterparty becomes Yaadly, with the same payable@yaadly.invalid
--      sentinel 20260903a introduced, because invoices_client_read matches on
--      lower(client_email) and this document is Yaadly's cost base. RFC 2606
--      reserves .invalid precisely so it can never be a real mailbox.
--   3. The notes stop telling the client to pay the worker.
--
-- WHAT DELIBERATELY DOES NOT CHANGE. The stage apportionment itself is
-- carried over line for line: the Kickoff Pack's payment_schedule first, the
-- approved quote pack draft's payment_stages as fallback, then Yaadly's
-- default 25/75 split when no pack exists at all, still flagged in the notes
-- when that default is what got used. The auto-send at the end stays, as does
-- the silent return on missing data, because the trigger swallows exceptions
-- and a half-raised document would be worse than none. Nothing about when a
-- stage is approved, or who approves it, is touched: a named human approving
-- the evidence is still the only thing that starts any of this.

drop function if exists public.raise_job_stage_worker_pay_invoice(text, integer);

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
  -- reads his own payable. Under the old shape this checked the client's
  -- email instead, which was right when the client was the payer.
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

  -- The stage's share of his quoted labour, then the agreed 12%. Rounding is
  -- applied to the stage amount rather than to the whole job, so the stages
  -- sum to the same figure the whole-job payable would produce, give or take
  -- a dollar of rounding on each.
  v_labour_amt := round(coalesce(v_quote.labour_jmd, 0) * v_pct / 100);
  v_margin     := round(v_labour_amt * 0.12);
  v_rate       := v_labour_amt - v_margin;

  -- Unchanged: materials land in full on whichever stage filed the receipt,
  -- at cost, never reduced by the 12%. The margin is on labour only.
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
      || 'Their quoted labour for this stage less the agreed 12%'
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
  'What Yaadly owes the tradesperson for one approved stage: that stage''s share of quoted labour less the agreed 12%, plus materials at cost on whichever stage filed the receipt. Replaces raise_job_stage_worker_pay_invoice, which billed the CLIENT the worker''s full labour share and told them to pay him directly.';

-- The trigger keeps its name and its posture: a failure here is logged and
-- never allowed to block the client's approval, because the approval is the
-- consequential act and this is bookkeeping that follows it.
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

-- Any stage payable already raised under the old shape carried the client's
-- email, which invoices_client_read would match. There is no real payment
-- data in this repository, so this is belt and braces rather than a repair,
-- but a row that survived from testing must not become readable by a client
-- the moment a real client account exists on that address.
update public.invoices
   set client_name = 'Yaadly Ltd',
       client_email = 'payable@yaadly.invalid'
 where payable_to = 'worker'
   and client_email <> 'payable@yaadly.invalid';
