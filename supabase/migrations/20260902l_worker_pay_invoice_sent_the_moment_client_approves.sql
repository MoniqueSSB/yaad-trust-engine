-- Founder's own resolution, same session: the human confirming this
-- invoice IS the client, approving the stage, in their own authenticated
-- session, at that exact moment. "The client is approving the workflow."
-- That is a real, named human taking a real action, the governing rule's
-- own bar, it just is not an admin, and this was never an admin's decision
-- to make: it is arithmetic on terms the client and worker already agreed.
--
-- Deliberately narrow. This only ever touches the PER-STAGE worker pay
-- invoice (20260902j/k), raised inside the same security-definer chain
-- the client's own approve_stage() call already runs in, no separate HTTP
-- round trip to yaad-invoice and no service-role bypass of its own
-- Admin-only gate needed: invoice_status_guard only requires is_admin()
-- for sent -> paid, never for draft -> sent, so setting status directly
-- on insert is exactly as guarded as it was before, nothing loosened.
-- The whole-job fallback (raise_job_worker_pay_invoice, 20260902i, an
-- admin's own separate click) is untouched: that path stays admin-raised
-- and admin-sent exactly as it already was.
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
  v_from_pack boolean := true;
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

  v_labour_amt := round(coalesce(v_quote.labour_jmd, 0) * v_pct / 100);

  select exists (
    select 1 from evidence e
     where e.job_id = p_job and coalesce(e.stage, 1) = p_stage and e.kind = 'materials'
  ) into v_has_materials;
  v_materials_amt := case when v_has_materials then coalesce(v_quote.materials_jmd, 0) else 0 end;

  v_amount := v_labour_amt + v_materials_amt;
  if v_amount <= 0 then return; end if;

  v_desc := coalesce(v_stage_name, 'Stage ' || p_stage);
  v_id := public.new_invoice_number();
  -- status inserted as 'sent' directly: the client's own approval, right
  -- here, is the confirmation this invoice needed. sent_at set by hand
  -- since invoice_status_guard's own draft->sent logic is an UPDATE
  -- trigger and never runs on an INSERT.
  insert into public.invoices (id, client_name, client_email, job_id, stage, drafted_by, currency, period_label, payable_to, notes, status, sent_at)
  values (v_id, coalesce(v_job.client_name, v_job.client_email), v_job.client_email, p_job, p_stage, 'human', 'JMD', v_desc, 'worker',
    'What you agreed to pay ' || coalesce(v_quote.worker_name, 'your tradesperson') || ' for "' || v_desc || '," raised the moment you approved this stage.'
      || (case when v_from_pack then '' else ' No payment schedule was on file for this job, so this uses Yaadly''s default split, 25% on the first stage and the rest on the second.' end)
      || ' This is a record, not a bill to Yaadly: pay them directly, the way you already agreed. Yaadly does not hold or move this money.',
    'sent', now());
  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_id, null, v_job.title || ' — ' || coalesce(v_quote.worker_name, 'tradesperson') || ', ' || v_desc, 1, v_amount, 'manual');

  return query select v_id, v_amount;
end $function$;
