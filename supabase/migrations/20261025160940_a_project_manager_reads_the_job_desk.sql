-- A Project Manager reads the job desk.
--
-- Founder, 20 October 2026: build the Project Manager's buttons in three
-- changes, "starting with desk access". This is the first of the three. It
-- lets somebody granted project_manager on the access register
-- (20261020120000) open the desk and READ what they need to run jobs. It
-- gives them no button: every desk action is still a function that checks
-- is_admin(), so a PM who clicks one is refused by the database. Approvals
-- come in the second change, money up to the limit in the third.
--
-- WHAT A PM READS. Jobs and everything hanging off a job: quotes, shortlists,
-- evidence, stage approvals, Kickoff Packs, quote packs, add-ons, reports,
-- completion reports, sketch packs, job files and photos, visits, invoices,
-- payments, materials releases, suppliers, services, worker and client
-- profiles, conversations and message delivery. Read only, every one.
--
-- WHAT A PM NEVER READS. Founder rule, 20 October 2026: only the Super Admin
-- sees identity documents. So no policy here touches vetting_documents,
-- vetting_reviews, applications, worker_checks, the vetting or signatures
-- storage buckets, the admins list or anybody else's row on the access
-- register. Nor the sales inbox (enquiries, waitlist, calls, feedback,
-- questions), which is not job running. Nor any setting that is a secret:
-- the cron and trigger secret hashes and the ntfy topic, which is a password
-- to the desk's push alerts in all but name.
--
-- WORKER PAYOUT FIELDS. worker_profiles carries Stripe and Wise recipient
-- ids and a MoneyGram pick-up name. Those are references to accounts held by
-- the payment provider, not bank details; no account number is stored in
-- this database (see the 1 October rule). A PM paying workers in the third
-- change needs to see how each worker is paid, so the row is readable whole.
--
-- THE LIMIT IS IN JAMAICAN DOLLARS. Every worker payment and materials
-- payment is in J$, and nothing in the database converts currencies, so the
-- founder set the PM limit at J$100,000 per payment the same day, matching
-- the J$100,000 line card payments already use. The GBP 500 key written by
-- the register an hour earlier is replaced.

begin;

create or replace function public.is_pm()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.has_access('project_manager');
$$;
revoke all on function public.is_pm() from public, anon;
grant execute on function public.is_pm() to authenticated, service_role;

-- What the desk should open as, asked once at boot. super_admin wins if a
-- person somehow holds both.
create or replace function public.desk_role()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when public.is_admin() then 'super_admin'
    when public.is_pm()    then 'project_manager'
    else null
  end;
$$;
revoke all on function public.desk_role() from public, anon;
grant execute on function public.desk_role() to authenticated, service_role;

delete from public.app_settings where key = 'pm_release_limit_pence';
insert into public.app_settings (key, value)
values ('pm_release_limit_jmd', '100000')
on conflict (key) do update set value = excluded.value;

do $$
declare
  t text;
  tables text[] := array[
    'jobs', 'job_quotes', 'job_shortlists', 'job_files', 'job_photos',
    'job_addons', 'job_addon_agreements', 'job_addon_evidence',
    'job_stall_state', 'job_stall_resolved',
    'evidence', 'evidence_comments', 'evidence_corrections', 'stage_approvals',
    'work_log_pins', 'visits',
    'kickoff_packs', 'kickoff_drafts', 'kickoff_pack_agreements',
    'quote_pack_drafts', 'quote_agreements', 'quote_change_requests',
    'quote_materials', 'quote_reviews', 'scope_agreements', 'sketch_packs',
    'reports', 'report_findings', 'report_edits', 'report_draft_links',
    'completion_reports', 'completion_report_events',
    'invoices', 'invoice_lines', 'invoice_payments', 'stripe_payouts',
    'materials_releases', 'suppliers', 'services',
    'worker_profiles', 'worker_availability', 'client_profiles',
    'intake_threads', 'messages', 'message_deliveries', 'pending_desk_replies',
    'portal_contacts', 'agent_actions', 'disputes'
  ];
begin
  -- worker_stall_history (the Stalled jobs view) is a security_invoker view
  -- over job_stall_state and jobs, so the two policies below already cover it.
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      raise notice 'skipped %, no such table', t;
      continue;
    end if;
    execute format('drop policy if exists pm_read on public.%I', t);
    execute format(
      'create policy pm_read on public.%I for select to authenticated using (public.is_pm())', t);
  end loop;
end $$;

drop policy if exists pm_read on public.app_settings;
create policy pm_read on public.app_settings
  for select to authenticated
  using (public.is_pm() and key not ilike '%secret%' and key <> 'ntfy_topic');

drop policy if exists "pm reads job buckets" on storage.objects;
create policy "pm reads job buckets" on storage.objects
  for select to authenticated
  using (bucket_id in ('evidence', 'intake', 'job-files') and public.is_pm());

commit;
