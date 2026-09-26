-- A figure is not ours to repeat, and the questions have to survive the draft.
--
-- Two separate holes, both found on 25 September 2026 when the report drafter
-- produced its first real Deposit Protection Check and somebody read it.
--
-- ── 1. Rule 4 was unenforced ──
--
-- The drafting prompt has always said the agent may never state, estimate or
-- imply a cost, a price, a day rate or a quantity of materials, and on 25
-- September it was rewritten to forbid repeating a figure out of the notes in
-- terms. The very next draft carried four of them. Nothing stopped it. The
-- measurement scrubber only reads units of length and the banned-language
-- screen only reads words, so a sum of money walked through both untouched.
--
-- Same three layers as the measurement rule, and now literally the same shape:
-- the prompt forbids it, _shared/figures.ts removes whatever the model writes
-- anyway and reports it to the desk rather than hiding it, and has_figure()
-- below refuses to let a report carrying one be issued. Layer one is the layer
-- nobody should trust, which is the whole reason the other two exist.
--
-- What it does not catch, on purpose: percentages and the shape of an
-- arrangement, which rule 4 allows and the client needs told, and ordinary
-- counting. See the header of _shared/figures.ts.
--
-- ── 2. The referrals were being thrown away ──
--
-- Rule 5 sends title, ownership, structural soundness and boundaries to an
-- attorney, a valuer, a PERB registered engineer and a commissioned land
-- surveyor, and tells the agent to put them in "questions" with no finding
-- written about them. The agent did exactly that. yaad-report returned them in
-- its HTTP response and then dropped them, because reports had no column for
-- them, and the same was true of "omitted", the list of what the notes could
-- not establish. So the one part of the draft that exists to keep Yaadly out
-- of regulated work survived only as long as the browser tab that called it.
--
-- Both are now columns. Neither is ever shown to a client automatically: they
-- are there for the person who rates the findings and signs the verdict.

alter table public.reports
  add column if not exists omitted   jsonb not null default '[]'::jsonb,
  add column if not exists questions jsonb not null default '[]'::jsonb;

comment on column public.reports.questions is
  'Matters the draft refused to answer and referred to another profession, rule 5. Kept because a referral that only exists in an HTTP response is not a referral.';

comment on column public.reports.omitted is
  'What the notes could not establish, so the person signing knows the boundary of the review before they sign it.';

-- ── the rule ───────────────────────────────────────────────────────────────
-- Character for character the string in _shared/figures.ts. figures_test.ts
-- reads this file and fails if the two differ, so this copy cannot drift
-- quietly, exactly as measurements_test.ts does for has_measurement().
create or replace function public.has_figure(p text)
returns boolean language sql immutable set search_path = public as $fn$
  select coalesce(p ~* $fig$(^|[^a-z0-9])(j\$|ja\$|us\$|ca\$|\$|£|jmd|gbp|usd|cad)\s*[0-9][0-9,.]*|(^|[^a-z0-9])[0-9][0-9,.]*\s*(jmd|gbp|usd|cad|dollars|dollar|pounds|pound)([^a-z0-9]|$)|(^|[^a-z0-9])(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)(\s+(hundred|thousand|million|and))*\s+(dollars|dollar|pounds|pound)([^a-z0-9]|$)|(^|[^a-z0-9])[0-9]{1,3}(,[0-9]{3})+([^0-9]|$)$fig$, false);
$fn$;

comment on function public.has_figure is
  'True if the text states a sum of money or a grouped quantity. Percentages and plain counting are deliberately not figures: the shape of an arrangement is what the client needs told, the price is what Yaadly does not sell.';

create or replace function public.report_offending_figure(p_report uuid)
returns text language sql stable set search_path = public as $$
  select t from (
    select f.heading as t from public.report_findings f where f.report_id = p_report
    union all
    select f.body    from public.report_findings f where f.report_id = p_report
    union all
    select f.action  from public.report_findings f where f.report_id = p_report
  ) s
  where t is not null and t <> '' and public.has_figure(t)
  limit 1;
$$;

comment on function public.report_offending_figure is
  'The first drafted sentence in a report that states a figure, or null if it is clean. Deliberately does not read verdict or verdict_line: a person writes those, and which numbers belong in the document is that person''s decision, not this gate''s.';

-- ── the issue gate, with the figure check added ────────────────────────────
-- Unchanged from 20260904n apart from the fourth refusal. Repeated in full
-- rather than patched, because a trigger function is replaced whole and a
-- half remembered copy of the other three checks is how one of them goes
-- missing.
create or replace function public.report_guard_issue()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  unrated integer;
  offending text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

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

    offending := public.report_offending_figure(new.id);
    if offending is not null then
      raise exception
        'A drafted finding on this report states a figure: "%". Yaadly guarantees project management and oversight judgment, not price estimation, and a number in this document reads as a number Yaadly stands behind. Describe the shape of the arrangement instead, or put the figure in the verdict yourself, where it is your judgment and not the agent''s.', left(offending, 160);
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

-- ── 3. Why it matters ──────────────────────────────────────────────────────
-- The service is sold as "every risk in the quote, in plain English, with why
-- it matters", and the drafted finding had a heading, a body and an action but
-- no why. The client was getting the what and the do, and the reason was in
-- the reviewer's head. It is drafted text like the body, screened like the
-- body, and it is read by both gates like the body.
alter table public.report_findings
  add column if not exists why text;

comment on column public.report_findings.why is
  'Why this finding matters to the client, drafted and screened like the body. Not a rating: what it exposes them to, not how serious it is.';

create or replace function public.report_offending_text(p_report uuid)
returns text language sql stable set search_path = public as $$
  select t from (
    select f.heading as t from public.report_findings f where f.report_id = p_report
    union all
    select f.body    from public.report_findings f where f.report_id = p_report
    union all
    select f.why     from public.report_findings f where f.report_id = p_report
    union all
    select f.action  from public.report_findings f where f.report_id = p_report
    union all
    select r.verdict_line from public.reports r where r.id = p_report
  ) s
  where t is not null and t <> '' and public.has_measurement(t)
  limit 1;
$$;

create or replace function public.report_offending_figure(p_report uuid)
returns text language sql stable set search_path = public as $$
  select t from (
    select f.heading as t from public.report_findings f where f.report_id = p_report
    union all
    select f.body    from public.report_findings f where f.report_id = p_report
    union all
    select f.why     from public.report_findings f where f.report_id = p_report
    union all
    select f.action  from public.report_findings f where f.report_id = p_report
  ) s
  where t is not null and t <> '' and public.has_figure(t)
  limit 1;
$$;
