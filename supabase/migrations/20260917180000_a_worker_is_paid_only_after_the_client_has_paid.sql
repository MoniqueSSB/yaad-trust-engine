-- A worker is paid for a stage only after the client has paid for it.
--
-- Founder decision, 17 Sep 2026: "This should be blocked until I have
-- received confirmation that the client has paid for this stage. So there
-- also should be a back end where there's a check that the stage has been
-- paid for by the client before the worker is paid."
--
-- Until today a worker's pay invoice could be marked sent, or paid through
-- Stripe, while the client's bill for the same work was still unpaid. Yaadly
-- would have carried the whole of that risk. The desk now shows it and
-- refuses; this file is the part that holds when nobody is looking at the
-- desk.
--
-- WHAT CHANGES
--   worker_pay_client_unpaid(p_invoice)   NEW. Returns NULL when the client's
--                                         money for the work on this pay
--                                         invoice has been marked paid, and
--                                         otherwise a plain-English reason.
--   mark_worker_paid()                    refuses while that reason is not
--                                         NULL, for bank transfer and Stripe
--                                         alike. The body is the live
--                                         definition read with
--                                         pg_get_functiondef on 17 Sep 2026,
--                                         with one gate added.
--   yaad-payout-send                      calls the same function before it
--                                         quotes and again before it sends,
--                                         because a Stripe payout leaves
--                                         before mark_worker_paid runs.
--
-- THE RULE. "Client bills" are this job's invoices payable to Yaadly that are
-- not void and have an amount on them. A bill with nothing left on it (every
-- line moved into parts) is not counted. Paid means status 'paid', which only
-- a named person or a verified card payment sets.
--
--   Pay invoice for stage N, job billed BY STAGE
--     (an accepted quote says by_stage, or any client bill carries stage 1+):
--       a paid client bill for stage N must exist, and every client bill for
--       stage N, the whole-job bills (no stage, where the fee sits) and the
--       up-front materials bill (stage 0) must be paid.
--   Pay invoice for stage N, job billed IN FULL:
--       a paid whole-job bill must exist, and every whole-job bill, every
--       part taken from one, and the materials bill must be paid.
--   Pay invoice with no stage (older whole-job payables):
--       every client bill on the job must be paid, and at least one must be.
--
-- It fails closed. No job, no client bill, or a bill still in draft all
-- refuse, with the reason saying which. Nothing here pays anybody, marks
-- anything paid, or skips the call-back gate: it only adds a refusal.
--
-- NOT COVERED, ON PURPOSE: materials tranches (mark_materials_sent). The
-- worker needs that money to buy the goods, so it goes out first, on its own
-- rule (20260914112000). Founder confirmed 17 Sep 2026.

begin;

create or replace function public.worker_pay_client_unpaid(p_invoice text)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_inv      invoices%rowtype;
  v_by_stage boolean;
  v_unpaid   text;
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

  -- The client bills that must be paid for this pay invoice: live, with an
  -- amount on them, and covering this work (see THE RULE above).
  if v_inv.stage is null then
    if not exists (select 1 from invoices c
                    where c.job_id = v_inv.job_id and coalesce(c.payable_to, 'yaadly') = 'yaadly'
                      and c.status = 'paid' and coalesce(c.total_pence, 0) > 0) then
      return format('The client has not paid anything on job %s yet. Pay the worker once their bill is marked paid on Invoices.', v_inv.job_id);
    end if;
  elsif v_by_stage then
    if not exists (select 1 from invoices c
                    where c.job_id = v_inv.job_id and coalesce(c.payable_to, 'yaadly') = 'yaadly'
                      and c.status = 'paid' and coalesce(c.total_pence, 0) > 0 and c.stage = v_inv.stage) then
      return format('The client has not paid for stage %s of job %s yet. Pay the worker once the client''s stage %s bill is marked paid on Invoices.', v_inv.stage, v_inv.job_id, v_inv.stage);
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
       or (v_by_stage and c.stage = v_inv.stage)
     );
  if v_unpaid is not null then
    return format('Job %s still has client money not marked paid: %s. Pay the worker once it is.', v_inv.job_id, v_unpaid);
  end if;

  return null;
end
$function$;

comment on function public.worker_pay_client_unpaid(text) is
  'NULL when the client''s bills covering the work on this worker pay invoice are all marked paid; otherwise a plain-English reason the worker may not be paid yet. Read by mark_worker_paid, yaad-payout-send and the desk. Admin or service role only. Founder decision 17 Sep 2026, 20260917180000.';

revoke all on function public.worker_pay_client_unpaid(text) from public, anon;
grant execute on function public.worker_pay_client_unpaid(text) to authenticated, service_role;

create or replace function public.mark_worker_paid(p_invoice text, p_method text, p_ref text default ''::text)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inv    invoices%rowtype;
  v_method text := nullif(btrim(lower(coalesce(p_method, ''))), '');
  v_ref    text := btrim(coalesce(p_ref, ''));
  v_at     timestamptz;
  v_why    text;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  if v_method is null or v_method not in ('bank_transfer', 'stripe') then
    raise exception 'Say how it was paid: bank_transfer or stripe.'
      using errcode = 'check_violation';
  end if;

  select * into v_inv from invoices where id = p_invoice for update;
  if not found then
    raise exception 'No such invoice.' using errcode = 'check_violation';
  end if;
  if v_inv.payable_to is distinct from 'worker' then
    raise exception 'Invoice % is a client''s bill, not a worker''s pay. Mark it paid on Invoices.', v_inv.id
      using errcode = 'check_violation';
  end if;
  if v_inv.status = 'paid' then
    raise exception 'Invoice % was already marked paid on %.', v_inv.id,
      coalesce(to_char(v_inv.paid_at at time zone 'America/Jamaica', 'FMDD Mon YYYY'), 'an earlier date')
        || case when btrim(coalesce(v_inv.paid_by, '')) <> '' then ' by ' || v_inv.paid_by else '' end
      using errcode = 'check_violation';
  end if;
  if v_inv.status <> 'sent' then
    raise exception 'Invoice % is %, not sent, so nothing is owed on it yet.', v_inv.id, v_inv.status
      using errcode = 'check_violation';
  end if;
  -- 20260914240000: nobody is paid on details nobody has checked by phone.
  if not public.worker_bank_checked(v_inv.worker_email) then
    raise exception 'Call % back on the number you have for them, check their bank details, and press Call-back done on Pay workers first. Their details have not been checked by phone since they were last given.',
      coalesce(nullif(btrim(v_inv.worker_email), ''), 'the worker')
      using errcode = 'check_violation';
  end if;
  -- 20260917180000: a worker is paid only after the client has paid for the work.
  v_why := public.worker_pay_client_unpaid(v_inv.id);
  if v_why is not null then
    raise exception '%', v_why using errcode = 'check_violation';
  end if;
  -- 20260916120000: "paid by Stripe" only ever follows a payout that went out.
  if v_method = 'stripe' and not exists (
       select 1 from stripe_payouts sp
        where sp.invoice_id = v_inv.id
          and sp.outbound_payment_id = v_ref
          and sp.status in ('processing', 'posted')) then
    raise exception 'No Stripe payout with id % is recorded for %. Pay with Stripe from Pay workers; do not record a Stripe payment by hand.',
      coalesce(nullif(v_ref, ''), '(none)'), v_inv.id
      using errcode = 'check_violation';
  end if;

  update invoices
     set status = 'paid', paid_method = v_method, paid_reference = v_ref
   where id = p_invoice
  returning paid_at into v_at;

  return v_at;
end
$function$;

commit;
