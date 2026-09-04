-- The report drafter, schema and guards.
--
-- Three of the seven priced services ARE a document: the Deposit Protection
-- Check (£149 founding, £249 standard), the Condition Report (£249 / £349) and
-- the Technical Sign-off (£245). services.html promises a verdict on page one,
-- normally within 72 hours of the visit. Today that document is written by
-- hand, which means a £249 report costs an evening, which caps the business at
-- roughly four reports a week. That cap, not demand and not supply, is what
-- the October Gate runs into.
--
-- So the agent drafts the findings and assembles the document. It does not
-- write the two things that are actually the product.
--
-- WHAT THE MODEL MAY NOT DO, ENFORCED HERE RATHER THAN IN A PROMPT
--
--   1. Rate a finding Severe, Moderate or Low. severity is null on every
--      drafted row and report_guard_issue refuses to issue while one is null.
--   2. Write the verdict. Same guard, same reason: the verdict IS the service.
--   3. State a measurement. has_measurement() already exists for the sketch
--      packs and is reused verbatim rather than reimplemented, because two
--      copies of that rule would drift and the sketch one is already tested
--      against eighteen sentences.
--   4. Price a remedy. There is no amount column on a finding, the same shape
--      as yaad-invoice, where the model has no amount field at all.
--
-- Same three-layer posture as yaad-sketch: the prompt asks, the function
-- scrubs, the database refuses. Only one of the three is a prompt.

create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  number       text unique,
  job_id       text references public.jobs(id) on delete set null,
  service_id   uuid references public.services(id) on delete set null,
  kind         text not null check (kind in ('deposit_check', 'condition', 'technical_signoff', 'visual_check')),

  client_name  text,
  property     text,
  visited_on   date,

  -- The two fields a model may never fill. Both null until a person types
  -- them, and report_guard_issue is what makes that binding rather than
  -- polite.
  verdict      text,
  verdict_line text,

  status       text not null default 'draft' check (status in ('draft', 'reviewed', 'issued')),
  drafted_at   timestamptz not null default now(),
  issued_at    timestamptz,
  issued_by    text,

  model        text,
  provider     text,
  scrubbed     jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

comment on table public.reports is
  'A priced inspection report. The agent drafts the findings; the severity ratings and the page one verdict are written by a named person, and report_guard_issue refuses to issue without them.';
comment on column public.reports.scrubbed is
  'Every measurement the model produced anyway, removed from the text and reported to the desk rather than hidden. Same posture as yaad-sketch MEASUREMENT_RE.';
comment on column public.reports.verdict is
  'Written by a person. Never by a model. Null until they write it.';

create table if not exists public.report_findings (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references public.reports(id) on delete cascade,
  ord        integer not null,
  heading    text not null,
  body       text not null,
  action     text,
  -- Null on every drafted row, by design. A person rates it.
  severity   text check (severity in ('severe', 'moderate', 'low')),
  rated_by   text,
  rated_at   timestamptz,
  created_at timestamptz not null default now(),
  unique (report_id, ord)
);

comment on column public.report_findings.severity is
  'Severe, Moderate or Low. Written by a person, never drafted. The rating is the professional judgment the client paid for.';

create sequence if not exists public.report_seq start 1;

create or replace function public.new_report_number()
returns text language sql volatile set search_path = public as $$
  select 'RPT-' || to_char(now() at time zone 'Europe/London', 'YYYY')
      || '-' || lpad(nextval('public.report_seq')::text, 4, '0');
$$;

-- ── the measurement scrubber, reusing the sketch pack's own rule ────────────
create or replace function public.report_offending_text(p_report uuid)
returns text language sql stable set search_path = public as $$
  select t from (
    select f.heading as t from public.report_findings f where f.report_id = p_report
    union all
    select f.body    from public.report_findings f where f.report_id = p_report
    union all
    select f.action  from public.report_findings f where f.report_id = p_report
    union all
    select r.verdict_line from public.reports r where r.id = p_report
  ) s
  where t is not null and t <> '' and public.has_measurement(t)
  limit 1;
$$;

comment on function public.report_offending_text is
  'The first sentence in a report that states a measurement, or null if it is clean. Uses has_measurement(), the same rule the sketch packs use, deliberately not a second copy.';

-- ── the issue gate ─────────────────────────────────────────────────────────
create or replace function public.report_guard_issue()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  unrated integer;
  offending text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Only a signed-in admin issues a report, the same rule invoice_status_guard
  -- already applies to sending an invoice.
  if new.status in ('reviewed', 'issued') and not public.is_admin() then
    raise exception 'Only a signed-in admin can move a report to %.', new.status;
  end if;

  if new.status = 'issued' then
    if new.verdict is null or length(btrim(coalesce(new.verdict, ''))) = 0
       or new.verdict_line is null or length(btrim(coalesce(new.verdict_line, ''))) = 0 then
      raise exception
        'This report has no verdict. The verdict is the service: services.html promises it on page one. A person writes it before this can issue.';
    end if;

    select count(*) into unrated
      from public.report_findings f
     where f.report_id = new.id and f.severity is null;
    if unrated > 0 then
      raise exception
        '% finding(s) on this report are unrated. Severe, Moderate or Low is the professional judgment the client paid for, and nothing drafts it.', unrated;
    end if;

    offending := public.report_offending_text(new.id);
    if offending is not null then
      raise exception
        'This report states a measurement, which Yaadly does not produce: "%". A phone photograph carries no scale, and measured work in Jamaica is regulated. Reword it or refer it to a surveyor.', left(offending, 160);
    end if;

    new.issued_at := coalesce(new.issued_at, now());
    new.issued_by := coalesce(new.issued_by, auth.jwt() ->> 'email');
    new.number    := coalesce(new.number, public.new_report_number());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_report_guard_issue on public.reports;
create trigger trg_report_guard_issue
  before update on public.reports
  for each row execute function public.report_guard_issue();

-- A rating is a person's act, so record who made it rather than trusting the
-- column to have been filled by the right hands.
create or replace function public.report_stamp_rater()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.severity is distinct from old.severity and new.severity is not null then
    if not public.is_admin() then
      raise exception 'Only a signed-in admin can rate a finding.';
    end if;
    new.rated_by := coalesce(auth.jwt() ->> 'email', new.rated_by);
    new.rated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_report_stamp_rater on public.report_findings;
create trigger trg_report_stamp_rater
  before update on public.report_findings
  for each row execute function public.report_stamp_rater();

-- ── row level security ─────────────────────────────────────────────────────
alter table public.reports         enable row level security;
alter table public.report_findings enable row level security;

-- A client reads their own report once it is issued, never while it is a
-- draft. A draft carries unrated findings and no verdict, and half a judgment
-- is worse to hand somebody than none.
create policy "admin all reports" on public.reports
  for all using (public.is_admin()) with check (public.is_admin());

create policy "client reads their issued report" on public.reports
  for select using (
    status = 'issued' and job_id is not null and exists (
      select 1 from public.jobs j
       where j.id = reports.job_id
         and lower(coalesce(j.client_email, '')) = lower(auth.jwt() ->> 'email')
    )
  );

create policy "admin all findings" on public.report_findings
  for all using (public.is_admin()) with check (public.is_admin());

create policy "client reads findings on their issued report" on public.report_findings
  for select using (
    exists (
      select 1 from public.reports r
        join public.jobs j on j.id = r.job_id
       where r.id = report_findings.report_id
         and r.status = 'issued'
         and lower(coalesce(j.client_email, '')) = lower(auth.jwt() ->> 'email')
    )
  );

create index if not exists reports_status_idx   on public.reports(status, drafted_at desc);
create index if not exists reports_job_idx      on public.reports(job_id);
create index if not exists report_findings_idx  on public.report_findings(report_id, ord);
