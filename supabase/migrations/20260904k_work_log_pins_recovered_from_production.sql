-- Recovered from production, 4 September 2026.
--
-- Applied to the live database as version 20260904094937 by a parallel session
-- and never committed to any branch. Read back out of
-- supabase_migrations.schema_migrations and written here verbatim, the same way
-- the Vault migration was recovered on 3 September. The repository being the
-- only place a live table is missing from is the drift DECISIONS.md already
-- complains about twice.
--
-- IT IS TRANSCRIBED, NOT TESTED. Nothing here was executed by the session that
-- recovered it; production already had it. It matters on a rebuild, where a
-- latent error would surface rather than here.
--
-- NOTHING WRITES TO THIS TABLE ANY MORE, AND NOTHING EVER DID. Resolved the
-- same day the file was recovered, and the first version of this header
-- overstated the problem twice over, so here is what is actually true.
--
-- Two versions of yaad-inbound existed, from the same session at different
-- moments. One filed a WhatsApp location share here as a work log pin. The
-- other, which is the one on main, files the same share as an ARRIVAL CHECK-IN
-- into arrival_log, which is part of the evidence spine named in CLAUDE.md
-- section 8, and refuses a second check-in the same day.
--
-- Production was running the first. It was replaced with main's on 4 September
-- once the numbers settled the question: work_log_pins had zero rows and had
-- never received one, arrival_log had three. So the divergence ended by
-- deploying main, which lost nothing that had ever existed and gained arrival
-- logging from a location share, which production did not have.
--
-- The table and record_work_log_pin() are left in place rather than dropped,
-- because dropping live objects to tidy up is how you find out what depended
-- on them. If nothing claims them, they are safe to remove later. If somebody
-- wants pins as well as arrivals, this is the schema to build on.
--
-- It also depends on parish_centroid() and km_between(), which are likewise
-- live and may not be in this repository either. Check before a rebuild.

create table if not exists public.work_log_pins (
  id           uuid primary key default gen_random_uuid(),
  job_id       text not null references public.jobs(id) on delete cascade,
  stage        integer not null,
  lat          double precision not null,
  lon          double precision not null,
  accuracy_m   numeric,
  address      text,
  label        text,
  shared_by    text not null,
  shared_at    timestamptz not null default now(),
  far_from_site boolean
);

comment on table public.work_log_pins is
  'One deliberate WhatsApp location share by the worker, tied to a job and stage. Strengthens the evidence record; never gates it. A worker who does not share a location is never blocked, penalised or delayed by its absence.';

comment on column public.work_log_pins.far_from_site is
  'True when the point sits over 30km from the job parish centroid, null when the parish text did not match a known one. A coarse sanity flag for a human to glance at, never a refusal.';

create index if not exists work_log_pins_job_stage on public.work_log_pins (job_id, stage, shared_at desc);

alter table public.work_log_pins enable row level security;

create policy work_log_pins_party_read on public.work_log_pins
  for select using (
    exists (
      select 1 from public.jobs j
      where j.id = work_log_pins.job_id
        and nullif(btrim(lower(auth.jwt() ->> 'email')), '') is not null
        and (
          nullif(btrim(lower(auth.jwt() ->> 'email')), '') = nullif(btrim(lower(coalesce(j.client_email, ''))), '')
          or nullif(btrim(lower(auth.jwt() ->> 'email')), '') = nullif(btrim(lower(coalesce(j.worker_email, ''))), '')
        )
    )
  );

create policy work_log_pins_admin on public.work_log_pins
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.record_work_log_pin(
  p_job text,
  p_phone text,
  p_lat double precision,
  p_lon double precision,
  p_accuracy_m numeric default null,
  p_address text default null,
  p_label text default null
)
returns table (stage integer, pinned_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_stage integer;
  v_parish text;
  v_far boolean;
  v_clat double precision;
  v_clon double precision;
  v_digits text;
begin
  if p_lat is null or p_lon is null then
    raise exception 'A pin needs a latitude and a longitude.' using errcode = '22023';
  end if;

  v_digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(v_digits) < 7 then
    raise exception 'That is not a phone number.' using errcode = '22023';
  end if;

  select greatest(coalesce(j.stage, 0), 1), j.parish
    into v_stage, v_parish
    from public.jobs j
   where j.id = p_job
     and right(regexp_replace(coalesce(j.worker_phone, ''), '\D', '', 'g'), 9) = right(v_digits, 9);

  if v_stage is null then
    raise exception 'That is not your job.' using errcode = '28000';
  end if;

  v_far := null;
  select c.lat, c.lon into v_clat, v_clon from public.parish_centroid(v_parish) c;
  if v_clat is not null then
    v_far := public.km_between(p_lat, p_lon, v_clat, v_clon) > 30;
  end if;

  insert into public.work_log_pins (job_id, stage, lat, lon, accuracy_m, address, label, shared_by, far_from_site)
  values (p_job, v_stage, p_lat, p_lon, p_accuracy_m, nullif(btrim(coalesce(p_address, '')), ''),
          nullif(btrim(coalesce(p_label, '')), ''), v_digits, v_far);

  return query select v_stage, now();
end;
$$;

revoke all on function public.record_work_log_pin(text, text, double precision, double precision, numeric, text, text)
  from public, anon, authenticated;
