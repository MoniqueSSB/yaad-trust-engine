-- Founder's own instruction, same session: "a worker needs to know which
-- job they are being paid for." Checked first, not assumed: invoices had
-- no worker-identifying column at all, only client_email/client_user. A
-- worker had no structural way to read the very invoice raised in their
-- own name, whatever the portal's own money panel showed them (job title,
-- a computed take-home figure, never the actual document).
alter table public.invoices add column if not exists worker_email text;

comment on column public.invoices.worker_email is
  'Set only on a payable_to=worker invoice. Lets the worker it names read their own record; null on every other invoice type, unchanged.';

create index if not exists invoices_worker_email_idx on public.invoices (lower(worker_email));

-- Same shape as invoices_client_read: never a draft, only their own, only
-- ever the worker-pay kind (an agency fee invoice is Yaadly's business
-- with the client, not the worker's to read).
drop policy if exists invoices_worker_read on public.invoices;
create policy invoices_worker_read on public.invoices for select to authenticated
  using (payable_to = 'worker' and status <> 'draft' and lower(worker_email) = lower(auth.jwt() ->> 'email'));

drop policy if exists lines_worker_read on public.invoice_lines;
create policy lines_worker_read on public.invoice_lines for select to authenticated
  using (exists (
    select 1 from public.invoices i
     where i.id = invoice_lines.invoice_id
       and i.payable_to = 'worker' and i.status <> 'draft'
       and lower(i.worker_email) = lower(auth.jwt() ->> 'email')
  ));

-- Both raise functions now name the worker on the invoice they're raised
-- for, not only in the notes text a machine wrote for a human to read.
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

  insert into public.invoices (id, client_name, client_email, worker_email, job_id, stage, drafted_by, currency, period_label, payable_to, notes)
  values (v_id, coalesce(v_job.client_name, v_job.client_email), v_job.client_email, v_quote.worker_email, p_job, p_stage, 'human', 'JMD', v_desc, 'worker',
    'What you agreed to pay ' || coalesce(v_quote.worker_name, 'your tradesperson') || ' for "' || v_desc || '," raised the moment you approved this stage.'
      || (case when v_from_pack then '' else ' No payment schedule was on file for this job, so this uses Yaadly''s default split, 25% on the first stage and the rest on the second.' end)
      || ' This is a record, not a bill to Yaadly: pay them directly, the way you already agreed. Yaadly does not hold or move this money.');
  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_id, null, v_job.title || ' — ' || coalesce(v_quote.worker_name, 'tradesperson') || ', ' || v_desc, 1, v_amount, 'manual');

  update public.invoices set status = 'sent' where id = v_id;

  return query select v_id, v_amount;
end $function$;

create or replace function public.raise_job_worker_pay_invoice(p_job text)
returns table(invoice_id text, total_jmd integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job jobs%rowtype;
  v_quote job_quotes%rowtype;
  v_amount integer;
  v_id text;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;

  select * into v_job from jobs where id = p_job;
  if not found then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;
  if v_job.status <> 'complete' then
    raise exception 'This job is not complete yet. A worker pay invoice is a record of finished, approved work, not an estimate.' using errcode = 'check_violation';
  end if;
  if coalesce(v_job.client_email, '') = '' then
    raise exception 'This job has no client email on file to invoice.' using errcode = 'check_violation';
  end if;

  select * into v_quote from job_quotes where job_id = p_job and status = 'accepted';
  if not found then
    raise exception 'No accepted quote on this job.' using errcode = 'check_violation';
  end if;

  if exists (select 1 from invoices i where i.job_id = p_job and i.payable_to = 'worker' and i.status <> 'void') then
    raise exception 'This job''s worker pay invoice has already been raised.' using errcode = 'check_violation';
  end if;

  v_amount := round(coalesce(v_quote.labour_jmd, 0) + coalesce(v_quote.materials_jmd, 0));

  v_id := public.new_invoice_number();
  insert into public.invoices (id, client_name, client_email, worker_email, job_id, drafted_by, currency, period_label, payable_to, notes)
  values (v_id, coalesce(v_job.client_name, v_job.client_email), v_job.client_email, v_quote.worker_email, p_job, 'human', 'JMD', 'Work completed', 'worker',
    'What you agreed to pay ' || coalesce(v_quote.worker_name, 'your tradesperson') || ' for this job: their labour price plus materials at cost, no fee added. This is a record, not a bill to Yaadly: pay them directly, the way you already agreed. Yaadly does not hold or move this money.');
  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_id, null, v_job.title || ' — ' || coalesce(v_quote.worker_name, 'tradesperson') || '''s labour and materials, at cost', 1, v_amount, 'manual');

  return query select v_id, v_amount;
end $function$;

-- Every worker-pay invoice already raised gets named retroactively, so
-- nothing raised before this migration is invisible to the worker it was
-- always for.
update public.invoices i
   set worker_email = q.worker_email
  from public.job_quotes q
 where i.payable_to = 'worker'
   and i.worker_email is null
   and q.job_id = i.job_id
   and q.status = 'accepted';
