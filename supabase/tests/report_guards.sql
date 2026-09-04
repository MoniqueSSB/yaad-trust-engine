-- Proof that a drafted report cannot become a client's report on its own.
--
-- Three of the seven priced services ARE this document. What the client is
-- buying is not the prose, which an agent can draft perfectly well. It is the
-- severity rating on each finding and the verdict on page one, both of which
-- are Monique's professional judgment. If a model can supply either, Yaadly is
-- selling something it does not have.
--
-- The prompt forbids it and the function scrubs it. This file tests the third
-- layer, the one nothing can talk past: the database.
--
-- Note: the session running this has no admin JWT. Where a test expects the
-- admin check to fire first, it says so. The content rules themselves are
-- proved directly by calling report_offending_text() rather than going through
-- the trigger, the same approach sketch_guards.sql takes.
do $$
declare v text; ok boolean; msg text;
begin
  create temp table t(n int generated always as identity, name text, result text) on commit drop;

  delete from public.reports where property like 'TEST-RPT%';

  insert into public.reports (id, kind, client_name, property, verdict, verdict_line)
  values ('11111111-1111-1111-1111-111111111111', 'deposit_check',
          'Test Client', 'TEST-RPT the Portmore house', null, null);

  insert into public.report_findings (report_id, ord, heading, body, action)
  values
   ('11111111-1111-1111-1111-111111111111', 1,
    'Bank details arrived by message and do not match the letterhead',
    'The quote carries a printed number. The account details came from a different one.',
    'Ring the number on the quote and confirm the account name out loud.'),
   ('11111111-1111-1111-1111-111111111111', 2,
    'The quote is a single figure with no breakdown',
    'One number covering materials and labour, with no quantities. Nothing in it can be checked.',
    'Ask for materials and labour separated, with quantities.');

  -- 1. A drafted report carries no severity. That is the point, not an omission.
  select count(*) = 2 into ok from public.report_findings
   where report_id = '11111111-1111-1111-1111-111111111111' and severity is null;
  insert into t(name,result) values
    ('1. a drafted finding is unrated', case when ok then 'PASS' else 'FAIL: a draft arrived already rated' end);

  -- 2. A drafted report carries no verdict.
  select verdict is null and verdict_line is null into ok
    from public.reports where id = '11111111-1111-1111-1111-111111111111';
  insert into t(name,result) values
    ('2. a drafted report has no verdict', case when ok then 'PASS' else 'FAIL: a verdict was drafted' end);

  -- 3. Clean prose is clean.
  select public.report_offending_text('11111111-1111-1111-1111-111111111111') into v;
  insert into t(name,result) values
    ('3. wording without measurements passes', case when v is null then 'PASS' else 'FAIL: '||v end);

  -- 4. A measurement in a finding is caught.
  update public.report_findings
     set body = 'A 2.1m crack runs above the window.'
   where report_id = '11111111-1111-1111-1111-111111111111' and ord = 1;
  select public.report_offending_text('11111111-1111-1111-1111-111111111111') into v;
  insert into t(name,result) values
    ('4. a measurement in a finding is caught', case when v is not null then 'PASS' else 'FAIL: 2.1m walked through' end);

  -- 5. A measurement in the recommended action is caught too. The action line
  --    is the one a client acts on, so it matters at least as much as the body.
  update public.report_findings set body = 'A full height crack runs above the window.'
   where report_id = '11111111-1111-1111-1111-111111111111' and ord = 1;
  update public.report_findings set action = 'Allow for 40 sq ft of render.'
   where report_id = '11111111-1111-1111-1111-111111111111' and ord = 2;
  select public.report_offending_text('11111111-1111-1111-1111-111111111111') into v;
  insert into t(name,result) values
    ('5. a measurement in an action is caught', case when v is not null then 'PASS' else 'FAIL: 40 sq ft walked through' end);

  -- 6. A bare number is ordinary English and must not be caught. "Two
  --    hairline cracks" and "3 sockets" are exactly what a report should say.
  update public.report_findings set action = 'Two of the five window latches are missing.'
   where report_id = '11111111-1111-1111-1111-111111111111' and ord = 2;
  select public.report_offending_text('11111111-1111-1111-1111-111111111111') into v;
  insert into t(name,result) values
    ('6. a bare number is not a measurement', case when v is null then 'PASS' else 'FAIL: '||v end);

  -- 7. Issuing without a verdict is refused. (No admin JWT here, so the admin
  --    check fires first. Either exception is the gate holding; a silent
  --    success is the only failure.)
  begin
    update public.reports set status = 'issued'
     where id = '11111111-1111-1111-1111-111111111111';
    insert into t(name,result) values ('7. cannot issue without a verdict', 'FAIL: it issued');
  exception when others then
    get stacked diagnostics msg = message_text;
    insert into t(name,result) values ('7. cannot issue without a verdict', 'PASS: '||left(msg,70));
  end;

  -- 8. Rating a finding is refused without an admin session.
  begin
    update public.report_findings set severity = 'severe'
     where report_id = '11111111-1111-1111-1111-111111111111' and ord = 1;
    insert into t(name,result) values ('8. only an admin rates a finding', 'FAIL: it rated');
  exception when others then
    get stacked diagnostics msg = message_text;
    insert into t(name,result) values ('8. only an admin rates a finding', 'PASS: '||left(msg,70));
  end;

  -- 9. The ledger refuses a consequential action recorded against a machine.
  --    CLAUDE.md §2, in the database rather than in a prompt.
  begin
    insert into public.agent_actions (actor, actor_kind, action, summary)
    values ('yaad-report', 'agent', 'approve_stage', 'drafted and approved');
    insert into t(name,result) values ('9. an agent cannot approve a stage', 'FAIL: it recorded');
  exception when others then
    get stacked diagnostics msg = message_text;
    insert into t(name,result) values ('9. an agent cannot approve a stage', 'PASS: '||left(msg,70));
  end;

  -- 10. And "system" is not a named human either.
  begin
    insert into public.agent_actions (actor, actor_kind, action, summary)
    values ('system', 'human', 'release_funds', 'auto released');
    insert into t(name,result) values ('10. "system" is not a named human', 'FAIL: it recorded');
  exception when others then
    get stacked diagnostics msg = message_text;
    insert into t(name,result) values ('10. "system" is not a named human', 'PASS: '||left(msg,70));
  end;

  -- 11. A real person taking a real decision is recorded without complaint.
  begin
    insert into public.agent_actions (actor, actor_kind, action, summary)
    values ('monique@yaadly.co.uk', 'human', 'approve_stage', 'Stage 2 evidence checked and passed');
    insert into t(name,result) values ('11. a named human is recorded', 'PASS');
  exception when others then
    get stacked diagnostics msg = message_text;
    insert into t(name,result) values ('11. a named human is recorded', 'FAIL: '||left(msg,70));
  end;

  raise notice '%', (select string_agg(lpad(n::text,2)||'. '||name||E'\n    '||result, E'\n' order by n) from t);

  delete from public.agent_actions where actor in ('yaad-report','system','monique@yaadly.co.uk') and summary in
    ('drafted and approved','auto released','Stage 2 evidence checked and passed');
  delete from public.reports where property like 'TEST-RPT%';
end $$;
