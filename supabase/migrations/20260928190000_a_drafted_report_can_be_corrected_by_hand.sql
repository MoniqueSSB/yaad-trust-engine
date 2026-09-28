-- A drafted report can be corrected by hand, line by line.
--
-- Monique, 28 September 2026: "can this be edited when it is generated", then
-- "2", choosing the desk edit over typing on the printed page. Until today a
-- wrong line in a drafted report had one fix, which was to correct the notes
-- and draft the whole report again, and RUNBOOK §30 said so on purpose: "a
-- finding cannot be edited in place by design, because an edited finding is
-- no longer the screened one."
--
-- This keeps the reason and removes the obstacle. An edit is screened at the
-- door the same way a draft is, so an edited line is a screened line again:
--
--   * a signed-in admin only, stamped with who and when
--   * never on an issued report: what the client holds is what was issued
--   * never a sum of money or a measurement (has_figure, has_measurement, the
--     same two rules the issue gate reads). The banned-language screen runs in
--     yaad-report before the desk calls this, because that list lives in two
--     runtimes already and a third copy here would be the one that drifts
--   * every change logged in report_edits, before and after, so the agent's
--     own wording is never lost and the desk can show what was changed by hand
--
-- What it cannot touch: the rating (rate_finding does that), the verdict
-- (write_report_verdict), the quote as the builder wrote it, and the
-- transcript. The last two are the record of what the documents said; a
-- misread there is corrected in the notes and drafted again.

create table if not exists public.report_edits (
  id         bigint generated always as identity primary key,
  report_id  uuid not null references public.reports(id) on delete cascade,
  target     text not null,
  before     jsonb,
  after      jsonb,
  edited_by  text not null,
  edited_at  timestamptz not null default now()
);
create index if not exists report_edits_report_idx on public.report_edits (report_id, edited_at);

alter table public.report_edits enable row level security;
drop policy if exists "admin reads report edits" on public.report_edits;
create policy "admin reads report edits" on public.report_edits
  for select to authenticated using (public.is_admin());
-- No insert, update or delete policy: the log is written only by
-- edit_report() below, as definer, and nobody rewrites it afterwards.
revoke all on public.report_edits from anon;

comment on table public.report_edits is
  'Every hand correction to a drafted report: what it said, what it says now, who and when. Written only by edit_report(). 20260928190000.';

-- p_part names the part of the report; p_index is the 1 based item in a list
-- (the finding number for a finding); p_field names the field of that item.
-- p_index null on a list part adds a new item. Empty text on a list item
-- removes it. Returns the index written, so the desk can fill in the other
-- fields of an item it has just added.
create or replace function public.edit_report(
  p_report uuid, p_part text, p_index integer, p_field text, p_text text
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status   text;
  v_sections jsonb;
  v_text     text := btrim(coalesce(p_text, ''));
  v_who      text := coalesce(auth.jwt() ->> 'email', '');
  v_list     jsonb;
  v_before   jsonb;
  v_after    jsonb;
  v_idx      integer;
  v_target   text;
  v_fields   text[];
  v_addable  boolean;
begin
  if not public.is_admin() then
    raise exception 'Only a signed-in Yaadly admin can correct a report.' using errcode = '28000';
  end if;
  if v_who = '' then
    raise exception 'A correction has to carry the name of the person making it, and this session has none.' using errcode = '28000';
  end if;

  select status, coalesce(sections, '{}'::jsonb) into v_status, v_sections
    from public.reports where id = p_report for update;
  if not found then
    raise exception 'No such report.' using errcode = 'check_violation';
  end if;
  if v_status = 'issued' then
    raise exception 'This report is issued. What the client holds is what was issued, so it cannot be changed now.' using errcode = 'check_violation';
  end if;

  if v_text <> '' and public.has_measurement(v_text) then
    raise exception 'That states a measurement, which Yaadly does not produce. Describe it without the size.' using errcode = 'check_violation';
  end if;
  if v_text <> '' and public.has_figure(v_text) then
    raise exception 'That states a sum of money. If a figure belongs in the report, it goes in the verdict, where it is your judgment. Describe the shape of the arrangement here instead.' using errcode = 'check_violation';
  end if;

  -- ── A finding: its wording, and where it came from ──
  if p_part = 'finding' then
    if p_field = 'source' then
      v_list := coalesce(v_sections -> 'finding_refs', '[]'::jsonb);
      select i - 1 into v_idx from jsonb_array_elements(v_list) with ordinality as t(e, i)
       where (e ->> 'ord')::int = p_index limit 1;
      v_target := format('red flag %s, source', p_index);
      if v_idx is null then
        v_before := null;
        v_list := v_list || jsonb_build_object('ord', p_index, 'source', v_text, 'lines', '[]'::jsonb);
      else
        v_before := v_list -> v_idx -> 'source';
        v_list := jsonb_set(v_list, array[v_idx::text, 'source'], to_jsonb(v_text));
      end if;
      update public.reports set sections = jsonb_set(v_sections, '{finding_refs}', v_list) where id = p_report;
      v_after := to_jsonb(v_text);
    elsif p_field in ('heading', 'body', 'why', 'action') then
      if p_field in ('heading', 'body') and v_text = '' then
        raise exception 'A red flag needs a heading and a body. Write the replacement.' using errcode = 'check_violation';
      end if;
      execute format('select to_jsonb(%I) from public.report_findings where report_id = $1 and ord = $2', p_field)
        into v_before using p_report, p_index;
      execute format('update public.report_findings set %I = nullif($3, %L) where report_id = $1 and ord = $2', p_field, '')
        using p_report, p_index, v_text;
      if not found then
        raise exception 'There is no red flag %.', p_index using errcode = 'check_violation';
      end if;
      v_target := format('red flag %s, %s', p_index, p_field);
      v_after := to_jsonb(v_text);
    else
      raise exception 'A red flag has a heading, a body, a why, an action and a source. "%" is none of those.', p_field using errcode = 'check_violation';
    end if;

  -- ── One piece of text ──
  elsif p_part in ('ask_the_builder', 'checked', 'next_payment') then
    v_before := v_sections -> p_part;
    update public.reports set sections = jsonb_set(v_sections, array[p_part], to_jsonb(v_text)) where id = p_report;
    v_target := replace(p_part, '_', ' ');
    v_after := to_jsonb(v_text);

  elsif p_part = 'glance' then
    if p_field not in ('proposed', 'proposed_detail', 'ours', 'ours_detail') then
      raise exception 'The page one summary has proposed, proposed_detail, ours and ours_detail.' using errcode = 'check_violation';
    end if;
    v_before := v_sections -> 'glance' -> p_field;
    update public.reports
       set sections = jsonb_set(jsonb_set(v_sections, '{glance}', coalesce(v_sections -> 'glance', '{}'::jsonb)), array['glance', p_field], to_jsonb(v_text))
     where id = p_report;
    v_target := 'at a glance, ' || replace(p_field, '_', ' ');
    v_after := to_jsonb(v_text);

  -- ── A list: a column of the report, or a list inside its sections ──
  else
    v_fields := case p_part
      when 'next_steps'        then array['step', 'who', 'when']
      when 'payment_terms'     then array['proposed', 'instead', 'why']
      when 'payment_stages'    then array['stage', 'when', 'evidence']
      when 'get_before_paying' then array['document']
      when 'documents'         then array['what', 'dated', 'form']
      when 'checklist'         then array['note', 'state']
      when 'scope_included'    then array[]::text[]
      when 'scope_not_stated'  then array[]::text[]
      when 'questions'         then array[]::text[]
      when 'omitted'           then array[]::text[]
      else null
    end;
    if v_fields is null then
      raise exception 'The report has no part called "%".', p_part using errcode = 'check_violation';
    end if;
    -- The payment terms and the checklist are fixed lists, the house
    -- standard: a line can be reworded but not added or taken away.
    v_addable := p_part not in ('payment_terms', 'checklist');
    if cardinality(v_fields) > 0 and not (p_field = any (v_fields)) then
      raise exception 'Each item in % has %. "%" is none of those.', replace(p_part, '_', ' '), array_to_string(v_fields, ', '), p_field
        using errcode = 'check_violation';
    end if;
    if p_part = 'checklist' and p_field = 'state'
       and v_text not in ('provided', 'confirmed', 'not_provided', 'not_found', 'referred', 'not_applicable') then
      raise exception 'A checklist line is provided, confirmed, not_provided, not_found, referred or not_applicable.' using errcode = 'check_violation';
    end if;

    if p_part in ('questions', 'omitted') then
      execute format('select coalesce(%I, %L::jsonb) from public.reports where id = $1', p_part, '[]') into v_list using p_report;
    else
      v_list := coalesce(v_sections -> p_part, '[]'::jsonb);
    end if;

    if p_index is null then
      -- Add an item at the end.
      if not v_addable then
        raise exception 'That list (%) is the house standard and fixed in length. Reword a line instead.', replace(p_part, '_', ' ') using errcode = 'check_violation';
      end if;
      if v_text = '' then
        raise exception 'Nothing to add. Type the new line.' using errcode = 'check_violation';
      end if;
      v_list := v_list || case when cardinality(v_fields) = 0 then to_jsonb(v_text)
                               else jsonb_build_object(p_field, v_text) end;
      v_idx := jsonb_array_length(v_list);
      v_before := null;
      v_after := v_list -> (v_idx - 1);
      v_target := format('%s, item %s added', replace(p_part, '_', ' '), v_idx);
    else
      if p_index < 1 or p_index > jsonb_array_length(v_list) then
        raise exception 'There is no item % in %.', p_index, replace(p_part, '_', ' ') using errcode = 'check_violation';
      end if;
      v_idx := p_index;
      v_before := v_list -> (p_index - 1);
      if v_text = '' and (cardinality(v_fields) = 0 or p_field = v_fields[1]) and v_addable then
        -- Emptying the main line of an item removes the item.
        v_list := v_list - (p_index - 1);
        v_after := null;
        v_target := format('%s, item %s removed', replace(p_part, '_', ' '), p_index);
      else
        if cardinality(v_fields) = 0 then
          if v_text = '' then
            raise exception 'This line cannot be empty.' using errcode = 'check_violation';
          end if;
          v_list := jsonb_set(v_list, array[(p_index - 1)::text], to_jsonb(v_text));
        else
          v_list := jsonb_set(v_list, array[(p_index - 1)::text, p_field], to_jsonb(v_text));
        end if;
        v_after := v_list -> (p_index - 1);
        v_target := format('%s, item %s%s', replace(p_part, '_', ' '), p_index,
                           case when cardinality(v_fields) > 0 then ', ' || p_field else '' end);
      end if;
    end if;

    if p_part in ('questions', 'omitted') then
      execute format('update public.reports set %I = $2 where id = $1', p_part) using p_report, v_list;
    else
      update public.reports set sections = jsonb_set(v_sections, array[p_part], v_list) where id = p_report;
    end if;
  end if;

  insert into public.report_edits (report_id, target, before, after, edited_by)
  values (p_report, v_target, v_before, v_after, v_who);

  return case when p_part = 'finding' then p_index else coalesce(v_idx, p_index) end;
end $$;

revoke execute on function public.edit_report(uuid, text, integer, text, text) from anon, public;
grant  execute on function public.edit_report(uuid, text, integer, text, text) to authenticated;

comment on function public.edit_report(uuid, text, integer, text, text) is
  'Hand correction of one line of a drafted, unissued report, by a signed-in admin. Refuses sums of money and measurements; banned language is screened by yaad-report before the desk calls this. Logs before and after to report_edits. 20260928190000.';
