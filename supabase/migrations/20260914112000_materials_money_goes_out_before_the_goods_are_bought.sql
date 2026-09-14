-- Materials money goes out before the goods are bought, once the client has
-- paid for them. The receipt comes back afterwards.
--
-- Founder, 14 Sep 2026: "Material money is released before so people can buy
-- the goods, the worker is not buying the goods first." Recorded in
-- DECISIONS.md that morning and built here, on her instruction ("yes build").
--
-- Until now release_materials_tranche() refused without a receipt reference,
-- which in practice made the worker buy the materials out of their own pocket
-- and claim it back. The client panel, the desk and the trades page all said
-- "against a receipt".
--
-- WHAT CHANGES
--   1. release_materials_tranche() no longer needs a receipt. It refuses
--      instead to release more than the client has PAID for materials, as
--      well as more than was quoted. Still admin only: a named person on the
--      desk presses it. Nothing is released because a bill was paid; the bill
--      being paid is only what makes the button allowed to work.
--   2. materials_paid_jmd(job): the J$ of materials lines on this job's PAID
--      Yaadly invoices. That is the whole-job bill, a separate materials
--      invoice (raise_job_materials_invoice, stage 0), or the paid parts of a
--      bill requested in parts. A materials line is found by the wording every
--      raise function writes, "Materials, at cost", which request_invoice_part
--      keeps with ", part" or ", balance" after it. If somebody retypes that
--      wording in the invoice editor the line stops counting, so a release is
--      refused rather than over-allowed: it fails shut.
--   3. record_materials_receipt(release, receipt, note): the receipt comes
--      back afterwards against the release it accounts for, a milestone for
--      the money only, not tied to a stage. Stamped with who recorded it and
--      when. A recorded receipt is not overwritten; a correction is a note.
--   4. materials_releases.receipt_at and receipt_by. A released row with a
--      blank receipt_ref is a receipt still to come. That is already how the
--      live views materials_open_releases and materials_reconciliation read
--      it (they exist in production and not in this repository); they are
--      untouched.
--   5. The double payment. raise_job_stage_worker_payable() added the WHOLE
--      quoted materials line to a stage payable whenever materials evidence
--      was on that stage, on every such stage, and nothing subtracted a
--      tranche already released; raise_job_worker_payable() did the same for
--      the whole job. Paying materials up front would have paid them twice.
--      Both now add only materials_owed_to_worker_jmd(job): quoted, less
--      released, less materials already on the worker's live payables.
--      Checked 14 Sep 2026: production has no release, no materials evidence
--      and no worker payable carrying materials, so no existing row changes.
--
-- NO HUMAN GATE MOVES. A release is still one named admin click. A stage
-- payable still needs a recorded stage approval (the hold point from
-- 20260913223042, kept line for line). Recording a receipt releases nothing.
--
-- Live bodies of release_materials_tranche, raise_job_stage_worker_payable
-- and raise_job_worker_payable were read with pg_get_functiondef on
-- 14 Sep 2026 before this was written. The bodies below change only what the
-- comments name. CREATE OR REPLACE keeps each function's existing grants.

-- ------------------------------------------------------------------ columns

alter table public.materials_releases
  add column if not exists receipt_at timestamptz,
  add column if not exists receipt_by text not null default '';

update public.materials_releases
   set receipt_at = coalesce(receipt_at, released_at, created_at),
       receipt_by = case when receipt_by = '' then released_by else receipt_by end
 where btrim(coalesce(receipt_ref, '')) <> '' and receipt_at is null;

comment on column public.materials_releases.receipt_ref is
  'The supplier receipt this release is accounted for by. Blank on a released row means the receipt is still to come: since 20260914112000 money goes out before the goods are bought, and the receipt comes back afterwards through record_materials_receipt().';
comment on column public.materials_releases.receipt_at is
  'When the receipt was recorded against this release. Null while it is still to come.';
comment on column public.materials_releases.receipt_by is
  'Who recorded the receipt: the signed-in admin''s email.';

-- ------------------------------------------------------------------ helpers

create or replace function public.materials_paid_jmd(p_job text)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(sum(l.line_total_pence), 0)::integer
    from public.invoices i
    join public.invoice_lines l on l.invoice_id = i.id
   where i.job_id = p_job
     and i.payable_to = 'yaadly'
     and i.status = 'paid'
     and upper(coalesce(i.currency, 'JMD')) = 'JMD'
     and l.description ilike 'Materials, at cost%';
$function$;

comment on function public.materials_paid_jmd(text) is
  'J$ of materials the client has paid Yaadly for on this job: materials lines on paid Yaadly invoices (whole bill, materials invoice, or paid parts). What release_materials_tranche() may release up to. 20260914112000.';

create or replace function public.materials_owed_to_worker_jmd(p_job text)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select greatest(
    coalesce((select round(q.materials_jmd) from public.job_quotes q
               where q.job_id = p_job and q.status = 'accepted' limit 1), 0)
    - coalesce((select sum(r.amount_jmd) from public.materials_releases r
                 where r.job_id = p_job and r.released_at is not null), 0)
    - coalesce((select sum(l.line_total_pence)
                  from public.invoices i
                  join public.invoice_lines l on l.invoice_id = i.id
                 where i.job_id = p_job and i.payable_to = 'worker' and i.status <> 'void'
                   and l.description ilike 'Materials, at cost%'), 0),
    0)::integer;
$function$;

comment on function public.materials_owed_to_worker_jmd(text) is
  'J$ of the quoted materials not yet paid to the worker: quoted, less released tranches, less materials already on the worker''s live payables. What a worker payable may add for materials, so materials are never paid twice. 20260914112000.';

-- Called only from inside the SECURITY DEFINER money functions below, which
-- are owned by postgres. Supabase grants anon and authenticated directly on
-- every new function, so they are revoked by name, not only from public.
revoke execute on function public.materials_paid_jmd(text) from public, anon, authenticated;
revoke execute on function public.materials_owed_to_worker_jmd(text) from public, anon, authenticated;

-- ------------------------------------------------------------------ release

create or replace function public.release_materials_tranche(p_job text, p_amount_jmd numeric, p_receipt_ref text, p_stage integer DEFAULT NULL::integer, p_note text DEFAULT ''::text)
 RETURNS TABLE(release_id uuid, released_total_jmd numeric, quoted_materials_jmd numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job    jobs%rowtype;
  v_quote  job_quotes%rowtype;
  v_so_far numeric;
  v_paid   numeric;
  v_id     uuid;
  v_who    text := coalesce(auth.jwt() ->> 'email', '');
  v_ref    text := btrim(coalesce(p_receipt_ref, ''));
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;

  select * into v_job from jobs where id = p_job;
  if not found then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;
  if coalesce(v_job.worker_email, '') = '' then
    raise exception 'No worker is booked on this job yet, so there is nobody to pay a materials tranche to.'
      using errcode = 'check_violation';
  end if;

  select * into v_quote from job_quotes where job_id = p_job and status = 'accepted';
  if not found then
    raise exception 'No accepted quote on this job yet.' using errcode = 'check_violation';
  end if;
  if coalesce(v_quote.materials_jmd, 0) <= 0 then
    raise exception 'The accepted quote on this job has no materials line, so there is nothing to release.'
      using errcode = 'check_violation';
  end if;

  if p_amount_jmd is null or p_amount_jmd <= 0 then
    raise exception 'The tranche amount must be more than zero.' using errcode = 'check_violation';
  end if;

  -- The receipt is no longer asked for here (20260914112000). Money goes out
  -- so the goods can be bought, and the receipt comes back afterwards through
  -- record_materials_receipt(). One given now is recorded now.

  select coalesce(sum(amount_jmd), 0) into v_so_far
    from materials_releases
   where job_id = p_job and released_at is not null;

  if v_so_far + p_amount_jmd > v_quote.materials_jmd then
    raise exception 'This would release J$% in total against a quoted materials line of J$%. A tranche cannot exceed what was quoted.',
      to_char(v_so_far + p_amount_jmd, 'FM999,999,999'),
      to_char(v_quote.materials_jmd, 'FM999,999,999')
      using errcode = 'check_violation';
  end if;

  -- In place of the receipt: the client has to have paid for it first.
  v_paid := public.materials_paid_jmd(p_job);
  if v_so_far + p_amount_jmd > v_paid then
    raise exception 'The client has paid J$% for materials on this job and J$% has already been released, so J$% cannot go out yet. Materials money is released once the client has paid for it: mark the bill that carries the materials paid first.',
      to_char(v_paid, 'FM999,999,999'),
      to_char(v_so_far, 'FM999,999,999'),
      to_char(p_amount_jmd, 'FM999,999,999')
      using errcode = 'check_violation';
  end if;

  insert into materials_releases (job_id, stage, amount_jmd, receipt_ref, note, released_at, released_by, receipt_at, receipt_by)
  values (p_job, p_stage, p_amount_jmd, v_ref, coalesce(p_note, ''), now(), v_who,
          case when v_ref <> '' then now() end,
          case when v_ref <> '' then v_who else '' end)
  returning id into v_id;

  return query select v_id, v_so_far + p_amount_jmd, v_quote.materials_jmd::numeric;
end
$function$;

-- ------------------------------------------------------------------ receipt

create or replace function public.record_materials_receipt(p_release uuid, p_receipt_ref text, p_note text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rel materials_releases%rowtype;
  v_ref text := btrim(coalesce(p_receipt_ref, ''));
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  if v_ref = '' then
    raise exception 'Enter the receipt reference, as it is printed on the supplier''s receipt.' using errcode = 'check_violation';
  end if;

  select * into v_rel from materials_releases where id = p_release for update;
  if not found then
    raise exception 'No such materials release.' using errcode = 'check_violation';
  end if;
  if v_rel.released_at is null then
    raise exception 'That tranche has not been released, so there is no money for a receipt to account for.' using errcode = 'check_violation';
  end if;
  if btrim(coalesce(v_rel.receipt_ref, '')) <> '' then
    raise exception 'This release already has receipt % recorded against it. A receipt is the record, so it is not overwritten: add a note instead.', v_rel.receipt_ref
      using errcode = 'check_violation';
  end if;

  update materials_releases
     set receipt_ref = v_ref,
         receipt_at  = now(),
         receipt_by  = coalesce(auth.jwt() ->> 'email', ''),
         note        = case when btrim(coalesce(p_note, '')) = '' then note
                            else btrim(note || ' ' || btrim(p_note)) end
   where id = p_release;
end
$function$;

comment on function public.record_materials_receipt(uuid, text, text) is
  'The supplier receipt, recorded against the materials release it accounts for, after the money has gone out. Admin only, stamped, never overwritten. 20260914112000.';

revoke execute on function public.record_materials_receipt(uuid, text, text) from public, anon;
grant execute on function public.record_materials_receipt(uuid, text, text) to authenticated;

-- ------------------------------------------------------------------ worker payables

create or replace function public.raise_job_stage_worker_payable(p_job text, p_stage integer)
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

  insert into public.invoices (id, client_name, client_email, worker_email, job_id, stage, drafted_by, currency, period_label, payable_to, notes)
  values (v_id, 'Yaadly Ltd', 'payable@yaadly.invalid', v_quote.worker_email, p_job, p_stage, 'human', 'JMD', v_desc, 'worker',
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

create or replace function public.raise_job_worker_payable(p_job text)
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
  insert into public.invoices (id, client_name, client_email, worker_email, job_id, drafted_by, currency, period_label, payable_to, notes)
  values (v_id, 'Yaadly Ltd', 'payable@yaadly.invalid', v_quote.worker_email, p_job, 'human', 'JMD', 'Work completed', 'worker',
    'What Yaadly owes ' || coalesce(v_quote.worker_name, 'the tradesperson') || ' for this job. Yaadly engaged them at their quoted labour price less 5%, agreed in writing before they accepted, plus any materials at cost not already paid to them, with nothing deducted. Yaadly pays this directly. The client is not a party to it.');

  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_id, null, v_job.title || ', agreed rate, quoted labour less 5%', 1, v_rate, 'manual');
  if v_materials > 0 then
    insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
    values (v_id, null, 'Materials, at cost, nothing deducted', 1, v_materials, 'manual');
  end if;

  return query select v_id, v_total;
end $function$;
