-- The Technical Sign-off is coming soon, and a client cannot book it yet.
--
-- Founder's instruction, 13 September 2026: "the visual check should be the
-- only check added now, the technical check should be on coming soon and not
-- being able to client". The portal now shows the Technical Sign-off card as
-- coming soon with no button (web/components/portal/JobCheckPanel.tsx,
-- OFFERED_LEVELS in web/lib/portal/job-check.ts). Hiding a button is not a
-- gate, because a client can call this function through the API without the
-- page, so the refusal lives here too.
--
-- The only change to choose_job_check() from 20260909180000 is the new
-- refusal after the level check. Everything else is copied unchanged. An
-- admin can still set a Technical Sign-off from the desk, and a job that
-- already has one keeps it: nothing here touches a stored row. The
-- job-technical-check catalogue row stays active so the desk can still
-- invoice one it set.
--
-- To offer it again: drop the refusal in a new migration and put 'technical'
-- back in OFFERED_LEVELS, in the same change.

create or replace function public.choose_job_check(p_job text, p_level text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
  v_job   jobs%rowtype;
  v_level text := nullif(btrim(lower(coalesce(p_level, ''))), '');
  v_inv   invoices%rowtype;
begin
  v_email := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
  if v_email is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  if v_level is null or v_level not in ('visual', 'technical') then
    raise exception 'Choose a Visual Check or a Technical Sign-off.'
      using errcode = 'check_violation';
  end if;

  -- Coming soon. Founder, 13 Sep 2026. The desk can still set it.
  if v_level = 'technical' and not public.is_admin() then
    raise exception 'The Technical Sign-off is coming soon and cannot be booked yet. The Visual Check is available now.'
      using errcode = 'check_violation';
  end if;

  select * into v_job from public.jobs where id = p_job;
  if not found then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;

  -- The client, or an admin acting for them after the picker locked.
  if lower(coalesce(v_job.client_email, '')) <> v_email and not public.is_admin() then
    raise exception 'That is not your job.' using errcode = '28000';
  end if;

  -- No scope, no check. The picker is offered at Scope agreed, which is the
  -- moment a worker is on the job.
  if coalesce(v_job.worker_email, '') = '' then
    raise exception 'A check is chosen once a worker is on the job and the scope is agreed.'
      using errcode = 'check_violation';
  end if;

  if public.job_check_locked(p_job) and not public.is_admin() then
    raise exception 'Evidence for the final stage is already in, so this cannot be added from here. Visits not agreed at the start are chargeable: message us on WhatsApp and a person will arrange it.'
      using errcode = 'check_violation';
  end if;

  -- Changing the level after the bill went out is a new bill, which is a
  -- person's decision on the desk, not a portal click.
  if v_job.check_invoice_id is not null then
    select * into v_inv from public.invoices where id = v_job.check_invoice_id;
    if found and v_inv.status <> 'void' and v_job.check_level is distinct from v_level then
      raise exception 'This check has already been invoiced. Message us to change it.'
        using errcode = 'check_violation';
    end if;
  end if;

  update public.jobs
     set check_level     = v_level,
         check_chosen_at = coalesce(check_chosen_at, now()),
         check_chosen_by = v_email,
         updated_at      = now()
   where id = p_job;
end;
$$;

revoke all on function public.choose_job_check(text, text) from public, anon, authenticated;
grant execute on function public.choose_job_check(text, text) to authenticated;
