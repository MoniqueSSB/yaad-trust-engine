-- Both sides of a job can see who has been paid.
--
-- WHY. Founder instruction, 28 Sep 2026: a Money tab on the job, for the
-- client and the worker alike, showing the full breakdown, where the money
-- is and who has been paid. The client could already read their own bills
-- (invoices_client_read) and the worker their own pay invoices
-- (invoices_worker_read), but neither could see the other side's, so a
-- client could not tell whether the tradesperson had been paid for a stage
-- they approved. The Mirror Rule: both sides see the same trail.
--
-- WHAT THIS DOES. job_worker_payments(p_job) returns one row per worker pay
-- invoice on the job that is not a draft or void: which stage or add-on it
-- is for, the agreed labour it covers, and whether it is still owed or has
-- been paid, with the date. To the job's client, its booked worker, or an
-- admin, and to nobody else. Read only.
--
-- WHAT IT DOES NOT SHOW. The worker's net figure after Yaadly's 5%, the
-- payout reference or bank details. The client sees the labour share they
-- agreed and whether it has gone out; the worker already sees the rest on
-- their own invoices.

create or replace function public.job_worker_payments(p_job text)
returns table(invoice_id text, stage integer, addon_id uuid, what text, labour_jmd integer, status text, paid_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
begin
  if v_email is null then
    return;
  end if;
  if not public.is_admin() and not exists (
    select 1 from jobs j
     where j.id = p_job
       and (lower(coalesce(j.client_email, '')) = v_email or lower(coalesce(j.worker_email, '')) = v_email)
  ) then
    return;
  end if;

  return query
    select i.id,
           i.stage,
           i.addon_id,
           case when i.addon_id is not null then 'Extra work'
                when i.stage is not null then 'Stage ' || i.stage
                else coalesce(nullif(i.period_label, ''), 'Payment') end,
           i.worker_labour_jmd,
           case when i.status = 'paid' then 'paid' else 'owed' end,
           i.paid_at
      from invoices i
     where i.job_id = p_job
       and i.payable_to = 'worker'
       and i.status not in ('draft', 'void')
     order by i.stage nulls last, i.created_at;
end $function$;

comment on function public.job_worker_payments(text) is
  'Who has been paid on a job: each worker pay invoice, owed or paid. For the job''s client, its booked worker, or an admin. Read only; no net figures or payout details.';

revoke all on function public.job_worker_payments(text) from public, anon;
grant execute on function public.job_worker_payments(text) to authenticated;
