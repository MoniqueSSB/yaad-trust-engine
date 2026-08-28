-- yaad-post-job calls MiniMax on every new draft, and the only credential it
-- needs is the publishable key printed in the page source of yaadly.co.uk.
-- No rate limit, no captcha, no cap. One loop drains the model balance and
-- fills the jobs table, the marketplace board and the concierge with rubbish.
--
-- Two counters, because they stop two different things.
--
--   per caller   stops one person flooding the jobs table
--   global       stops the model bill running away, whoever is behind it
--
-- The caller is recorded as a SHA-256 of the address, truncated, and never the
-- address itself. It is a throttle key, not a visitor log: it cannot be read
-- back as an IP by looking at it, nothing else joins to it, and the rows are
-- disposable. That keeps a rate limit from quietly becoming the one place this
-- business stores personal data it never asked for.
create table if not exists public.post_job_attempts (
  id         bigserial primary key,
  caller_key text        not null,
  used_model boolean     not null default false,
  created_at timestamptz not null default now()
);

create index if not exists post_job_attempts_caller_idx
  on public.post_job_attempts (caller_key, created_at desc);
create index if not exists post_job_attempts_model_idx
  on public.post_job_attempts (created_at desc) where used_model;

-- Row level security on, and deliberately not one policy behind it. Only the
-- service role writes here, and it bypasses RLS. Same fail-closed shape as
-- portal_code_attempts: nobody signed in, admin included, can read a throttle
-- table through the API, because there is nothing in it worth reading.
alter table public.post_job_attempts enable row level security;

-- Housekeeping. A throttle only cares about the last hour, so anything older
-- is noise. Called by the function itself, cheaply, on a fraction of requests.
create or replace function public.post_job_attempts_sweep()
returns void language sql security definer set search_path to 'public' as $$
  delete from public.post_job_attempts where created_at < now() - interval '2 hours';
$$;
revoke execute on function public.post_job_attempts_sweep() from anon, authenticated;
