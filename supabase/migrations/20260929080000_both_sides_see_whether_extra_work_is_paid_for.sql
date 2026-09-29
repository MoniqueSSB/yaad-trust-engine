-- Both sides can see whether a piece of extra work has been paid for.
--
-- WHY. Found 28 Sep 2026 on a live run. The extra work can start only once
-- the client has paid its invoice (file_addon_evidence_as_me refuses before
-- then), and the portal decides whether to show the worker "Paid, the work
-- can start" and the photo upload from those invoices. But invoices_worker_read
-- lets a worker read only invoices payable to them, so the worker never saw
-- the client's add-on invoice as paid, never got the upload form, and the
-- extra work could not be evidenced or approved. The same gap kept the
-- worker's Money tab blind to it.
--
-- WHAT THIS DOES. job_addon_bill_state(p_job): one row per add-on on the job
-- with the state of the client's bill for it (none, sent, paid) and when it
-- was paid. To the job's client, its booked worker, or an admin. Read only,
-- and no amounts, invoice numbers or client details: only what the worker
-- needs to know to start, which is whether it has been paid.

create or replace function public.job_addon_bill_state(p_job text)
returns table(addon_id uuid, bill_state text, paid_at timestamptz)
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
    select a.id,
           case when bool_or(i.status = 'paid') then 'paid'
                when bool_or(i.status = 'sent') then 'sent'
                else 'none' end,
           min(i.paid_at) filter (where i.status = 'paid')
      from job_addons a
      left join invoices i
        on i.addon_id = a.id
       and coalesce(i.payable_to, 'yaadly') <> 'worker'
       and i.status in ('sent', 'paid')
     where a.job_id = p_job
     group by a.id;
end $function$;

comment on function public.job_addon_bill_state(text) is
  'Whether each add-on''s client bill is unsent, sent or paid. For the job''s client, its booked worker, or an admin. No amounts or invoice details.';

revoke all on function public.job_addon_bill_state(text) from public, anon;
grant execute on function public.job_addon_bill_state(text) to authenticated;
