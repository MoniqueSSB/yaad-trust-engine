-- A client can reach Yaadly from the portal, and a dispute reaches everybody
-- it is about. Founder, 13 September 2026: "make this work in the client
-- portal and there should be a way they can contact yaadly directly if they
-- have a problem and it comes directly to my whatsapp and email."
--
-- What was wrong before this:
--
--   1. A dispute told nobody but the person who raised it. The client got a
--      receipt saying it was "with a person, not a queue", while no person
--      was told: not the worker, whose panel promises "you hear it first",
--      and not Monique. Escalating told nobody either.
--   2. The portal's only "contact Yaadly" was a wa.me link to the Yaadly
--      number, where the intake assistant answers. A client with a problem
--      on a live job got the assistant, not her.
--
-- What this adds:
--
--   portal_contacts  one row per message a signed-in party sends to Yaadly
--                    from a job page. The sender must be that job's client or
--                    that job's worker, checked here, not in the page. Five
--                    an hour per sender, also checked here, because each row
--                    sends her a WhatsApp and possibly a paid SMS.
--   three triggers   each calls yaad-notify-client with the shared trigger
--                    secret (public.notify_trigger_secret(), 20260905a's
--                    pattern), never with message text: the function reads
--                    the row itself.
--
-- None of this approves, releases, rules or scores anything. It tells people.

begin;

create table if not exists public.portal_contacts (
  id           uuid primary key default gen_random_uuid(),
  job_id       text not null references public.jobs(id),
  sender_email text not null,
  sender_role  text not null check (sender_role in ('client', 'worker')),
  body         text not null check (char_length(body) between 5 and 2000),
  created_at   timestamptz not null default now(),
  -- For the desk to mark a message answered. Nothing sets these yet; they
  -- exist so a future "answered" button does not need a migration.
  handled_at   timestamptz,
  handled_by   text
);

create index if not exists portal_contacts_job_idx
  on public.portal_contacts (job_id, created_at desc);
create index if not exists portal_contacts_sender_idx
  on public.portal_contacts (lower(sender_email), created_at desc);

alter table public.portal_contacts enable row level security;

revoke all on public.portal_contacts from anon;
revoke all on public.portal_contacts from authenticated;
grant select, insert on public.portal_contacts to authenticated;

drop policy if exists portal_contacts_admin_all on public.portal_contacts;
create policy portal_contacts_admin_all on public.portal_contacts
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists portal_contacts_sender_reads_own on public.portal_contacts;
create policy portal_contacts_sender_reads_own on public.portal_contacts
  for select to authenticated
  using (lower(sender_email) = lower(auth.jwt() ->> 'email'));

-- The sender is who their token says, the role is the side of THIS job their
-- email is on, and the desk's own columns start empty. The count reads
-- through the policy above, so it counts exactly this sender's own rows.
drop policy if exists portal_contacts_party_sends on public.portal_contacts;
create policy portal_contacts_party_sends on public.portal_contacts
  for insert to authenticated
  with check (
    lower(sender_email) = lower(auth.jwt() ->> 'email')
    and handled_at is null
    and handled_by is null
    and exists (
      select 1 from public.jobs j
      where j.id = portal_contacts.job_id
        and (
          (sender_role = 'client' and lower(coalesce(j.client_email, '')) = lower(auth.jwt() ->> 'email'))
          or (sender_role = 'worker' and lower(coalesce(j.worker_email, '')) = lower(auth.jwt() ->> 'email'))
        )
    )
    and (
      select count(*) from public.portal_contacts c
      where lower(c.sender_email) = lower(auth.jwt() ->> 'email')
        and c.created_at > now() - interval '1 hour'
    ) < 5
  );

comment on table public.portal_contacts is
  'Messages a job''s client or worker sends to Yaadly from the portal. Each insert alerts Monique by WhatsApp, email and push through yaad-notify-client (kind desk_alert). 20260913130000.';

-- ── a message to Yaadly ──────────────────────────────────────────────────
create or replace function public.notify_desk_portal_contact()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform net.http_post(
    url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
    body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id,
      'kind', 'desk_alert', 'meta', jsonb_build_object('event', 'contact', 'id', new.id)),
    headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
    timeout_milliseconds := 15000
  );
  return new;
end;
$$;

revoke all on function public.notify_desk_portal_contact() from public, anon, authenticated;

drop trigger if exists trg_notify_desk_portal_contact on public.portal_contacts;
create trigger trg_notify_desk_portal_contact
  after insert on public.portal_contacts
  for each row execute function public.notify_desk_portal_contact();

-- ── a dispute raised: the worker and Monique ─────────────────────────────
-- The client's own receipt stays on trg_notify_dispute_raised (20260831i),
-- untouched. This is the other two people.
create or replace function public.notify_dispute_raised_to_worker_and_desk()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform net.http_post(
    url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
    body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id,
      'kind', 'dispute_raised_worker', 'meta', jsonb_build_object('id', new.id)),
    headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
    timeout_milliseconds := 15000
  );
  perform net.http_post(
    url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
    body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id,
      'kind', 'desk_alert', 'meta', jsonb_build_object('event', 'dispute_raised', 'id', new.id)),
    headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
    timeout_milliseconds := 15000
  );
  return new;
end;
$$;

revoke all on function public.notify_dispute_raised_to_worker_and_desk() from public, anon, authenticated;

drop trigger if exists trg_notify_dispute_raised_worker_desk on public.disputes;
create trigger trg_notify_dispute_raised_worker_desk
  after insert on public.disputes
  for each row execute function public.notify_dispute_raised_to_worker_and_desk();

-- ── a dispute escalated: Monique ─────────────────────────────────────────
-- Only on the move INTO escalated, so a later edit to an escalated row does
-- not alert her twice.
create or replace function public.notify_desk_dispute_escalated()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.state = 'escalated' and old.state is distinct from 'escalated' then
    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id,
        'kind', 'desk_alert', 'meta', jsonb_build_object('event', 'dispute_escalated', 'id', new.id)),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
end;
$$;

revoke all on function public.notify_desk_dispute_escalated() from public, anon, authenticated;

drop trigger if exists trg_notify_desk_dispute_escalated on public.disputes;
create trigger trg_notify_desk_dispute_escalated
  after update on public.disputes
  for each row execute function public.notify_desk_dispute_escalated();

commit;
