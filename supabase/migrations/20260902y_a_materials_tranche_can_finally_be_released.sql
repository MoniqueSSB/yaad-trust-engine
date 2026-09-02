-- Founder's instruction, 2 Sep 2026, on being told materials_releases had
-- zero rows on any job ever: fix this.
--
-- The cause was not that nobody had paid for materials. It was that nobody
-- COULD. 20260828c built the table, the gate that refuses a tranche until the
-- client has nominated where materials are kept, and RLS that lets only the
-- desk write. It never built the write. No function inserts into
-- materials_releases, no edge function touches it, and the desk's only money
-- verbs are the two invoice raises. So a rule the portal, the desk and the
-- Staged Payments doc all describe, the worker is paid the materials line
-- against a receipt before any labour stage, could not happen on any job.
--
-- This is that write, shaped like raise_job_agency_fee_invoice: money moves
-- when a named admin says so, by RPC, and every refusal is a sentence a human
-- can act on. Three things it checks that the trigger does not:
--
--   a booked worker, because a tranche is paid TO somebody;
--   a receipt reference, because this is money paid against a receipt and the
--   receipt is the record;
--   a ceiling, because the sum released can never exceed the materials line
--   on the accepted quote. Materials are never fee'd (20260828c), so the quote
--   figure is the whole of what may ever be released.
--
-- The nominated-store gate is deliberately NOT repeated here.
-- trg_materials_release_needs_store already refuses the insert with its own
-- message, and one gate with one message is better than two that can drift.

create or replace function public.release_materials_tranche(
  p_job         text,
  p_amount_jmd  numeric,
  p_receipt_ref text,
  p_stage       integer default null,
  p_note        text    default ''
)
returns table(release_id uuid, released_total_jmd numeric, quoted_materials_jmd numeric)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job    jobs%rowtype;
  v_quote  job_quotes%rowtype;
  v_so_far numeric;
  v_id     uuid;
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
  if coalesce(btrim(p_receipt_ref), '') = '' then
    raise exception 'A receipt reference is required. This is money paid against a receipt, and the receipt is the record.'
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(amount_jmd), 0) into v_so_far
    from materials_releases
   where job_id = p_job and released_at is not null;

  if v_so_far + p_amount_jmd > v_quote.materials_jmd then
    raise exception 'This would release J$% in total against a quoted materials line of J$%. A tranche cannot exceed what was quoted.',
      to_char(v_so_far + p_amount_jmd, 'FM999,999,999'),
      to_char(v_quote.materials_jmd, 'FM999,999,999')
      using errcode = 'check_violation';
  end if;

  insert into materials_releases (job_id, stage, amount_jmd, receipt_ref, note, released_at, released_by)
  values (p_job, p_stage, p_amount_jmd, btrim(p_receipt_ref), coalesce(p_note, ''), now(),
          coalesce(auth.jwt() ->> 'email', ''))
  returning id into v_id;

  return query select v_id, v_so_far + p_amount_jmd, v_quote.materials_jmd::numeric;
end
$function$;

grant execute on function public.release_materials_tranche(text, numeric, text, integer, text) to authenticated;
