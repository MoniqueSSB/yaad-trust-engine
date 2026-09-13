-- A worker can drop a pin to log arrival.
--
-- THE ARRIVAL LOG IS THE FIRST LINK IN THE EVIDENCE CHAIN, and the chain is
-- the moat. Until now the only way to write one was the portal: sign in, find
-- the job, tap the button. CLAUDE.md section 9 says the worker web surface
-- stays thin on purpose because "the worker in Portmore is on a phone mid-job
-- and will do everything over WhatsApp", and the founder's own words on 31
-- August were that a worker on site "has no time to log on and carry out those
-- steps in the web". Arrival was still asking them to.
--
-- WhatsApp has sent a location pin natively for years, and Twilio hands the
-- coordinates straight to the webhook. Dropping a pin is two taps on the
-- phone already in their hand, and it produces better evidence than the portal
-- button does, because a pin carries coordinates and a button carries only a
-- timestamp.
--
-- THE SPLIT, and it is the one this codebase already uses four times. The
-- logic moves into _do_log_arrival(), which takes the worker's email as a
-- parameter and is never exposed to PostgREST. log_arrival() keeps its exact
-- signature, returns and exceptions and now derives the email from the session
-- before delegating, so every existing portal caller is untouched.
-- log_arrival_via_whatsapp() derives it from the phone instead.
--
-- The body of _do_log_arrival is log_arrival's own body, read out of
-- production with pg_get_functiondef on 4 September 2026 and reproduced
-- unchanged apart from where the email comes from. The distance check, the
-- 30km threshold, the "already logged today" short circuit and the Jamaica
-- local date all behave exactly as they did.
--
-- WHY THE JOB CODE IS NOT REQUIRED HERE, unlike the four money RPCs. Those
-- move money or bind an agreement, so they demand a code that cannot be typed
-- by accident. Logging arrival is evidence, not a release, and the portal has
-- always let a signed-in worker do it in one tap with no code at all. The
-- Edge Function asks which job only when the worker has more than one running,
-- which is the same shape the evidence and text-update lanes already use.

-- ── the shared core ──────────────────────────────────────────────────────

create or replace function public._do_log_arrival(
  p_job text,
  p_email text,
  p_lat double precision default null,
  p_lon double precision default null,
  p_accuracy_m numeric default null
)
returns table(stage integer, arrived_at timestamptz, already_logged_today boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
  v_stage int;
  v_existing timestamptz;
  v_parish text;
  v_centroid_lat double precision;
  v_centroid_lon double precision;
  v_far boolean;
  v_km double precision;
begin
  v_email := nullif(btrim(lower(p_email)), '');
  if v_email is null then
    raise exception 'No worker identified.' using errcode = '28000';
  end if;

  -- The job must belong to this worker. Kept here rather than only in the
  -- callers, so neither door can skip it.
  select greatest(coalesce(j.stage, 0), 1), j.parish into v_stage, v_parish
    from public.jobs j
   where j.id = p_job
     and lower(coalesce(j.worker_email, '')) = v_email;

  if v_stage is null then
    raise exception 'That is not your job.' using errcode = '28000';
  end if;

  select a.arrived_at into v_existing
    from public.arrival_log a
   where a.job_id = p_job and a.stage = v_stage
     and a.arrived_on = (now() at time zone 'America/Jamaica')::date;

  if v_existing is not null then
    return query select v_stage, v_existing, true;
    return;
  end if;

  v_far := null;
  if p_lat is not null and p_lon is not null then
    select c.lat, c.lon into v_centroid_lat, v_centroid_lon from public.parish_centroid(v_parish) c;
    if v_centroid_lat is not null then
      v_km := public.km_between(p_lat, p_lon, v_centroid_lat, v_centroid_lon);
      v_far := v_km > 30;
    end if;
  end if;

  insert into public.arrival_log (job_id, stage, arrived_by, lat, lon, accuracy_m, far_from_site)
  values (p_job, v_stage, v_email, p_lat, p_lon, p_accuracy_m, v_far);

  return query select v_stage, now(), false;
end;
$$;

-- Never a door of its own: it trusts the email it is handed, so the callers
-- are what establish who that is.
revoke all on function public._do_log_arrival(text, text, double precision, double precision, numeric)
  from public, anon, authenticated;

-- ── the portal door, unchanged from the outside ──────────────────────────

create or replace function public.log_arrival(
  p_job text,
  p_lat double precision default null,
  p_lon double precision default null,
  p_accuracy_m numeric default null
)
returns table(stage integer, arrived_at timestamptz, already_logged_today boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
begin
  v_email := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
  if v_email is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;
  return query select * from public._do_log_arrival(p_job, v_email, p_lat, p_lon, p_accuracy_m);
end;
$$;

-- ── the WhatsApp door ────────────────────────────────────────────────────

create or replace function public.log_arrival_via_whatsapp(
  p_job text,
  p_phone text,
  p_lat double precision default null,
  p_lon double precision default null
)
returns table(stage integer, arrived_at timestamptz, already_logged_today boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
begin
  if length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 9 then
    raise exception 'No usable phone number.' using errcode = '28000';
  end if;

  -- The published worker whose number this is. same_phone() rather than the
  -- last nine digits, for the reason in 20260904b: two numbers in different
  -- countries ending the same way are not the same person, and this writes to
  -- the evidence chain.
  --
  -- More than one profile can share a number (an old seed profile beside the
  -- live one), so the job decides: take the match that actually owns this job.
  select lower(wp.worker_email) into v_email
    from public.worker_profiles wp
    join public.jobs j on lower(coalesce(j.worker_email, '')) = lower(wp.worker_email)
   where wp.active = true
     and j.id = p_job
     and public.same_phone(wp.phone, p_phone)
   limit 1;

  if v_email is null then
    raise exception 'That number is not the worker on this job.' using errcode = '28000';
  end if;

  -- Accuracy is null on purpose: a WhatsApp location pin does not carry one,
  -- and a made up figure in an evidence record is worse than an absent one.
  return query select * from public._do_log_arrival(p_job, v_email, p_lat, p_lon, null::numeric);
end;
$$;

-- Reached only from yaad-inbound on the service role, after it has matched the
-- sender's number to a published worker with this job running. Same posture as
-- the four money RPCs.
revoke all on function public.log_arrival_via_whatsapp(text, text, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.log_arrival_via_whatsapp(text, text, double precision, double precision) to service_role;

comment on function public.log_arrival_via_whatsapp(text, text, double precision, double precision) is
  'A worker drops a WhatsApp location pin and it becomes an Arrival Log entry. The number identifies the worker, the job must already be theirs, and the coordinates go through the same 30km parish check the portal button uses.';
