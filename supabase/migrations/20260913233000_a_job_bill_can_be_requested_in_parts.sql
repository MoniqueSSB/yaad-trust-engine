-- A job bill can be requested in parts, and each part is marked on the bill.
--
-- Founder instruction, 13 September 2026: "should be able to edit and request
-- part of an invoice and it be marked, or just a line of a total invoice".
-- Two decisions taken the same day, both hers:
--   1. each part goes to the client as its own numbered invoice;
--   2. the job starts when the agency fee (the Guarantee & Support line) is
--      paid, whichever invoice that line is on.
--
-- WHAT CHANGES
--   invoices.part_of         the whole-job bill a part was taken from. NULL on
--                            every invoice that is not a part.
--   invoices.starts_job      paying this invoice starts the job. Set on insert
--                            for exactly the shape that started a job before
--                            today (a job, no stage, payable to Yaadly, not a
--                            part), so every existing path keeps its behaviour,
--                            and moved with the fee line when a part takes it.
--   invoice_lines.is_fee     this line is Yaadly's Guarantee & Support fee. It
--                            is requested whole, never split, because it is
--                            the line that decides when the job starts.
--   invoice_lines.from_line  on a part, the bill line it came from.
--
--   sync_job_status() and start_job_on_agency_fee_paid() read starts_job
--   instead of "stage is null". Before this, any paid stage-less invoice on a
--   job counted, including a stage-less worker payable, so the rule is also
--   narrower than it was.
--
-- MONEY IS NEVER ON TWO DOCUMENTS. A part takes its amount off the bill, so
-- every total on the desk, which sums invoices one by one, still counts each
-- amount once. Voiding a part while the bill is still a draft puts the amount
-- back on the bill. Two refusals keep that true:
--   a bill with a live part cannot be voided;
--   a part cannot be voided once its bill has gone out, because the amount
--   would drop off the job's billing with nowhere to go.
--
-- NO HUMAN GATE MOVES. Requesting a part writes a draft. It emails nobody.
-- Sending, marking paid and voiding are the same named-human clicks as before.
--
-- Live definitions of raise_job_client_invoice(), sync_job_status() and
-- start_job_on_agency_fee_paid() were read with pg_get_functiondef on
-- 13 September 2026 before this was written, and read again on 14 September
-- immediately before it was applied, because 20260913230001 had meanwhile
-- rewritten sync_job_status() to call job_final_stage_count(). The body below
-- is that version. Production is also ahead of the repository for
-- raise_job_client_invoice (the materials-already-billed branch). The bodies
-- below change only what the comments name.

-- ------------------------------------------------------------------ columns

alter table public.invoices
  add column if not exists part_of text references public.invoices(id),
  add column if not exists starts_job boolean not null default false;

alter table public.invoice_lines
  add column if not exists is_fee boolean not null default false,
  add column if not exists from_line bigint references public.invoice_lines(id) on delete set null;

create index if not exists invoices_part_of_idx on public.invoices(part_of) where part_of is not null;

comment on column public.invoices.part_of is
  'The whole-job bill this invoice was requested from, as a part. NULL unless it is a part.';
comment on column public.invoices.starts_job is
  'Paying this invoice starts the job. Follows the Guarantee & Support line.';
comment on column public.invoice_lines.is_fee is
  'Yaadly''s Guarantee & Support fee line. Requested whole, never split.';
comment on column public.invoice_lines.from_line is
  'On a part invoice, the bill line this amount was taken from.';

-- ------------------------------------------------------------------ backfill
--
-- The starts_job update touches sent and paid invoices. It moves no status,
-- so invoices_status_guard passes it through, and trg_start_job_on_agency_fee_paid
-- only acts on a change INTO paid, so nothing starts twice.
--
-- is_fee is backfilled on draft bills only. A sent or paid line is frozen by
-- invoice_line_price_guard, and a part can only be requested from a draft, so
-- a frozen line never needs the flag.

update public.invoices
   set starts_job = true
 where job_id is not null and stage is null and part_of is null
   and coalesce(payable_to, 'yaadly') = 'yaadly';

update public.invoice_lines l
   set is_fee = true
  from public.invoices i
 where i.id = l.invoice_id and i.status = 'draft' and i.job_id is not null
   and i.stage is null and l.description = 'Guarantee & Support, 15%';

-- ------------------------------------------------- starts_job on every insert

create or replace function public.invoice_starts_job_default()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.part_of is null and new.job_id is not null and new.stage is null
     and coalesce(new.payable_to, 'yaadly') = 'yaadly' then
    new.starts_job := true;
  end if;
  return new;
end $function$;

drop trigger if exists invoices_starts_job_default on public.invoices;
create trigger invoices_starts_job_default
  before insert on public.invoices
  for each row execute function public.invoice_starts_job_default();

-- ------------------------------------------------------- the job start rule

create or replace function public.start_job_on_agency_fee_paid()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Was: new.job_id is not null and new.stage is null. Now whichever invoice
  -- carries the Guarantee & Support line, a bill or a part of one.
  if new.job_id is not null and new.starts_job
     and new.status = 'paid' and coalesce(old.status, '') is distinct from 'paid' then
    update public.jobs
       set stage = greatest(coalesce(stage, 0), 1), updated_at = now()
     where id = new.job_id;
  end if;
  return new;
end;
$function$;

create or replace function public.sync_job_status()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  has_quotes boolean;
  working_stage integer;
  has_unapproved_evidence boolean;
  final_stage_count integer;
  is_complete boolean;
  fee_paid boolean;
begin
  if new.status in ('disputed','cancelled') then
    return new;
  end if;

  if coalesce(new.worker_email,'') <> '' then
    -- Was: i.stage is null. Now the invoice that carries the fee, see
    -- 20260913233000.
    select exists (
      select 1 from public.invoices i
       where i.job_id = new.id and i.starts_job and i.status = 'paid'
    ) into fee_paid;

    if not fee_paid then
      new.status := 'awaiting_payment';
      return new;
    end if;

    final_stage_count := public.job_final_stage_count(new.id);

    is_complete := coalesce(new.stage, 0) > coalesce(final_stage_count, 1);

    if is_complete then
      new.status := 'complete';
    else
      working_stage := greatest(coalesce(new.stage, 0), 1);
      select exists (
        select 1 from public.evidence e
         where e.job_id = new.id and coalesce(e.stage, 1) = working_stage
      ) and not exists (
        select 1 from public.stage_approvals a
         where a.job_id = new.id and a.stage = working_stage
      ) into has_unapproved_evidence;

      new.status := case when has_unapproved_evidence then 'evidence' else 'in_progress' end;
    end if;
  elsif new.open then
    select exists (select 1 from public.job_quotes q
                    where q.job_id = new.id and q.status in ('submitted', 'quote_confirmed', 'kickoff_requested'))
      into has_quotes;
    new.status := case when has_quotes then 'quoted' else 'open_for_quotes' end;
  elsif public.client_cleared_for_golive(new.client_email) then
    new.status := 'draft';
  else
    new.status := 'awaiting_client_setup';
  end if;

  return new;
end;
$function$;

-- ------------------------------------------- the bill marks its own fee line
--
-- Production's body, read live, with one change: the Guarantee & Support line
-- is inserted with is_fee = true.

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

-- --------------------------------------------------------- request a part

create or replace function public.request_invoice_part(p_bill text, p_items jsonb)
returns table(invoice_id text, total integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_bill   invoices%rowtype;
  v_item   jsonb;
  v_line   invoice_lines%rowtype;
  v_amount integer;
  v_id     text;
  v_fee    boolean := false;
  v_seen   bigint[] := '{}';
  v_sort   integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;

  select * into v_bill from invoices where id = p_bill for update;
  if not found then
    raise exception 'No such invoice.' using errcode = 'check_violation';
  end if;
  if v_bill.job_id is null or v_bill.stage is not null or v_bill.part_of is not null
     or coalesce(v_bill.payable_to, 'yaadly') <> 'yaadly' then
    raise exception 'Only a whole-job bill can be requested in parts, and % is not one.', p_bill
      using errcode = 'check_violation';
  end if;
  if v_bill.status <> 'draft' then
    raise exception '% is % and frozen, so nothing more can be taken off it. Parts are requested while the bill is still a draft.', p_bill, v_bill.status
      using errcode = 'check_violation';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Tick at least one line to request.' using errcode = 'check_violation';
  end if;

  v_id := public.new_invoice_number();
  insert into public.invoices (id, client_name, client_email, client_address, client_company, client_user,
                               job_id, drafted_by, currency, period_label, payable_to, part_of, notes)
  values (v_id, v_bill.client_name, v_bill.client_email, coalesce(v_bill.client_address, ''), v_bill.client_company, v_bill.client_user,
          v_bill.job_id, 'human', v_bill.currency, 'Part payment', 'yaadly', p_bill,
    'Part of the agreed price for job ' || v_bill.job_id || ', bought from Yaadly. The rest of the price is invoiced separately, and nothing on this invoice is charged again. You do not pay the tradesperson: Yaadly engages and pays them.');

  for v_item in select value from jsonb_array_elements(p_items) loop
    select * into v_line from invoice_lines l
     where l.id = (v_item->>'line')::bigint and l.invoice_id = p_bill;
    if not found then
      raise exception 'Line % is not on %.', v_item->>'line', p_bill using errcode = 'check_violation';
    end if;
    if v_line.id = any(v_seen) then
      raise exception 'The line "%" is ticked twice.', v_line.description using errcode = 'check_violation';
    end if;
    v_seen := v_seen || v_line.id;

    if v_line.price_source = 'needs_price' then
      raise exception 'The line "%" has no price yet. Price it before requesting it.', v_line.description
        using errcode = 'check_violation';
    end if;

    v_amount := round(coalesce((v_item->>'amount')::numeric, v_line.line_total_pence));
    if v_amount <= 0 or v_amount > v_line.line_total_pence then
      raise exception 'Request between 1 and % on "%".', v_line.line_total_pence, v_line.description
        using errcode = 'check_violation';
    end if;
    if v_line.is_fee and v_amount <> v_line.line_total_pence then
      raise exception 'The Guarantee & Support fee is requested whole, never split: it is the line whose payment starts the job.'
        using errcode = 'check_violation';
    end if;

    insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source, sort, is_fee, from_line)
    values (v_id, null,
            case when v_amount = v_line.line_total_pence then v_line.description
                 else regexp_replace(v_line.description, ', balance$', '') || ', part' end,
            1, v_amount, 'manual', v_sort, v_line.is_fee, v_line.id);

    if v_amount = v_line.line_total_pence then
      delete from public.invoice_lines where id = v_line.id;
    else
      update public.invoice_lines
         set qty = 1,
             unit_amount_pence = v_line.line_total_pence - v_amount,
             price_source = 'manual',
             description = regexp_replace(v_line.description, ', balance$', '') || ', balance'
       where id = v_line.id;
    end if;

    v_fee  := v_fee or v_line.is_fee;
    v_sort := v_sort + 1;
  end loop;

  if v_fee then
    update public.invoices set starts_job = true  where id = v_id;
    update public.invoices set starts_job = false where id = p_bill;
  end if;

  return query select i.id, i.total_pence from public.invoices i where i.id = v_id;
end $function$;

comment on function public.request_invoice_part(text, jsonb) is
  'Takes ticked lines, or an amount off a line, from a draft whole-job bill onto a new numbered draft invoice, part_of the bill. The fee line moves whole and carries starts_job with it. Emails nobody.';

-- ------------------------------------------------------------ void guards

create or replace function public.invoice_part_void_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_live        text;
  v_bill_status text;
begin
  if new.status = 'void' and old.status is distinct from 'void' then
    if new.part_of is null then
      select string_agg(p.id, ', ' order by p.id) into v_live
        from public.invoices p where p.part_of = new.id and p.status <> 'void';
      if v_live is not null then
        raise exception '% has parts still live (%). Void those first, or they would point at a bill that no longer exists.', new.id, v_live
          using errcode = 'check_violation';
      end if;
    else
      select status into v_bill_status from public.invoices where id = new.part_of;
      if v_bill_status is distinct from 'draft' then
        raise exception 'The rest of this job has already gone out on %, which is %. Voiding % now would take its amount off the job''s billing with nowhere to go.', new.part_of, v_bill_status, new.id
          using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end $function$;

drop trigger if exists invoices_part_void_guard on public.invoices;
create trigger invoices_part_void_guard
  before update on public.invoices
  for each row execute function public.invoice_part_void_guard();

create or replace function public.invoice_part_void_restore()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  l record;
begin
  if new.part_of is not null and new.status = 'void' and old.status is distinct from 'void' then
    for l in select * from public.invoice_lines where invoice_id = new.id order by sort, id loop
      if l.from_line is not null and exists (
        select 1 from public.invoice_lines b where b.id = l.from_line and b.invoice_id = new.part_of
      ) then
        update public.invoice_lines b
           set qty = 1, unit_amount_pence = b.line_total_pence + l.line_total_pence, price_source = 'manual'
         where b.id = l.from_line;
      else
        insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source, sort, is_fee)
        values (new.part_of, null, regexp_replace(l.description, ', part$', ''), 1, l.line_total_pence, 'manual', 100 + l.sort, l.is_fee);
      end if;
    end loop;
    if new.starts_job then
      update public.invoices set starts_job = true where id = new.part_of;
    end if;
  end if;
  return null;
end $function$;

drop trigger if exists invoices_part_void_restore on public.invoices;
create trigger invoices_part_void_restore
  after update on public.invoices
  for each row execute function public.invoice_part_void_restore();

-- ------------------------------------------------------------------ grants
--
-- Supabase grants anon and authenticated directly on every new public
-- function, and "revoke from public" does not touch a direct grant
-- (20260913223042). So each is named.

revoke all on function public.request_invoice_part(text, jsonb) from public, anon;
grant execute on function public.request_invoice_part(text, jsonb) to authenticated;

revoke all on function public.raise_job_client_invoice(text) from public, anon;
grant execute on function public.raise_job_client_invoice(text) to authenticated;

revoke all on function public.invoice_starts_job_default() from public, anon, authenticated;
revoke all on function public.invoice_part_void_guard()   from public, anon, authenticated;
revoke all on function public.invoice_part_void_restore() from public, anon, authenticated;
