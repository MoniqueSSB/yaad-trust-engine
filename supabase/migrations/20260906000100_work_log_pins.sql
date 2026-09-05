-- Named 20260906 although it was written on 5 September 2026. The prefix is an
-- ordering token, not a date. scripts/check-migration-order.mjs requires a new
-- migration to sort after every existing one, the last of which is
-- 20260905d_a_vetting_decision_says_who_made_it.sql, and no 14-digit stamp
-- beginning 20260905 can sort after a letter, because '9' sorts before 'd'. So
-- on the day the rule landed, the first correct name is the next day's. The
-- ordering is what the check is protecting and the ordering is right.
--
-- The work-log location pin.
--
-- Founder's instruction, 4 September 2026: do the geotag check through
-- Twilio, "as this might be better". It is better, and for a reason worth
-- writing down rather than assuming.
--
-- The Python engine's verification agent has checked "live pin on work log"
-- since it was written. It could not be ported on 4 Sep because evidence rows
-- carry no lat/lon, and the obvious fix, reading a photograph's EXIF, does not
-- work and cannot be made to: WhatsApp re-encodes images on send and discards
-- the EXIF block, GPS included, and this project's own portal upload path
-- strips location deliberately. So there was never a photo geotag to read.
--
-- A WhatsApp location share is a different thing and a stronger one. Twilio
-- delivers Latitude, Longitude, Address and Label as ordinary inbound webhook
-- parameters, with nothing to buy or install. And unlike EXIF it cannot be
-- back-dated: a photograph's metadata can come from a picture taken last week
-- at a different house, a location share is an act performed now. It is also
-- consent rather than covert extraction, which matters when the person being
-- located is a tradesperson working for you.
--
-- ── The rule this table inherits ──
--
-- 20260901za says of the arrival tap's GPS that it "strengthens the record, it
-- never gates it", and that a worker who declines the prompt, whose phone has
-- no fix, or whose browser has no geolocation still checks in exactly the same
-- way. That rule holds here without exception. A pin is evidence that helps a
-- worker; the absence of one is never held against him, never blocks a stage
-- and never delays a payment. The evidence checks report a missing pin the way
-- they report anything else: as a line for a person to read.


-- ── This file existed twice, and the copy was the one on main ──
--
-- Merged 5 September 2026. A parallel session found work_log_pins live in
-- production and absent from every branch, read it back out of
-- supabase_migrations.schema_migrations and committed the transcription as
-- 20260904k_work_log_pins_recovered_from_production.sql. Correct instinct: the
-- repository being the only place a live table is missing from is real drift.
-- It was recovering this file, which was sitting unmerged on another branch.
--
-- The two are the same SQL. The transcription lost every inline comment, which
-- is what a read-back out of the catalogue always loses, so this authored copy
-- is the one that survives and that file is deleted. Keeping both would not
-- have been merely untidy: create policy has no "if not exists" in Postgres,
-- so the second of them fails on any rebuild.
--
-- Its history is worth keeping, so here it is. Two versions of yaad-inbound
-- existed from the same session at different moments. One filed a WhatsApp
-- location share here as a work log pin. The other, which reached main, filed
-- the same share as an ARRIVAL CHECK-IN into arrival_log and refused a second
-- check-in the same day. Production was running the first; it was replaced
-- with main's on 4 September once the numbers settled it, work_log_pins at
-- zero rows and arrival_log at three.
--
-- The merge kept both behaviours rather than choosing. A location share is an
-- arrival check-in the FIRST time it lands on a stage on a given day, and a
-- work log pin every time after that: "I am here", then "here is where I was
-- when I filed this". arrival_log keeps the evidence spine named in CLAUDE.md
-- section 8, this table keeps the rest, and neither is a second door onto the
-- other. log_arrival_via_whatsapp already reported already_logged_today, so
-- nothing new had to be trusted to tell the two apart.
--
-- One warning from the recovered copy is still live: record_work_log_pin()
-- depends on parish_centroid() and km_between(), which are themselves live and
-- may not be in this repository. Check before a rebuild.
create table if not exists public.work_log_pins (
  id           uuid primary key default gen_random_uuid(),
  job_id       text not null references public.jobs(id) on delete cascade,
  stage        integer not null,
  lat          double precision not null,
  lon          double precision not null,
  accuracy_m   numeric,
  -- Free text from WhatsApp's own location card, when the sender's app filled
  -- it in. Never trusted for anything, kept because a human reading the pack
  -- would rather see "Barbican, Kingston 8" than two decimals.
  address      text,
  label        text,
  shared_by    text not null,
  shared_at    timestamptz not null default now(),
  -- Same coarse sanity flag as arrival_log, computed the same way against the
  -- same parish centroids, and carrying the same caveat: a materials run, a
  -- parish border and a bad GPS fix all raise it exactly as loudly as a wrong
  -- site would. Desk only, never shown to a worker.
  far_from_site boolean
);

comment on table public.work_log_pins is
  'One deliberate WhatsApp location share by the worker, tied to a job and stage. Strengthens the evidence record; never gates it. A worker who does not share a location is never blocked, penalised or delayed by its absence.';

comment on column public.work_log_pins.far_from_site is
  'True when the point sits over 30km from the job parish centroid, null when the parish text did not match a known one. A coarse sanity flag for a human to glance at, never a refusal.';

create index if not exists work_log_pins_job_stage on public.work_log_pins (job_id, stage, shared_at desc);

alter table public.work_log_pins enable row level security;

-- Same shape as arrival_log_party_read: the two parties to the job can see it,
-- nobody else can, and writes do not come through here at all.
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

-- ── recording a pin ──
--
-- SECURITY DEFINER and callable by nobody from a browser, exactly like
-- log_arrival. The only caller is yaad-inbound, holding the service role key,
-- because the pin arrives over a Twilio webhook rather than from a signed-in
-- session: the worker is identified by the phone number the message came from,
-- which the Twilio signature check has already authenticated.
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

  -- Digits only on both sides. A WhatsApp address arrives as +18761234567 and
  -- a stored worker_phone may carry spaces, a leading 00 or nothing at all.
  v_digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(v_digits) < 7 then
    raise exception 'That is not a phone number.' using errcode = '22023';
  end if;

  select greatest(coalesce(j.stage, 0), 1), j.parish
    into v_stage, v_parish
    from public.jobs j
   where j.id = p_job
     and right(regexp_replace(coalesce(j.worker_phone, ''), '\D', '', 'g'), 9) = right(v_digits, 9);

  -- Not this worker's job, or no job. Refused rather than recorded against
  -- somebody else's work, the same posture log_arrival takes.
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
