-- The public question box gets a throttle.
--
-- /ask was the only unthrottled public write in the application. The server
-- action inserted straight into `questions` with the publishable key, under the
-- "anyone may ask" policy, with no limit of any kind. Every other public write
-- path already has a counter behind it: post_job_attempts, booking_attempts,
-- enquiry_attempts, web_chat_attempts, portal_code_attempts. This one did not.
--
-- The blast radius was bounded, and worth stating honestly: rows land
-- unpublished and a person reads them before anything appears, so the worst
-- case is a flooded moderation queue rather than a defaced page. That is a
-- reason it was survivable, not a reason to leave it.
--
-- A second, smaller hole closed at the same time: `area` was capped only by a
-- maxLength attribute on the input. An HTML attribute is not a control. The
-- body was sliced server side; the area was not sliced anywhere.
--
-- SHAPE. Same as post_job_attempts, deliberately, down to the comments: the
-- caller is a SHA-256 of the address, truncated, never the address itself. It
-- is a throttle key, not a visitor log. It cannot be read back as an IP,
-- nothing joins to it, and the rows are swept within hours. A rate limit must
-- not quietly become the one place this business keeps personal data nobody
-- asked it to keep.

create table if not exists public.question_attempts (
  id         bigserial primary key,
  caller_key text        not null,
  created_at timestamptz not null default now()
);

create index if not exists question_attempts_caller_idx
  on public.question_attempts (caller_key, created_at desc);

-- RLS on with no policy behind it. Only the definer function below writes
-- here, and it runs as the owner. Nobody signed in, admin included, can read a
-- throttle table through the API, because there is nothing in it worth reading.
alter table public.question_attempts enable row level security;

create or replace function public.question_attempts_sweep()
returns void language sql security definer set search_path to 'public' as $$
  delete from public.question_attempts where created_at < now() - interval '2 hours';
$$;

-- THE TRAP, already documented on post_job_attempts_sweep and worth repeating
-- because it bites every new function: a fresh function is granted EXECUTE to
-- PUBLIC by default, and revoking from anon does NOT touch that grant, because
-- anon inherits PUBLIC. Revoke from PUBLIC, then grant back only what is
-- needed. has_function_privilege() is how you check you actually did it.
revoke execute on function public.question_attempts_sweep() from public, anon, authenticated;
grant execute on function public.question_attempts_sweep() to service_role;

-- The one door into `questions` for a member of the public.
--
-- Everything the old server action did in TypeScript now happens here, where a
-- mistake in a page file cannot bypass it: the length floor, both length caps,
-- the throttle, and published = false. The caller cannot set `published`,
-- because this function never reads a value for it.
--
-- Ten questions an hour from one caller is generous for a human and useless
-- for a script. It returns a plain text verdict rather than raising, because
-- "you have asked a lot today" is not an error and the page should say it
-- kindly rather than showing a stack of nothing.
create or replace function public.ask_question(
  p_body       text,
  p_area       text default null,
  p_caller_key text default ''
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_body   text := btrim(coalesce(p_body, ''));
  v_area   text := nullif(btrim(coalesce(p_area, '')), '');
  v_caller text := left(coalesce(p_caller_key, ''), 64);
  v_recent integer;
begin
  if length(v_body) < 10 then
    return 'too_short';
  end if;

  -- Sweep cheaply, on a fraction of calls, rather than needing a cron job.
  if random() < 0.1 then
    perform public.question_attempts_sweep();
  end if;

  if v_caller <> '' then
    select count(*) into v_recent
      from public.question_attempts
     where caller_key = v_caller
       and created_at > now() - interval '1 hour';
    if coalesce(v_recent, 0) >= 10 then
      return 'throttled';
    end if;
  end if;

  insert into public.question_attempts (caller_key) values (v_caller);

  insert into public.questions (body, area, published)
  values (left(v_body, 500), left(v_area, 60), false);

  return 'ok';
end $$;

revoke execute on function public.ask_question(text, text, text) from public;
grant execute on function public.ask_question(text, text, text) to anon, authenticated, service_role;

-- PHASE TWO, applied separately AFTER the web app is deployed.
--
-- Dropping "anyone may ask" is what makes the function the only door. It is
-- deliberately not in the same step as creating the function: the deployed
-- server action still does a direct insert until the new build is live, and
-- dropping the policy first would break /ask for the length of a deploy. The
-- statement is recorded here so the file is the whole change:
--
--   drop policy if exists "anyone may ask" on public.questions;
--
-- After it, `questions` has no INSERT policy for anon at all, and the only way
-- a member of the public creates a row is ask_question().
