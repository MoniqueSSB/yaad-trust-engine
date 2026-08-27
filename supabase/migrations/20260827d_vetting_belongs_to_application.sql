-- A tradesperson uploads their passport before they have an account, not
-- after. yaad-portal-signup only opens a worker account once an ACTIVE
-- worker_profile exists, and a profile only exists once vetting has passed,
-- so requiring worker_user at upload time was a loop with no entry.

alter table public.vetting_documents alter column worker_user drop not null;

alter table public.vetting_documents
  add column if not exists application_id uuid references public.applications(id) on delete cascade;

alter table public.vetting_documents drop constraint if exists vetting_documents_has_a_subject;
alter table public.vetting_documents
  add constraint vetting_documents_has_a_subject
  check (application_id is not null or worker_user is not null);

create index if not exists vetting_documents_application_idx
  on public.vetting_documents (application_id);

comment on column public.vetting_documents.application_id is
  'Set while the person is still an applicant. worker_user is filled in once vetting passes and an account exists.';

-- Applications need a claim secret so an anonymous browser can prove it owns
-- the application it is uploading against. The id alone is not enough: it
-- travels in URLs and logs, and possession of an id must not be possession of
-- the right to attach a passport to it.
alter table public.applications
  add column if not exists upload_token uuid not null default gen_random_uuid();

comment on column public.applications.upload_token is
  'Returned once, to the browser that created the application. Required to attach a vetting document.';

alter table public.applications enable row level security;
drop policy if exists "applications are admin only" on public.applications;
create policy "applications are admin only"
  on public.applications for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
