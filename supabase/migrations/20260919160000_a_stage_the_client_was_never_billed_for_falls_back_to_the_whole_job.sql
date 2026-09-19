-- A stage the client was never billed for falls back to the whole job.
--
-- Founder instruction, 19 September 2026, on the Pay workers row that could
-- not be cleared by any click: "do one", narrow the rule.
--
-- WHAT WAS WRONG. 20260917180000 decides a job is billed by stage if any
-- client bill on it carries a stage number, and then demands a PAID client
-- bill carrying the same stage number as the worker's pay invoice. Since
-- 20260913233000 nothing in the product can produce one. raise_job_client_
-- invoice() takes no stage, and request_invoice_part() refuses outright to
-- take a part from a bill that has a stage, so every part comes out
-- stage-less. Only bills raised before 13 September carry a stage at all.
--
-- The effect, seen on INV-2026-0016 (JOB-TEST-KICKOFF-1): one legacy stage 1
-- bill from 1 September made the job look stage-billed, the stage 2 payable
-- then asked for a stage 2 bill, and there was no way to make one. The row
-- was unpayable for good. Paying the whole-job bill would not have released
-- it either. One row, on a test job, was in that shape when this was written;
-- no real money was stuck.
--
-- WHAT CHANGES. One branch. The stage rule now applies only where a client
-- bill actually carries that stage number. Where none does, the pay invoice
-- is checked against the whole job instead: a paid whole-job bill must exist,
-- and every whole-job bill and the up-front materials bill must be paid. On
-- the job above that means sending and marking INV-2026-0024 paid releases
-- the worker, which is the right answer, because at that point Yaadly has
-- been paid for the work.
--
-- WHAT DOES NOT CHANGE. Everything else in 20260917180000 stands word for
-- word. It still fails closed: no job, no client bill, or a bill still in
-- draft all refuse. Where a stage 2 bill does exist and is unpaid, the stage
-- message is unchanged. The call-back gate, the Stripe payout gate and
-- mark_worker_paid's admin check are untouched, and nothing here pays
-- anybody or marks anything paid. It only ever moves a refusal from
-- "impossible to satisfy" to "pay the bill that is actually outstanding".
--
-- yaad-payout-send needs no change: it calls this same function by name,
-- before it quotes and again before it sends.
--
-- The body below is the live definition read with pg_get_functiondef on
-- 19 September 2026, with v_stage_billed added and the one branch split.

begin;

create or replace function public.worker_pay_client_unpaid(p_invoice text)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_inv          invoices%rowtype;
  v_by_stage     boolean;
  v_stage_billed boolean;
  v_unpaid       text;
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Admin only.' using errcode = '28000';
  end if;

  select * into v_inv from invoices where id = p_invoice;
  if not found then
    return 'No such invoice.';
  end if;
  if v_inv.payable_to is distinct from 'worker' then
    return format('%s is a client''s bill, not a worker''s pay.', v_inv.id);
  end if;
  if v_inv.job_id is null then
    return format('%s is not attached to a job, so there is no client payment to check it against.', v_inv.id);
  end if;

  v_by_stage := exists (
      select 1 from job_quotes q
       where q.job_id = v_inv.job_id and q.status = 'accepted' and q.billing_mode = 'by_stage')
    or exists (
      select 1 from invoices c
       where c.job_id = v_inv.job_id and coalesce(c.payable_to, 'yaadly') = 'yaadly'
         and c.status <> 'void' and coalesce(c.total_pence, 0) > 0 and c.stage >= 1);

  -- 20260919160000: is there a client bill carrying THIS stage number, in any
  -- status? Where there is not, asking for it to be paid can never be met.
  v_stage_billed := v_inv.stage is not null and exists (
      select 1 from invoices c
       where c.job_id = v_inv.job_id and coalesce(c.payable_to, 'yaadly') = 'yaadly'
         and c.status <> 'void' and coalesce(c.total_pence, 0) > 0 and c.stage = v_inv.stage);

  -- The client bills that must be paid for this pay invoice: live, with an
  -- amount on them, and covering this work (see THE RULE in 20260917180000).
  if v_inv.stage is null then
    if not exists (select 1 from invoices c
                    where c.job_id = v_inv.job_id and coalesce(c.payable_to, 'yaadly') = 'yaadly'
                      and c.status = 'paid' and coalesce(c.total_pence, 0) > 0) then
      return format('The client has not paid anything on job %s yet. Pay the worker once their bill is marked paid on Invoices.', v_inv.job_id);
    end if;
  elsif v_by_stage and v_stage_billed then
    if not exists (select 1 from invoices c
                    where c.job_id = v_inv.job_id and coalesce(c.payable_to, 'yaadly') = 'yaadly'
                      and c.status = 'paid' and coalesce(c.total_pence, 0) > 0 and c.stage = v_inv.stage) then
      return format('The client has not paid for stage %s of job %s yet. Pay the worker once the client''s stage %s bill is marked paid on Invoices.', v_inv.stage, v_inv.job_id, v_inv.stage);
    end if;
  elsif v_by_stage then
    -- No bill carries this stage number, so the whole-job bill is what covers
    -- this work. Still fails closed: something of the client's must be paid.
    if not exists (select 1 from invoices c
                    where c.job_id = v_inv.job_id and coalesce(c.payable_to, 'yaadly') = 'yaadly'
                      and c.status = 'paid' and coalesce(c.total_pence, 0) > 0 and c.stage is null) then
      return format('The client was never billed separately for stage %s of job %s, and their whole-job bill is not paid. Pay the worker once it is marked paid on Invoices.', v_inv.stage, v_inv.job_id);
    end if;
  else
    if not exists (select 1 from invoices c
                    where c.job_id = v_inv.job_id and coalesce(c.payable_to, 'yaadly') = 'yaadly'
                      and c.status = 'paid' and coalesce(c.total_pence, 0) > 0 and c.stage is null) then
      return format('The client has not paid the bill for job %s yet. Pay the worker once it is marked paid on Invoices.', v_inv.job_id);
    end if;
  end if;

  select string_agg(format('%s (%s)', c.id, c.status), ', ' order by c.id) into v_unpaid
    from invoices c
   where c.job_id = v_inv.job_id
     and coalesce(c.payable_to, 'yaadly') = 'yaadly'
     and c.status not in ('void', 'paid')
     and coalesce(c.total_pence, 0) > 0
     and (
       v_inv.stage is null
       or c.stage is null
       or c.stage = 0
       or (v_by_stage and v_stage_billed and c.stage = v_inv.stage)
     );
  if v_unpaid is not null then
    return format('Job %s still has client money not marked paid: %s. Pay the worker once it is.', v_inv.job_id, v_unpaid);
  end if;

  return null;
end
$function$;

comment on function public.worker_pay_client_unpaid(text) is
  'NULL when the client''s bills covering the work on this worker pay invoice are all marked paid; otherwise a plain-English reason the worker may not be paid yet. A stage the client was never billed separately for is checked against the whole-job bill, because nothing since 20260913233000 can raise a stage-numbered client bill. Read by mark_worker_paid, yaad-payout-send and the desk. Admin or service role only. Founder decisions 17 and 19 Sep 2026, 20260917180000 and 20260919160000.';

commit;
