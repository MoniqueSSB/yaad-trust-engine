-- An enquiry arrived and nothing told the person it had.
--
-- The contact form thanked them on screen and that was the whole of it. Close
-- the tab and there was no trace: nothing in their inbox, nothing to reply to,
-- nothing to show they had ever written. Somebody who has just described a
-- problem with a house 4,000 miles away and hears nothing back for a day has
-- no way to tell "she is asleep in London" from "that form is broken", and the
-- second reading is the one people default to on a business they do not know
-- yet. So the form now sends a receipt, and this is what the receipt needs.
--
-- Two things get added.
--
-- 1. Somewhere to record that the receipt went, so the desk shows whether the
--    person has heard anything at all. Without it, an enquiry that failed to
--    send looks exactly like one that succeeded, and the one person who could
--    fix it cannot see the difference.
--
-- 2. A throttle. The old form wrote straight to the table with the publishable
--    key and had no limit, which was survivable while the worst case was junk
--    rows. It is not survivable now: an endpoint that sends mail to an address
--    the caller chooses is an open relay pointed at whoever they name. The
--    per-recipient cap is the one that matters. The per-caller cap only slows
--    down somebody who can rotate addresses anyway.

-- 1 · did they hear from us ------------------------------------------------
alter table public.enquiries
  add column if not exists receipt    text,
  add column if not exists receipt_at timestamptz;

-- no_email is not a failure. It is the honest state for somebody who gave a
-- WhatsApp number instead, which the form has always allowed and should keep
-- allowing: half this audience would rather be reached there.
alter table public.enquiries
  drop constraint if exists enquiries_receipt_state;
alter table public.enquiries
  add constraint enquiries_receipt_state
  check (receipt is null or receipt in ('sent', 'failed', 'no_email', 'throttled'));

comment on column public.enquiries.receipt is
  'Whether an acknowledgement reached the person: sent, failed, throttled, or no_email when they gave a phone number rather than an address.';

-- 2 · the throttle ---------------------------------------------------------
-- Same shape and same reasoning as post_job_attempts: the caller is a hash of
-- the address, truncated, never the address itself. It is a throttle key, not
-- a visitor log. It cannot be read back as an IP, nothing joins to it, and the
-- rows are swept within hours. A rate limit must not quietly become the one
-- place this business keeps personal data nobody asked it to keep.
create table if not exists public.enquiry_attempts (
  id         bigserial primary key,
  caller_key text        not null,
  emailed    boolean     not null default false,
  created_at timestamptz not null default now()
);

create index if not exists enquiry_attempts_caller_idx
  on public.enquiry_attempts (caller_key, created_at desc);
create index if not exists enquiry_attempts_emailed_idx
  on public.enquiry_attempts (created_at desc) where emailed;

-- RLS on with no policy behind it, deliberately. Only the service role writes
-- here and it bypasses RLS. Fail closed: nobody signed in, admin included,
-- reads a throttle table through the API, because there is nothing in it worth
-- reading.
alter table public.enquiry_attempts enable row level security;

create or replace function public.enquiry_attempts_sweep()
returns void language sql security definer set search_path to 'public' as $$
  delete from public.enquiry_attempts where created_at < now() - interval '2 hours';
$$;
-- A fresh function is granted EXECUTE to PUBLIC, and anon inherits PUBLIC, so
-- revoking from anon alone does nothing. Revoke from PUBLIC first, then grant
-- back to the one role that needs it. Learned on post_job_attempts_sweep.
revoke execute on function public.enquiry_attempts_sweep() from public, anon, authenticated;
grant execute on function public.enquiry_attempts_sweep() to service_role;

-- 3 · shut the old door ----------------------------------------------------
-- The form used to insert here directly on the publishable key. It now posts
-- to yaad-enquiry, which writes with the service role and sends the receipt.
-- Leaving the anon insert policy up would leave a second way in that writes a
-- row nobody is ever told about and no throttle counts.
drop policy if exists "public sends an enquiry" on public.enquiries;
revoke insert on public.enquiries from anon;
