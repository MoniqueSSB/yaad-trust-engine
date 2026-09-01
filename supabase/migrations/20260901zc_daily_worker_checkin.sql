-- The daily worker prompt. Founder's own instruction, 1 Sep 2026: every
-- live job with a worker attached gets asked, once a day, for a
-- follow-up report, voice note or a couple of words and pictures.
--
-- Deliberately its own table and its own cron job rather than folded into
-- job_stall_state / yaad-job-health: that mechanism watches for silence
-- and only speaks after three days of it. This one asks daily regardless
-- of silence, a different signal on a different clock, same reasoning
-- job_followups (20260901zzzz3) already gave for not inventing a second
-- shape where the difference is only the trigger.

create table if not exists public.daily_checkin_log (
  id       uuid primary key default gen_random_uuid(),
  job_id   text not null references public.jobs(id) on delete cascade,
  sent_on  date not null,
  sent_at  timestamptz not null default now(),
  unique (job_id, sent_on)
);

comment on table public.daily_checkin_log is
  'One row per job per Jamaica-local day the daily prompt was sent (or attempted), written by yaad-daily-checkin holding the service role. Exists purely to stop a re-run, or a cron overlap, double-messaging the same worker the same day. No RLS policies: nothing here is client or worker facing.';

create index if not exists daily_checkin_log_sent_on_idx on public.daily_checkin_log (sent_on);

alter table public.daily_checkin_log enable row level security;

-- Same shape as 20260831s (yaad-job-health): the secret is generated
-- here, kept only as a SHA-256 hash in app_settings, plaintext living in
-- exactly one place, the cron job's own command.
--
-- 21:00 UTC, 16:00 Jamaica. Deliberately not the same 13:00 UTC morning
-- slot as yaad-job-health's own nudge: this is asking what happened
-- today, and there is more to report by mid-afternoon than at 8am.

do $do$
declare
  s      text := encode(extensions.gen_random_bytes(32), 'hex');
  fn_url text := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-daily-checkin';
  pubkey text := 'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz';
  cmd    text;
begin
  insert into public.app_settings(key, value)
  values ('daily_checkin_cron_secret_sha256', encode(extensions.digest(s, 'sha256'), 'hex'))
  on conflict (key) do update set value = excluded.value;

  cmd := format(
    $c$select net.http_post(
      url := %L,
      body := jsonb_build_object('secret', %L),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', %L,
        'Authorization', 'Bearer ' || %L),
      timeout_milliseconds := 120000)$c$,
    fn_url, s, pubkey, pubkey);

  if exists (select 1 from cron.job where jobname = 'yaad-daily-checkin') then
    perform cron.unschedule('yaad-daily-checkin');
  end if;

  perform cron.schedule('yaad-daily-checkin', '0 21 * * *', cmd);
end
$do$;
