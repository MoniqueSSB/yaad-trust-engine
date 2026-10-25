-- Continue on another device, 25 October 2026.
--
-- The worker apply page keeps the application (its id and upload token) in
-- the browser that started it. From any other browser there was no way back:
-- the reference APP-XXXXXX was shown but nothing accepted it, and the only
-- thing that ever carried the link was the day three check reminder. Monique
-- hit this herself on 25 Oct 2026 with her own test application after signing
-- out in another browser.
--
-- The fix is a box on /apply that takes the reference and sends the link to
-- the phone and the email ALREADY on the application, through yaad-apply-link.
-- The token is never shown on screen and never goes anywhere the applicant
-- did not give. The browser is told the same sentence whether or not the
-- reference exists, so the box cannot be used to find out which references
-- are real.
--
-- What this migration adds is only the throttle behind that box. Same shape
-- as enquiry_attempts (20260829n): a hashed caller key, never an IP, plus the
-- reference that was tried, swept within hours. The reference is a label the
-- applicant was handed, not personal data, and nothing joins to it.

create table if not exists public.apply_link_attempts (
  id         bigserial primary key,
  caller_key text        not null,
  ref_key    text        not null,
  created_at timestamptz not null default now()
);

create index if not exists apply_link_attempts_caller_idx
  on public.apply_link_attempts (caller_key, created_at desc);
create index if not exists apply_link_attempts_ref_idx
  on public.apply_link_attempts (ref_key, created_at desc);

-- RLS on with no policy behind it, deliberately. Only the service role writes
-- and reads here, and it bypasses RLS. Nobody signed in, admin included, reads
-- a throttle table through the API, because there is nothing in it worth
-- reading.
alter table public.apply_link_attempts enable row level security;

create or replace function public.apply_link_attempts_sweep()
returns void language sql security definer set search_path to 'public' as $$
  delete from public.apply_link_attempts where created_at < now() - interval '2 hours';
$$;
-- A fresh function is granted EXECUTE to PUBLIC, and anon inherits PUBLIC, so
-- revoking from anon alone does nothing. Revoke from PUBLIC first, then grant
-- back to the one role that needs it (learned on post_job_attempts_sweep).
revoke execute on function public.apply_link_attempts_sweep() from public, anon, authenticated;
grant execute on function public.apply_link_attempts_sweep() to service_role;

comment on table public.apply_link_attempts is
  'Throttle for yaad-apply-link (Continue on another device): at most 3 requests per reference per hour and per caller per hour. Hashed caller key, swept after 2 hours. Not a visitor log.';
