-- Geotagged arrival check-in. Founder's own instruction, 1 Sep 2026: the
-- "I'm on site" tap (20260831m) should capture one GPS reading to back up
-- the claim of physical presence, and a location reading on a named worker
-- needs its own honest line to workers, separate from and replacing "no
-- tracking" wherever that promise is published, rather than the two
-- standing side by side contradicting each other.
--
-- One point, not a trail. log_arrival() already refuses a second check-in
-- on the same stage the same Jamaica-local day, so this can only ever add
-- one coordinate per stage per day, never a location history. Nothing here
-- runs in the background and nothing here reads a phone's location except
-- at the exact moment the worker chooses to tap the button.
--
-- Compared against the job's own PARISH, not its street address.
-- jobs.addr is free text nobody has ever geocoded, and geocoding a
-- client's address means sending it to a mapping API, a new third party
-- touching personal data, which CLAUDE.md reserves as Monique's call, not
-- a default an agent takes on its own. Jamaica has 14 parishes; their town
-- centroids are public, static geography, no vendor and no API call
-- involved. This is a coarse sanity check, not pinpoint verification: a
-- worker legitimately at the far edge of a large parish, or one whose
-- phone gave a bad fix, reads the same as a worker at the wrong site
-- entirely. Never a refusal, and never shown to the worker as a challenge:
-- a flag for a human to glance at, exactly the same shape as
-- worker_stall_history.

alter table public.arrival_log
  add column if not exists lat double precision,
  add column if not exists lon double precision,
  add column if not exists accuracy_m numeric,
  add column if not exists far_from_site boolean;

comment on column public.arrival_log.lat is
  'One GPS reading, captured only at the moment of the arrival tap. Null when the worker''s browser had no location, denied permission, or the phone could not get a fix; the check-in itself is never blocked on this.';

comment on column public.arrival_log.far_from_site is
  'True when the captured point sits over 30km from the job parish''s town centroid, null when there was no point to check or the parish text did not match a known one. A coarse sanity flag for a human to glance at, never a refusal: a bad GPS fix, a parish border, or a trip to the materials store all produce the same flag as a wrong site would.';

-- ---------------------------------------------------- parish geography

create or replace function public.normalize_parish(p_parish text)
returns text
language sql
immutable
as $$
  select nullif(btrim(
    regexp_replace(
      regexp_replace(
        btrim(regexp_replace(lower(coalesce(p_parish, '')), '\(.*\)', '', 'g')),
        '^saint\s+', 'st ', 'g'
      ),
      '^st\.\s*', 'st ', 'g'
    )
  ), '');
$$;

comment on function public.normalize_parish(text) is
  'jobs.parish has never had one spelling: "St Andrew", "St. Andrew", "Saint Catherine", "Portmore (St. Catherine)" are all live values. Folds the common variants down to one key so parish_centroid can match on it. Not exhaustive, a best-effort read for a sanity check, not the source of truth for a parish name anywhere else.';

create or replace function public.parish_centroid(p_parish text)
returns table(lat double precision, lon double precision)
language sql
immutable
as $$
  select c.lat, c.lon
    from (values
      ('kingston',     17.9714::double precision, -76.7931::double precision),
      ('st andrew',    18.0333, -76.7833),
      ('st thomas',    17.9000, -76.3500),
      ('portland',     18.1667, -76.4500),
      ('st mary',      18.3667, -76.9167),
      ('st ann',       18.4333, -77.2000),
      ('trelawny',     18.3500, -77.6000),
      ('st james',     18.4762, -77.8939),
      ('hanover',      18.4167, -78.1333),
      ('westmoreland', 18.2167, -78.1667),
      ('st elizabeth', 18.0333, -77.7500),
      ('manchester',   18.0447, -77.5117),
      ('clarendon',    17.9667, -77.2417),
      ('st catherine', 17.9909, -76.9557),
      ('portmore',     17.9481, -76.8807)
    ) as c(name, lat, lon)
   where c.name = public.normalize_parish(p_parish)
   limit 1;
$$;

comment on function public.parish_centroid(text) is
  'Town-centroid approximations for Jamaica''s 14 parishes plus Portmore (a distinct town inside St Catherine, and the launch metro alongside Kingston). Good enough for a 30km sanity radius, not survey-grade, and not used anywhere pinpoint accuracy matters.';

create or replace function public.km_between(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision
language sql
immutable
as $$
  select 6371 * 2 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ^ 2
  ));
$$;

comment on function public.km_between(double precision, double precision, double precision, double precision) is
  'Great-circle distance in km, haversine. No PostGIS dependency for one distance check.';

revoke all on function public.normalize_parish(text) from public, anon, authenticated;
revoke all on function public.parish_centroid(text) from public, anon, authenticated;
revoke all on function public.km_between(double precision, double precision, double precision, double precision) from public, anon, authenticated;

-- ---------------------------------------------------- log_arrival, extended

-- Same function, same door, same refusal behaviour as 20260831m: adding
-- three optional parameters at the end is the one shape of change
-- CREATE OR REPLACE allows without dropping the function first, and every
-- existing caller that sends none of them keeps working unchanged.
create or replace function public.log_arrival(
  p_job text,
  p_lat double precision default null,
  p_lon double precision default null,
  p_accuracy_m numeric default null
)
returns table(stage int, arrived_at timestamptz, already_logged_today boolean)
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
  v_email := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
  if v_email is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

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

revoke all on function public.log_arrival(text, double precision, double precision, numeric) from public, anon, authenticated;
grant execute on function public.log_arrival(text, double precision, double precision, numeric) to authenticated;
