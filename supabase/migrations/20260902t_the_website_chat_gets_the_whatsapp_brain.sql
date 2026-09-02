-- The website chat, 2 Sep 2026. Founder's ask: a chat on yaadly.co.uk that
-- answers questions right there and connects to her when it matters. Her
-- follow-up, same message: "just use the whatsapp for now", so the reply
-- lane stays where it already is. The widget on the site talks to the same
-- function, prompt, handoff rules and banned-language screen as the WhatsApp
-- thread (yaad-inbound, channel 'web'); when the assistant would hand over,
-- the visitor is pointed at WhatsApp with their reference and Monique picks
-- it up from the desk exactly as she does today.
--
-- No new conversation table. A web thread is an intake_threads row with
-- channel 'web' and a random visitor token where the phone number would be,
-- so it lands in the desk's Conversations view beside everything else, and a
-- draft job sits behind it the way a WhatsApp greeting's does. The only new
-- table is this throttle for the public door, the same shape as
-- enquiry_attempts and booking_attempts: hashed keys, no personal data,
-- swept by the function itself. It is load bearing rather than housekeeping,
-- because every message through this door is a model call somebody pays for.

create table if not exists public.web_chat_attempts (
  id          bigint generated always as identity primary key,
  caller_key  text        not null,
  visitor_key text        not null,
  created_at  timestamptz not null default now()
);

create index if not exists web_chat_attempts_caller_idx
  on public.web_chat_attempts (caller_key, created_at desc);
create index if not exists web_chat_attempts_visitor_idx
  on public.web_chat_attempts (visitor_key, created_at desc);
create index if not exists web_chat_attempts_created_idx
  on public.web_chat_attempts (created_at desc);

-- RLS on with no policy behind it, deliberately. Only the service role
-- writes and counts, nobody reads.
alter table public.web_chat_attempts enable row level security;

create or replace function public.web_chat_attempts_sweep()
returns void language sql security definer set search_path to 'public' as $$
  delete from public.web_chat_attempts where created_at < now() - interval '2 hours';
$$;
-- A fresh function is granted EXECUTE to PUBLIC, and anon inherits PUBLIC, so
-- revoking from anon alone does nothing. Revoke from PUBLIC first, then grant
-- back to the one role that needs it. Learned on post_job_attempts_sweep.
revoke execute on function public.web_chat_attempts_sweep() from public, anon, authenticated;
grant execute on function public.web_chat_attempts_sweep() to service_role;

comment on table public.web_chat_attempts is
  'Throttle for the website chat door on yaad-inbound. Hashed caller and visitor keys only; swept after two hours.';
