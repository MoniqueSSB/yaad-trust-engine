-- A report for every service, 28 September 2026.
--
-- Founder instruction: every service gets a template, and the agent drafts
-- into it once the service is booked. Four report kinds existed; this adds
-- the three that did not: Property Care visits, the monthly Oversight
-- Retainer report, and the Full Project Management stage completion record.
--
-- THREE CHANGES OF RULE, EACH DELIBERATE
--
-- 1. Two kinds are never rated. services.html says of the Visual Check
--    "They record. They do not rate or advise." report_guard_issue refused
--    to issue ANY report with an unrated finding, so a Visual Check could only
--    ever issue by breaking the promise on the services page. Property Care is
--    the same kind of record. For those two, a rating is now refused outright
--    (report_stamp_rater) and not required to issue. The verdict is still
--    required: on these two it is the summary of the visit, written by a
--    person.
--
-- 2. reports.human holds what only a person decides and a model never
--    drafts: the result of a Technical Sign-off or a stage record, the
--    monthly status ratings of an oversight report, and every sum of money.
--    It is written only by set_report_human(), which is admin only, refuses an
--    issued report, accepts only listed keys and values, and logs before and
--    after in report_edits. A trigger refuses any other write to the column,
--    including a direct update by an admin session, so the desk's form is the
--    only door. yaad-report never sends it.
--
--    Money is allowed here and nowhere else in a report. edit_report() still
--    refuses a figure in drafted text, and report_guard_issue still refuses a
--    figure in a drafted finding. A sum typed into this column is a person
--    recording a number they stand behind, which is the distinction
--    20260925220000 drew.
--
-- 3. Three kinds need a person's decision beyond ratings before they issue:
--    a Technical Sign-off needs its result (released, released with
--    conditions, not released), a stage record needs its result (complete,
--    complete with items, not complete), and an oversight report needs its
--    overall status. Each is in reports.human, typed by a person.
--
-- Nothing here touches money moving. A stage record's value is what the
-- document records; paying a trade still goes through the invoice and pay
-- worker paths and their own gates.

-- ---------------------------------------------------------------- kinds

alter table public.reports drop constraint if exists reports_kind_check;
alter table public.reports add constraint reports_kind_check check (kind in (
  'deposit_check', 'condition', 'technical_signoff', 'visual_check',
  'property_care', 'oversight', 'pm_stage'
));

create or replace function public.report_kind_is_rated(p_kind text)
returns boolean language sql immutable set search_path = public as $$
  select p_kind not in ('visual_check', 'property_care');
$$;

comment on function public.report_kind_is_rated is
  'False for the two record only kinds, the Visual Check and Property Care: services.html promises the checker records and does not rate or advise, so a rating on them is refused rather than required.';

-- ---------------------------------------------------------------- what a person decides

alter table public.reports add column if not exists human jsonb not null default '{}'::jsonb;

comment on column public.reports.human is
  'Typed by a named person at the desk, never drafted: result, status ratings and money. Written only through set_report_human(); trg_report_guard_human refuses every other write.';

create or replace function public.report_guard_human()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.human is distinct from '{}'::jsonb then
      raise exception 'A new report starts with nothing typed by a person. Results, status and money are added afterwards at the desk.'
        using errcode = 'check_violation';
    end if;
  elsif new.human is distinct from old.human
        and coalesce(current_setting('yaadly.human_write', true), '') <> 'on' then
    raise exception 'Results, status and money on a report are typed at the desk, through set_report_human(), and nowhere else.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_report_guard_human on public.reports;
create trigger trg_report_guard_human
  before insert or update on public.reports
  for each row execute function public.report_guard_human();

create or replace function public.set_report_human(p_report uuid, p_key text, p_value jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_kind   text;
  v_status text;
  v_human  jsonb;
  v_who    text := coalesce(auth.jwt() ->> 'email', '');
  v_key    text;
  v_val    jsonb;
  v_money  text[];
  v_areas  text[] := array['overall', 'time', 'money', 'quality', 'safety', 'scope'];
begin
  if not public.is_admin() then
    raise exception 'Only a signed-in Yaadly admin can type a result, a status or a figure on a report.' using errcode = '28000';
  end if;
  if v_who = '' then
    raise exception 'This has to carry the name of the person typing it, and this session has none.' using errcode = '28000';
  end if;

  select kind, status, human into v_kind, v_status, v_human
    from public.reports where id = p_report for update;
  if not found then
    raise exception 'No such report.' using errcode = 'check_violation';
  end if;
  if v_status = 'issued' then
    raise exception 'This report is issued. What the client holds is what was issued, so it cannot be changed now.' using errcode = 'check_violation';
  end if;

  if p_key = 'result' then
    if v_kind = 'technical_signoff' then
      if p_value #>> '{}' not in ('released', 'released_with_conditions', 'not_released') then
        raise exception 'A sign-off is released, released_with_conditions or not_released.' using errcode = 'check_violation';
      end if;
    elsif v_kind = 'pm_stage' then
      if p_value #>> '{}' not in ('complete', 'complete_with_items', 'not_complete') then
        raise exception 'A stage is complete, complete_with_items or not_complete.' using errcode = 'check_violation';
      end if;
    else
      raise exception 'Only a Technical Sign-off and a stage record carry a result.' using errcode = 'check_violation';
    end if;

  elsif p_key = 'status' then
    if v_kind <> 'oversight' then
      raise exception 'Only the monthly oversight report carries status ratings.' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(p_value) <> 'object' then
      raise exception 'Status is a set of areas, each rated.' using errcode = 'check_violation';
    end if;
    for v_key, v_val in select * from jsonb_each(p_value) loop
      if not (v_key = any (v_areas) or (v_key like 'last\_%' and substr(v_key, 6) = any (v_areas))) then
        raise exception 'Status is rated for overall, time, money, quality, safety and scope, this month and last. "%" is none of those.', v_key using errcode = 'check_violation';
      end if;
      if jsonb_typeof(v_val) <> 'null' and v_val #>> '{}' not in ('on_track', 'at_risk', 'off_track') then
        raise exception 'Each area is on_track, at_risk or off_track.' using errcode = 'check_violation';
      end if;
    end loop;

  elsif p_key = 'money' then
    v_money := case v_kind
      when 'oversight' then array['agreed_price', 'agreed_changes', 'paid_to_date', 'requested_unpaid', 'changes_pending', 'builder_forecast',
                                  'last_agreed_price', 'last_agreed_changes', 'last_paid_to_date', 'last_requested_unpaid', 'last_changes_pending', 'last_builder_forecast']
      when 'pm_stage'  then array['agreed_price', 'agreed_changes', 'prior_signed_off', 'this_stage', 'asked_for']
      else null end;
    if v_money is null then
      raise exception 'Only the monthly oversight report and a stage record carry money.' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(p_value) <> 'object' then
      raise exception 'Money is a set of named lines.' using errcode = 'check_violation';
    end if;
    for v_key, v_val in select * from jsonb_each(p_value) loop
      if v_key = 'currency' then
        if v_val #>> '{}' not in ('GBP', 'USD', 'CAD', 'JMD') then
          raise exception 'Currency is GBP, USD, CAD or JMD.' using errcode = 'check_violation';
        end if;
      elsif v_key = 'reason' then
        if jsonb_typeof(v_val) not in ('string', 'null') or public.has_measurement(coalesce(v_val #>> '{}', '')) then
          raise exception 'The reason is plain words, with no measurement.' using errcode = 'check_violation';
        end if;
      elsif v_key = any (v_money) then
        if jsonb_typeof(v_val) not in ('number', 'null') or (jsonb_typeof(v_val) = 'number' and (v_val #>> '{}')::numeric < 0) then
          raise exception '"%" is a sum of money, zero or more, or left empty.', v_key using errcode = 'check_violation';
        end if;
      else
        raise exception 'A % carries %, currency and reason. "%" is none of those.', replace(v_kind, '_', ' '), array_to_string(v_money, ', '), v_key
          using errcode = 'check_violation';
      end if;
    end loop;

  else
    raise exception 'A person types a result, a status or money on a report. "%" is none of those.', p_key using errcode = 'check_violation';
  end if;

  perform set_config('yaadly.human_write', 'on', true);
  update public.reports set human = jsonb_set(coalesce(human, '{}'::jsonb), array[p_key], p_value) where id = p_report;
  perform set_config('yaadly.human_write', 'off', true);

  insert into public.report_edits (report_id, target, before, after, edited_by)
  values (p_report, 'typed by hand: ' || p_key, v_human -> p_key, p_value, v_who);

  return (select human from public.reports where id = p_report);
end;
$$;

comment on function public.set_report_human is
  'The one door into reports.human: a result, status ratings, or money, typed by a named admin on a report not yet issued, checked against a fixed list, logged in report_edits.';

revoke all on function public.set_report_human(uuid, text, jsonb) from public, anon;
grant execute on function public.set_report_human(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------- rating

create or replace function public.report_stamp_rater()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.severity is distinct from old.severity and new.severity is not null then
    if not public.is_admin() then
      raise exception 'Only a signed-in admin can rate a finding.';
    end if;
    if not public.report_kind_is_rated((select kind from public.reports where id = new.report_id)) then
      raise exception 'This report records what was seen and does not rate it. That is what the client was sold: "They record. They do not rate or advise."'
        using errcode = 'check_violation';
    end if;
    new.rated_by := coalesce(auth.jwt() ->> 'email', new.rated_by);
    new.rated_at := now();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- issuing

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

    if public.report_kind_is_rated(new.kind) then
      select count(*) into unrated
        from public.report_findings f
       where f.report_id = new.id and f.severity is null;
      if unrated > 0 then
        raise exception
          '% finding(s) on this report are unrated. Severe, Moderate or Low is the professional judgment the client paid for, and nothing drafts it.', unrated;
      end if;
    end if;

    if new.kind in ('technical_signoff', 'pm_stage') and coalesce(new.human ->> 'result', '') = '' then
      raise exception 'This report has no result. Whether the work is released, or the stage complete, is decided by a person and typed at the desk before it can issue.';
    end if;
    if new.kind = 'oversight' and coalesce(new.human -> 'status' ->> 'overall', '') = '' then
      raise exception 'This report has no overall status for the month. A person rates it at the desk before it can issue.';
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

-- ---------------------------------------------------------------- the desk's list

create or replace view public.v_reports_open with (security_invoker = true) as
 select id,
    number,
    kind,
    status,
    client_name,
    property,
    visited_on,
    drafted_at,
    issued_at,
    ( select count(*) as count
           from report_findings f
          where f.report_id = r.id) as findings,
    ( select count(*) as count
           from report_findings f
          where f.report_id = r.id and f.severity is null) as unrated,
    verdict is null or length(btrim(coalesce(verdict, ''::text))) = 0 as needs_verdict,
    jsonb_array_length(coalesce(scrubbed, '[]'::jsonb)) as scrubbed,
    public.report_kind_is_rated(kind) as rated_kind,
    case
      when kind in ('technical_signoff', 'pm_stage') then coalesce(human ->> 'result', '') = ''
      when kind = 'oversight' then coalesce(human -> 'status' ->> 'overall', '') = ''
      else false
    end as needs_decision
   from reports r;
