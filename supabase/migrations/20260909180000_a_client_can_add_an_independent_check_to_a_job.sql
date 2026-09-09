-- A client can add an independent check to a marketplace job.
--
-- The 30 July 2026 sign-off modes (BridgeWorks_Ideas_Ledger, Mode A) say a
-- client abroad approves from the evidence, with an OPTIONAL paid check on
-- top. specs/PORTALS-BUILD-SPEC.md section 5.11 draws the picker. Until now
-- nothing in the database could hold the choice: jobs.signoff_method is the
-- free video walkthrough, stage_approvals.confirmed_method is how the client
-- confirmed. Neither says whether somebody independent attended.
--
-- PRICING. Monique, 9 and 10 September 2026: these are the SAME checks as
-- the Visual Check and Technical Sign-off on the services page, offered at
-- a lower price to a client who has already bought a job from Yaadly. Not
-- a different product, a returning-client price. They get their own
-- catalogue rows because the price differs from the standalone rows
-- ('eyes-on-it', 'technical-signoff') and the catalogue trigger prices a
-- line from exactly one row. Seeds: visual £45 full, £25 founding (the
-- blueprint's looker rung); technical £149 full, £100 founding (hers, in
-- place of the blueprint's £50 and £45). Both are hers to confirm before
-- this file is applied. They live in service_catalogue so changing them is
-- an UPDATE, never a deploy.
--
-- MONEY. The check is billed as its own one-line GBP invoice, priced by the
-- catalogue trigger (catalogue_full or catalogue_founding, never a typed
-- number), raised by a signed-in admin from the desk. The invoice carries
-- NO job_id on purpose. Three live functions identify "the job's client
-- invoice" as the stage-less invoice payable to Yaadly on that job_id:
-- raise_job_client_invoice() refuses a second one, sync_job_status() reads
-- its paid state as the agency fee, and start_job_on_agency_fee_paid()
-- starts the job when it is paid. A check invoice with a job_id would be
-- mistaken for all three. So the link runs the other way: jobs.check_invoice_id
-- points at the invoice, and the invoice's period_label names the job.
--
-- THE LOCK. The choice can be made or changed while the job has a worker and
-- nobody has filed evidence on the final stage. Once final evidence is in,
-- the picker locks: "Visits not agreed at the start are chargeable" is the
-- spec's standing warning, and a late request goes to a person over WhatsApp
-- rather than silently onto the bill. The desk can still set it.
--
-- THE MIRROR. The checker must be independent of the worker. That was the
-- 23 July rule in words; assign_job_checker() makes it a refusal.
--
-- WHAT THIS DOES NOT DO. A check is a record, not a ruling. Nothing here is
-- read by approve_stage(), _do_approve_stage() or sync_job_status(). Choosing
-- a check changes who attends, never who approves, and the client's Approve
-- button is exactly where it was.

-- --------------------------------------------------------------- catalogue

insert into public.service_catalogue (id, name, blurb, founding_pence, full_pence, recurring, unit_label, sort) values
  ('job-visual-check',    'Visual Check, on a job you booked with us',
   'The same Visual Check as on the services page, at a lower price because you already have a job with Yaadly. Somebody independent of the worker attends the finished stage, confirms it is visibly done and basically works, and files timestamped photos. They record. They do not rate, advise or certify.',
   2500, 4500, false, 'visit', 12),
  ('job-technical-check', 'Technical Sign-off, on a job you booked with us',
   'The same Technical Sign-off as on the services page, at a lower price because you already have a job with Yaadly. A qualified trade inspector reviews the stage against the agreed scope and the trade standard, and signs it off or lists what to put right. Pre-booked at scope agreed.',
   10000, 14900, false, 'stage', 13)
on conflict (id) do nothing;

-- ------------------------------------------------------------- jobs columns

alter table public.jobs
  add column if not exists check_level       text,
  add column if not exists check_chosen_at   timestamptz,
  add column if not exists check_chosen_by   text,
  add column if not exists check_invoice_id  text references public.invoices(id) on delete set null,
  add column if not exists check_assigned_to text,
  add column if not exists check_assigned_at timestamptz,
  add column if not exists check_assigned_by text;

alter table public.jobs drop constraint if exists jobs_check_level_chk;
alter table public.jobs add constraint jobs_check_level_chk
  check (check_level is null or check_level in ('visual', 'technical'));

comment on column public.jobs.check_level is
  'null | visual | technical. The independent check the client chose for sign-off, if any. visual = job-visual-check, technical = job-technical-check in service_catalogue. Informational to the money path: approve_stage() never reads it.';
comment on column public.jobs.check_chosen_at is
  'When the client chose the check, through choose_job_check(). Reset by clear_job_check().';
comment on column public.jobs.check_chosen_by is
  'The email of the person who chose it: the client, or an admin setting it on their behalf after the picker locked.';
comment on column public.jobs.check_invoice_id is
  'The one-line GBP invoice for the check, raised by raise_job_check_invoice(). Deliberately the only link between the two: the invoice carries no job_id, see the header of 20260909180000.';
comment on column public.jobs.check_assigned_to is
  'Who is attending, in the desk''s own words. Never the worker on the job: assign_job_checker() refuses that.';

-- -------------------------------------------------------- reading the job

-- How many payment stages this job has, the same way the screen and
-- sync_job_status() read it: an approved Kickoff Pack first, else an approved
-- Quote Pack draft, else one.
create or replace function public.job_final_stage_count(p_job text)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select jsonb_array_length(p.docs->'payment_schedule'->'stages')
       from public.kickoff_packs p
      where p.job_id = p_job and p.status = 'approved'
      order by p.updated_at desc limit 1),
    (select jsonb_array_length(d.docs->'payment_stages')
       from public.quote_pack_drafts d
      where d.job_id = p_job and d.status = 'approved'
      limit 1),
    1);
$$;

-- True once the choice can no longer be made from the portal: evidence has
-- been filed on the final stage, or the job is finished or cancelled.
create or replace function public.job_check_locked(p_job text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.jobs j
     where j.id = p_job
       and (
         j.status in ('complete', 'cancelled')
         or exists (
           select 1 from public.evidence e
            where e.job_id = j.id
              and coalesce(e.stage, 1) >= public.job_final_stage_count(j.id)
         )
       )
  );
$$;

revoke all on function public.job_final_stage_count(text) from public, anon, authenticated;
grant execute on function public.job_final_stage_count(text) to authenticated;
revoke all on function public.job_check_locked(text) from public, anon, authenticated;
grant execute on function public.job_check_locked(text) to authenticated;

-- ------------------------------------------------------ the client's choice

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

create or replace function public.clear_job_check(p_job text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
  v_job   jobs%rowtype;
  v_inv   invoices%rowtype;
begin
  v_email := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
  if v_email is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  select * into v_job from public.jobs where id = p_job;
  if not found then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;
  if lower(coalesce(v_job.client_email, '')) <> v_email and not public.is_admin() then
    raise exception 'That is not your job.' using errcode = '28000';
  end if;

  if v_job.check_invoice_id is not null then
    select * into v_inv from public.invoices where id = v_job.check_invoice_id;
    if found and v_inv.status <> 'void' then
      raise exception 'This check has already been invoiced. Message us to cancel it.'
        using errcode = 'check_violation';
    end if;
  end if;

  if v_job.check_assigned_to is not null and not public.is_admin() then
    raise exception 'A checker has already been booked for this. Message us to cancel it.'
      using errcode = 'check_violation';
  end if;

  if public.job_check_locked(p_job) and not public.is_admin() then
    raise exception 'Evidence for the final stage is already in. Message us if you need to change this.'
      using errcode = 'check_violation';
  end if;

  update public.jobs
     set check_level       = null,
         check_chosen_at   = null,
         check_chosen_by   = null,
         check_invoice_id  = null,
         check_assigned_to = null,
         check_assigned_at = null,
         check_assigned_by = null,
         updated_at        = now()
   where id = p_job;
end;
$$;

revoke all on function public.choose_job_check(text, text) from public, anon, authenticated;
grant execute on function public.choose_job_check(text, text) to authenticated;
revoke all on function public.clear_job_check(text) from public, anon, authenticated;
grant execute on function public.clear_job_check(text) to authenticated;

-- ---------------------------------------------------------- the desk's side

-- One line, catalogue priced. p_source is 'catalogue_full' or
-- 'catalogue_founding'; the founding rate is a person's call on the desk,
-- the same way it is for every other catalogue line.
create or replace function public.raise_job_check_invoice(p_job text, p_source text default 'catalogue_full')
returns table(invoice_id text, total_pence integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_job    jobs%rowtype;
  v_inv    invoices%rowtype;
  v_cat    service_catalogue%rowtype;
  v_id     text;
  v_source text := coalesce(nullif(btrim(p_source), ''), 'catalogue_full');
  v_total  integer;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  if v_source not in ('catalogue_full', 'catalogue_founding') then
    raise exception 'Price it at the full rate or the founding rate, from the catalogue.'
      using errcode = 'check_violation';
  end if;

  select * into v_job from public.jobs where id = p_job;
  if not found then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;
  if v_job.check_level is null then
    raise exception 'No check has been chosen on this job.' using errcode = 'check_violation';
  end if;
  if coalesce(v_job.client_email, '') = '' then
    raise exception 'This job has no client email on file to invoice.' using errcode = 'check_violation';
  end if;

  if v_job.check_invoice_id is not null then
    select * into v_inv from public.invoices where id = v_job.check_invoice_id;
    if found and v_inv.status <> 'void' then
      raise exception 'The check on this job has already been invoiced (%).', v_inv.id
        using errcode = 'check_violation';
    end if;
  end if;

  select * into v_cat from public.service_catalogue
   where id = case v_job.check_level when 'visual' then 'job-visual-check' else 'job-technical-check' end
     and active;
  if not found then
    raise exception 'The catalogue row for this check is missing or inactive.' using errcode = 'check_violation';
  end if;

  v_id := public.new_invoice_number();
  -- job_id stays null on purpose. See the header: a stage-less invoice
  -- payable to Yaadly on this job_id IS the agency fee to three live
  -- functions. The job points at this invoice instead.
  insert into public.invoices (id, client_name, client_email, job_id, drafted_by, currency, period_label, payable_to, notes)
  values (v_id, coalesce(v_job.client_name, v_job.client_email), v_job.client_email, null, 'human', 'GBP',
          'Independent check, ' || v_job.id, 'yaadly',
          v_cat.name || ' on ' || coalesce(v_job.title, v_job.id) || '. Chosen by the client at scope agreed. '
          || 'Somebody independent of the tradesperson attends the finished stage and files what they saw. '
          || 'This is a record for your sign-off, not a ruling on the work, and it does not move any payment on its own: you still approve each stage yourself.');

  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_id, v_cat.id, v_cat.name || ', ' || v_job.id, 1, 0, v_source);

  update public.jobs
     set check_invoice_id = v_id, updated_at = now()
   where id = p_job;

  select i.total_pence into v_total from public.invoices i where i.id = v_id;
  return query select v_id, v_total;
end;
$$;

create or replace function public.assign_job_checker(p_job text, p_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
  v_job   jobs%rowtype;
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  v_email := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
  if v_name is null then
    raise exception 'Name who is attending.' using errcode = 'check_violation';
  end if;

  select * into v_job from public.jobs where id = p_job;
  if not found then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;
  if v_job.check_level is null then
    raise exception 'No check has been chosen on this job.' using errcode = 'check_violation';
  end if;

  -- The Mirror Rule, enforced: the checker is never the worker. Compared on
  -- name and on email, both lower-cased, so a typed variant does not slip by.
  if lower(v_name) in (lower(coalesce(v_job.worker_name, '')), lower(coalesce(v_job.worker_email, ''))) then
    raise exception 'The checker must be independent of the worker on the job.'
      using errcode = 'check_violation';
  end if;

  update public.jobs
     set check_assigned_to = v_name,
         check_assigned_at = now(),
         check_assigned_by = v_email,
         updated_at        = now()
   where id = p_job;
end;
$$;

revoke all on function public.raise_job_check_invoice(text, text) from public, anon, authenticated;
grant execute on function public.raise_job_check_invoice(text, text) to authenticated;
revoke all on function public.assign_job_checker(text, text) from public, anon, authenticated;
grant execute on function public.assign_job_checker(text, text) to authenticated;

-- --------------------------------------------------------------- the desk

-- Every job with a check chosen, with the bill and the report beside it.
-- security_invoker so RLS on jobs decides who sees what: the desk (admin)
-- sees all of them, a signed-in client would only ever see their own.
create or replace view public.v_job_checks
with (security_invoker = true) as
  select j.id, j.title, j.parish, j.status, j.stage,
         j.client_name, j.client_email, j.worker_name,
         j.check_level, j.check_chosen_at, j.check_chosen_by,
         j.check_assigned_to, j.check_assigned_at,
         public.job_final_stage_count(j.id) as final_stage,
         public.job_check_locked(j.id)      as locked,
         i.id           as invoice_id,
         i.status       as invoice_status,
         i.total_pence  as invoice_total_pence,
         r.number       as report_number,
         r.status       as report_status
    from public.jobs j
    left join public.invoices i on i.id = j.check_invoice_id
    left join lateral (
      select rp.number, rp.status
        from public.reports rp
       where rp.job_id = j.id
         and rp.kind = case j.check_level when 'visual' then 'visual_check' else 'technical_signoff' end
       order by rp.drafted_at desc
       limit 1
    ) r on true
   where j.check_level is not null;

grant select on public.v_job_checks to authenticated;
