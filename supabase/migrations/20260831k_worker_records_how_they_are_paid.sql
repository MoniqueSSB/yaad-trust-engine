-- Stage 5.6, the worker's money-first portal view.
--
-- jobs carries pay_method and pay_ref, added long before this migration and
-- never once written to or read by any code in this repository. There is no
-- payment integration here and none is planned before the legal review lands
-- (CLAUDE.md 9 and 10): a worker is paid off-platform, by bank transfer,
-- Lynk wallet or remittance pick up, within 3 working days of the client
-- approving. These two columns are the worker's own record of which of those
-- three they were paid by and what reference it carried, kept for their own
-- history and for a dispute over whether a payment actually happened. They
-- are not a payment rail and this migration does not make them one.
--
-- Same shape as approve_stage: a named human (the worker, about their own
-- money) confirms a fact, in a SECURITY DEFINER function that checks its own
-- caller rather than trusting an UPDATE policy. jobs has no worker-write RLS
-- policy at all today (only admin has write access; client and worker are
-- read-only), and it stays that way. This function is the one narrow door.

-- Two rows (JOB-0002, JOB-0003) carry '' rather than null, from whatever
-- created the column originally. '' is not one of the three real answers and
-- was never meant as a fourth one; normalising it to null before the
-- constraint lands is the same rule record_pay_info() applies to every write
-- from here on, just run once against what is already there.
update public.jobs set pay_method = null where pay_method = '';
update public.jobs set pay_ref    = null where pay_ref    = '';

alter table public.jobs drop constraint if exists jobs_pay_method_chk;
alter table public.jobs add constraint jobs_pay_method_chk
  check (pay_method is null or pay_method in ('bank_transfer','lynk','remittance'));

comment on column public.jobs.pay_method is
  'How the worker was paid for this job, off-platform: bank_transfer | lynk | remittance, matching the three options in the FAQ. Set by the worker themselves through record_pay_info(). Null until they record it.';
comment on column public.jobs.pay_ref is
  'The worker''s own reference for that payment: a bank confirmation number, a Lynk transaction id, a remittance slip number. Free text, their record, not verified by Yaadly.';

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

  if v_method is not null and v_method not in ('bank_transfer','lynk','remittance') then
    raise exception 'Choose bank transfer, Lynk wallet or remittance pick up.' using errcode = 'check_violation';
  end if;

  update public.jobs
     set pay_method = v_method,
         pay_ref    = nullif(btrim(coalesce(p_ref, '')), '')
   where id = p_job
     and lower(coalesce(worker_email, '')) = v_email;

  if not found then
    -- Identical wording whether the job does not exist or belongs to
    -- somebody else: a stranger probing job ids learns nothing either way,
    -- same reasoning as approve_stage's own refusal.
    raise exception 'That is not your job.' using errcode = '28000';
  end if;
end;
$$;

revoke all on function public.record_pay_info(text, text, text) from public, anon, authenticated;
grant execute on function public.record_pay_info(text, text, text) to authenticated;
