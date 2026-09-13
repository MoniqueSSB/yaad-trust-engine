-- A stage payable needs a recorded stage approval, and nobody outside the
-- database can raise one.
--
-- Founder instruction, 13 September 2026 ("do that"), on a finding from the
-- same day.
--
-- WHAT WAS WRONG. raise_job_stage_worker_payable() is SECURITY DEFINER and,
-- unlike its two siblings raise_job_client_invoice() and
-- raise_job_worker_payable(), carries no is_admin() check. Checked live before
-- writing this: anon, authenticated and service_role all held EXECUTE on it.
-- 20260903b and 20260909120000 both ran "revoke all ... from public", but
-- Supabase grants anon and authenticated directly on every new function in
-- the public schema, and a revoke from public does not touch a direct grant.
-- So anyone holding the publishable key, signed in or not, could call it over
-- the API with a job id and a stage number and raise a worker payable, marked
-- sent, for a stage no client had approved. Nobody did: the three stage
-- payables in production are all on TEST jobs and each has a matching
-- stage_approvals row.
--
-- WHY NOT AN ADMIN CHECK. The only legitimate caller is the trigger
-- trg_raise_worker_pay_on_stage_approval, AFTER INSERT on stage_approvals.
-- It runs in the approver's session, so is_admin() is false whenever the
-- approver is not an admin, and the trigger swallows exceptions by design.
-- An admin check would stop stage payables being raised at all, silently.
--
-- WHAT THIS DOES, two locks:
--   1. EXECUTE comes off public, anon and authenticated. The trigger function
--      is SECURITY DEFINER and owned by postgres, which owns this function
--      too, so the trigger keeps working. Nothing else calls it: checked in
--      pg_proc and across web/, concierge/ and supabase/functions/.
--   2. Inside the function, no stage_approvals row for this job and this
--      stage means no payable. The trigger fires after that row is written,
--      so the normal path is unchanged. This is the one that holds even if a
--      grant is ever put back by mistake.
--
-- Everything else in the body is 20260909120000 line for line: the 5%, the
-- stage split and its fallbacks, materials at cost, the auto-send.

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

-- The door. Named roles one by one, because "from public" alone is what left
-- anon and authenticated holding it. service_role keeps it: it already
-- bypasses RLS and every other control, so taking it away protects nothing.
revoke all on function public.raise_job_stage_worker_payable(text, integer) from public, anon, authenticated;

comment on function public.raise_job_stage_worker_payable(text, integer) is
  'What Yaadly owes the tradesperson for one approved stage: that stage''s share of quoted labour less the agreed 5%, plus materials at cost on whichever stage filed the receipt. Raises nothing unless a stage_approvals row exists for the job and stage. Not callable over the API: only the stage-approval trigger runs it. Locked down 13 September 2026, see 20260913223042.';
