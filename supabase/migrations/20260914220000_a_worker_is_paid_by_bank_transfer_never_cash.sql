-- A worker is paid by bank transfer. Never cash.
--
-- Founder, 14 Sep 2026:
--   * "no cash payments will be allowed on my site".
--   * "just work with the bank transfer now". Lynk needs Yaadly registered in
--     Jamaica first (LynkBiz asks for a Jamaican business registration, TRN,
--     Tax Compliance Certificate and an NCB banking relationship), so it
--     waits. Stripe payouts stay "coming soon" until Global Payouts is
--     approved.
--
-- WHAT CHANGES
--   jobs.pay_method, the worker's own note of how they were paid, accepts
--   bank_transfer only. 'remittance' (remittance pick up, cash in hand) is
--   removed for good; 'lynk' comes back in its own migration once Yaadly can
--   pay by Lynk. record_pay_info() says so. Checked 14 Sep 2026: one job
--   carries bank_transfer, none carries lynk or remittance, so no row changes.
--
-- Written first with a Lynk iD for workers and cut back the same hour, before
-- it was committed, on the founder's instruction.

begin;

alter table public.jobs drop constraint if exists jobs_pay_method_chk;
alter table public.jobs add constraint jobs_pay_method_chk
  check (pay_method is null or pay_method = 'bank_transfer');

comment on column public.jobs.pay_method is
  'How the worker was paid for this job: bank_transfer. Never cash (founder, 14 Sep 2026: remittance pick up removed in 20260914220000). Lynk returns once Yaadly is registered in Jamaica. Set by the worker through record_pay_info().';

create or replace function public.record_pay_info(p_job text, p_method text, p_ref text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email  text;
  v_method text := nullif(btrim(coalesce(p_method, '')), '');
begin
  v_email := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
  if v_email is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  if v_method is not null and v_method <> 'bank_transfer' then
    raise exception 'Yaadly pays by bank transfer. It does not pay in cash.' using errcode = 'check_violation';
  end if;

  update public.jobs
     set pay_method = v_method,
         pay_ref    = nullif(btrim(coalesce(p_ref, '')), '')
   where id = p_job
     and lower(coalesce(worker_email, '')) = v_email;

  if not found then
    raise exception 'That is not your job.' using errcode = '28000';
  end if;
end;
$$;

commit;
