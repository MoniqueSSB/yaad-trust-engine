-- The three moves that finish a report, as RPCs.
--
-- 20260904c built the schema and the guards. This is the desk's door to them.
-- The concierge convention, written at the top of its own VIEWS registry, is
-- that anything with a rule behind it goes through a Postgres function so the
-- rule is checked in the database whoever is calling, and the page is only
-- ever the form in front of it. Rating a finding and writing a verdict are the
-- two acts a client is actually paying for, so they get that treatment rather
-- than a column write from a browser.
--
-- Each one writes to agent_actions as the named person, which is the point of
-- having a ledger: the drafting is recorded against yaad-report, and the
-- judgment is recorded against whoever made it.

-- ── rate one finding ───────────────────────────────────────────────────────
create or replace function public.rate_finding(
  p_report uuid, p_ord integer, p_severity text
) returns public.report_findings
language plpgsql security definer set search_path = public as $$
declare row public.report_findings;
begin
  if not public.is_admin() then
    raise exception 'Only a signed-in admin can rate a finding.';
  end if;
  if p_severity not in ('severe', 'moderate', 'low') then
    raise exception 'Severity must be severe, moderate or low. Got %.', coalesce(p_severity, 'nothing');
  end if;

  update public.report_findings
     set severity = p_severity
   where report_id = p_report and ord = p_ord
   returning * into row;

  if row.id is null then
    raise exception 'There is no finding % on that report.', p_ord;
  end if;

  insert into public.agent_actions (job_id, actor, actor_kind, action, summary, refs)
  select r.job_id, coalesce(auth.jwt() ->> 'email', 'unknown'), 'human', 'rate_finding',
         'Rated finding ' || p_ord || ' as ' || p_severity || ': ' || left(row.heading, 80),
         jsonb_build_object('reports', p_report, 'report_findings', row.id)
    from public.reports r where r.id = p_report;

  return row;
end;
$$;

comment on function public.rate_finding is
  'Rate one finding Severe, Moderate or Low. The professional judgment the client paid for, so it is an admin act, it is stamped with who made it, and it is recorded in the ledger.';

-- ── write the verdict ──────────────────────────────────────────────────────
create or replace function public.write_report_verdict(
  p_report uuid, p_line text, p_verdict text
) returns public.reports
language plpgsql security definer set search_path = public as $$
declare row public.reports; offending text;
begin
  if not public.is_admin() then
    raise exception 'Only a signed-in admin can write a verdict.';
  end if;
  if length(btrim(coalesce(p_line, ''))) = 0 or length(btrim(coalesce(p_verdict, ''))) = 0 then
    raise exception 'A verdict needs both the one line for page one and the paragraph under it.';
  end if;

  -- The same rule the issue gate applies, applied here so it is caught while
  -- she is still typing rather than at the last step.
  if public.has_measurement(p_line) or public.has_measurement(p_verdict) then
    raise exception 'That verdict states a measurement, which Yaadly does not produce. Say it in words instead.';
  end if;

  update public.reports
     set verdict_line = btrim(p_line), verdict = btrim(p_verdict)
   where id = p_report and status <> 'issued'
   returning * into row;

  if row.id is null then
    raise exception 'That report does not exist, or it has already been issued. An issued report is not rewritten, it is superseded.';
  end if;

  insert into public.agent_actions (job_id, actor, actor_kind, action, summary, refs)
  values (row.job_id, coalesce(auth.jwt() ->> 'email', 'unknown'), 'human', 'write_verdict',
          'Wrote the verdict: ' || left(btrim(p_line), 120),
          jsonb_build_object('reports', p_report));

  return row;
end;
$$;

comment on function public.write_report_verdict is
  'Write the page one verdict. Never drafted, never suggested. An issued report cannot be rewritten.';

-- ── issue it ───────────────────────────────────────────────────────────────
create or replace function public.issue_report(p_report uuid)
returns public.reports
language plpgsql security definer set search_path = public as $$
declare row public.reports;
begin
  if not public.is_admin() then
    raise exception 'Only a signed-in admin can issue a report.';
  end if;

  -- Everything that could refuse this lives in report_guard_issue, which runs
  -- on the update below: unrated findings, a missing verdict, a measurement
  -- that survived. Deliberately not re-checked here, so there is one place the
  -- rule lives and no chance of the two drifting apart.
  update public.reports set status = 'issued' where id = p_report returning * into row;

  if row.id is null then
    raise exception 'There is no report with that id.';
  end if;

  insert into public.agent_actions (job_id, actor, actor_kind, action, summary, refs)
  values (row.job_id, coalesce(auth.jwt() ->> 'email', 'unknown'), 'human', 'issue_report',
          'Issued ' || coalesce(row.number, 'a report') || ' to the client.',
          jsonb_build_object('reports', p_report));

  return row;
end;
$$;

comment on function public.issue_report is
  'Issue a finished report. Mints its number and records who issued it. Every refusal comes from report_guard_issue, which is the single place the rule lives.';

-- These are the desk's doors, not the open internet's. The functions check
-- is_admin() themselves, and revoking anon here means an unauthenticated
-- caller cannot even reach that check.
revoke all on function public.rate_finding(uuid, integer, text) from anon;
revoke all on function public.write_report_verdict(uuid, text, text) from anon;
revoke all on function public.issue_report(uuid) from anon;

-- What the desk lists: every report with how much of it is still on her.
create or replace view public.v_reports_open as
  select r.id, r.number, r.kind, r.status, r.client_name, r.property,
         r.visited_on, r.drafted_at, r.issued_at,
         (select count(*) from public.report_findings f where f.report_id = r.id) as findings,
         (select count(*) from public.report_findings f where f.report_id = r.id and f.severity is null) as unrated,
         (r.verdict is null or length(btrim(coalesce(r.verdict,''))) = 0) as needs_verdict,
         jsonb_array_length(coalesce(r.scrubbed, '[]'::jsonb)) as scrubbed
    from public.reports r;

comment on view public.v_reports_open is
  'Every report and what is still outstanding on it: how many findings are unrated, whether the verdict is written, and how many measurements were scrubbed out of the draft.';
