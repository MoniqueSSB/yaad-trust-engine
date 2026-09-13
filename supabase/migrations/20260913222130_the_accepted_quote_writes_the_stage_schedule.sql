-- The accepted quote writes the job's stage schedule.
-- Founder instruction, 13 September 2026: "the quote pack should have made
-- the payment terms, invoice plans and stage schedule, it needs to do that."
-- Piece 1 of 4 (see DECISIONS.md, same date): the stage schedule. Billing
-- choice on the quote, drafted invoices and the payment plan follow.
--
-- WHAT WAS WRONG, found on JOB-WEB-1789253807959, the verandah job:
--
--   1. The schedule only ever came from an AI Quote Pack draft or a Kickoff
--      Pack. Since 9 Sep the WORKER'S OWN QUOTE, stages included, is what the
--      client accepts, and nothing turned those stages into a schedule. Even
--      with a working drafter the schedule could differ from what was agreed.
--   2. The drafter has failed on every job since 7 Sep (minimax 429), so no
--      job had a schedule at all.
--   3. With no schedule, job_final_stage_count() said one stage while
--      raise_job_stage_worker_payable() paid 25% on stage 1 and 75% on a
--      stage 2 that never comes: a finished job recorded the worker as owed a
--      quarter of their labour.
--   4. sync_job_status() read the stage count from Kickoff Packs only, so a
--      correct Quote Pack schedule still completed the job after stage 1.
--
-- WHAT THIS DOES:
--
--   parse_payment_stages()   reads "Name: 30%: proof", one per line. A
--                            schedule is accepted only if every line reads and
--                            the percentages total exactly the whole. The same
--                            rule is web/lib/jobs/payment-stages.ts.
--   on acceptance            the accepted quote's own stages become the job's
--                            approved Quote Pack, approved_by the client's
--                            acceptance. Everything downstream already reads
--                            that slot. An older approved AI draft on the job
--                            steps back to 'ready'. An approved Kickoff Pack,
--                            where one exists, still wins, as before.
--   job_final_stage_count()  reads the newest approved Quote Pack, not any.
--   sync_job_status()        reads job_final_stage_count(), so completion and
--                            worker pay count stages the same way.
--   no schedule at all       one stage, and the worker is owed the whole
--                            labour less 5% when it is approved. Founder
--                            decision, 13 Sep 2026, over the 25/75 default.
--   new quotes               refused if the stages are written but cannot be
--                            read. Existing quotes are not re-checked unless
--                            their stage text is edited.
--   the verandah job         and any other booked, unfinished job in the same
--                            state, gets its schedule from its accepted quote.
--
-- Nothing here releases money, raises an invoice or moves a job forward. The
-- client still approves every stage; a named human still decides every
-- release. No model is involved: the schedule is what two people agreed.
--
-- Applied to production: not yet. Waiting on Monique's "apply".

begin;

-- ── the reader ─────────────────────────────────────────────────────────────
-- A stage name may not contain a colon (the colon is the separator); the
-- proof may. Up to ten stages. Returns null for anything it cannot read, so
-- a caller can never mistake a half-read schedule for a whole one.
create or replace function public.parse_payment_stages(p_text text)
returns jsonb
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_line  text;
  v_m     text[];
  v_pct   numeric;
  v_total numeric := 0;
  v_n     integer := 0;
  v_out   jsonb := '[]'::jsonb;
begin
  if p_text is null then
    return null;
  end if;

  foreach v_line in array regexp_split_to_array(p_text, E'\r?\n') loop
    v_line := btrim(v_line, E' \t');
    continue when v_line = '';

    v_m := regexp_match(
      v_line,
      '^([^:]*[^:[:space:]])[[:space:]]*:[[:space:]]*([0-9]{1,3}(?:\.[0-9]{1,2})?)[[:space:]]*%[[:space:]]*:[[:space:]]*(.*[^[:space:]])[[:space:]]*$'
    );
    if v_m is null then
      return null;
    end if;

    v_pct := v_m[2]::numeric;
    if v_pct <= 0 then
      return null;
    end if;

    v_total := v_total + v_pct;
    v_n := v_n + 1;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'stage', btrim(v_m[1]),
      'proportion_percent', v_pct,
      'evidence_note', v_m[3]
    ));
  end loop;

  if v_n = 0 or v_n > 10 or v_total <> 100 then
    return null;
  end if;
  return v_out;
end;
$function$;

comment on function public.parse_payment_stages(text) is
  'Reads a quote''s payment stages ("Name: 30%: proof", one per line) into the Quote Pack shape. Null unless every line reads and the percentages total the whole. Mirrored by web/lib/jobs/payment-stages.ts.';

-- ── writing the schedule ───────────────────────────────────────────────────
create or replace function public.write_stage_schedule_from_quote(p_quote uuid, p_approved_by text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_quote  public.job_quotes%rowtype;
  v_stages jsonb;
  v_id     uuid;
begin
  select * into v_quote from public.job_quotes where id = p_quote;
  if v_quote.id is null or v_quote.status <> 'accepted' then
    return null;
  end if;

  -- A Kickoff Pack, where both sides confirmed one, is the fuller agreement
  -- and stays the schedule, exactly as before.
  if exists (
    select 1 from public.kickoff_packs k
     where k.job_id = v_quote.job_id and k.status = 'approved'
  ) then
    return null;
  end if;

  v_stages := public.parse_payment_stages(v_quote.payment_stage_note);
  if v_stages is null then
    return null;
  end if;

  update public.quote_pack_drafts
     set status = 'ready'
   where job_id = v_quote.job_id and status = 'approved';

  insert into public.quote_pack_drafts (job_id, status, docs, model, guardrail, approved_by, approved_at, finished_at)
  values (
    v_quote.job_id, 'approved',
    jsonb_build_object(
      'source', 'accepted_quote',
      'quote_id', v_quote.id,
      'scope_summary', coalesce(v_quote.scope_summary, ''),
      'included', to_jsonb(array_remove(regexp_split_to_array(btrim(coalesce(v_quote.included_note, '')), E'[[:space:]]*\r?\n[[:space:]]*'), '')),
      'excluded', to_jsonb(array_remove(regexp_split_to_array(btrim(coalesce(v_quote.excluded_note, '')), E'[[:space:]]*\r?\n[[:space:]]*'), '')),
      'rough_timeline', coalesce(v_quote.timeline_note, ''),
      'payment_stages', v_stages
    ),
    null, null, p_approved_by, now(), now()
  )
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.write_stage_schedule_from_quote(uuid, text) from public, anon, authenticated;

create or replace function public.accepted_quote_writes_schedule()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_client text;
begin
  if new.status is distinct from 'accepted' or old.status = 'accepted' then
    return new;
  end if;

  -- Never let the schedule stop a booking. A failure here is logged and the
  -- job falls back to one stage, which is visible on the job, not silent.
  begin
    select lower(client_email) into v_client from public.jobs where id = new.job_id;
    if public.write_stage_schedule_from_quote(new.id, 'client acceptance: ' || coalesce(v_client, 'the client')) is null then
      raise warning 'accepted quote % on job % wrote no stage schedule (unreadable stages, or a Kickoff Pack holds it)', new.id, new.job_id;
    end if;
  exception when others then
    raise warning 'accepted_quote_writes_schedule(%) failed: %', new.id, sqlerrm;
  end;
  return new;
end;
$function$;

-- Named to sort before trg_touch_job_on_quote_change, so the schedule is in
-- place before the job row is touched and re-synced.
drop trigger if exists trg_accepted_quote_writes_schedule on public.job_quotes;
create trigger trg_accepted_quote_writes_schedule
  after update of status on public.job_quotes
  for each row execute function public.accepted_quote_writes_schedule();

-- ── refusing stages that cannot be read ────────────────────────────────────
-- A trigger rather than a CHECK: a NOT VALID check would still bite the next
-- time any old quote was updated for another reason, such as being accepted.
create or replace function public.quote_payment_stages_readable()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if btrim(coalesce(new.payment_stage_note, '')) <> ''
     and (tg_op = 'INSERT' or new.payment_stage_note is distinct from old.payment_stage_note)
     and public.parse_payment_stages(new.payment_stage_note) is null then
    raise exception 'Your payment stages could not be read. Write one per line as Stage name: 30%%: what proves it is done, with the percentages adding up to the whole price.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_quote_payment_stages_readable on public.job_quotes;
create trigger trg_quote_payment_stages_readable
  before insert or update of payment_stage_note on public.job_quotes
  for each row execute function public.quote_payment_stages_readable();

-- ── one stage count, read the same way everywhere ──────────────────────────
create or replace function public.job_final_stage_count(p_job text)
returns integer
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select jsonb_array_length(p.docs->'payment_schedule'->'stages')
       from public.kickoff_packs p
      where p.job_id = p_job and p.status = 'approved'
      order by p.updated_at desc limit 1),
    (select jsonb_array_length(d.docs->'payment_stages')
       from public.quote_pack_drafts d
      where d.job_id = p_job and d.status = 'approved'
      order by d.approved_at desc nulls last, d.created_at desc
      limit 1),
    1);
$function$;

-- As live, with one change: the final stage count comes from
-- job_final_stage_count() instead of Kickoff Packs alone.
create or replace function public.sync_job_status()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  has_quotes boolean;
  working_stage integer;
  has_unapproved_evidence boolean;
  final_stage_count integer;
  is_complete boolean;
  fee_paid boolean;
begin
  if new.status in ('disputed','cancelled') then
    return new;
  end if;

  if coalesce(new.worker_email,'') <> '' then
    select exists (
      select 1 from public.invoices i
       where i.job_id = new.id and i.stage is null and i.status = 'paid'
    ) into fee_paid;

    if not fee_paid then
      new.status := 'awaiting_payment';
      return new;
    end if;

    final_stage_count := public.job_final_stage_count(new.id);

    is_complete := coalesce(new.stage, 0) > coalesce(final_stage_count, 1);

    if is_complete then
      new.status := 'complete';
    else
      working_stage := greatest(coalesce(new.stage, 0), 1);
      select exists (
        select 1 from public.evidence e
         where e.job_id = new.id and coalesce(e.stage, 1) = working_stage
      ) and not exists (
        select 1 from public.stage_approvals a
         where a.job_id = new.id and a.stage = working_stage
      ) into has_unapproved_evidence;

      new.status := case when has_unapproved_evidence then 'evidence' else 'in_progress' end;
    end if;
  elsif new.open then
    select exists (select 1 from public.job_quotes q
                    where q.job_id = new.id and q.status in ('submitted', 'quote_confirmed', 'kickoff_requested'))
      into has_quotes;
    new.status := case when has_quotes then 'quoted' else 'open_for_quotes' end;
  elsif public.client_cleared_for_golive(new.client_email) then
    new.status := 'draft';
  else
    new.status := 'awaiting_client_setup';
  end if;

  return new;
end;
$function$;

-- As live, with two changes: the Quote Pack read takes the newest approved
-- one, and with no schedule at all stage 1 is the whole job (founder
-- decision, 13 Sep 2026), matching job_final_stage_count()'s one stage.
create or replace function public.raise_job_stage_worker_payable(p_job text, p_stage integer)
returns table(invoice_id text, total_jmd integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job           jobs%rowtype;
  v_quote         job_quotes%rowtype;
  v_stage_name    text;
  v_pct           numeric;
  v_from_pack     boolean := true;
  v_has_materials boolean;
  v_labour_amt    integer;
  v_margin        integer;
  v_rate          integer;
  v_materials_amt integer;
  v_amount        integer;
  v_id            text;
  v_desc          text;
begin
  select * into v_job from jobs where id = p_job;
  if v_job.id is null then return; end if;

  select * into v_quote from job_quotes where job_id = p_job and status = 'accepted';
  if v_quote.id is null then return; end if;

  if coalesce(v_quote.worker_email, '') = '' then return; end if;

  if exists (
    select 1 from invoices i
     where i.job_id = p_job and i.payable_to = 'worker' and i.stage = p_stage and i.status <> 'void'
  ) then
    return;
  end if;

  select p.docs -> 'payment_schedule' -> 'stages' -> (p_stage - 1) ->> 'stage',
         (p.docs -> 'payment_schedule' -> 'stages' -> (p_stage - 1) ->> 'proportion_percent')::numeric
    into v_stage_name, v_pct
    from kickoff_packs p
   where p.job_id = p_job and p.status = 'approved'
   order by p.updated_at desc
   limit 1;

  if v_pct is null then
    select q.docs -> 'payment_stages' -> (p_stage - 1) ->> 'stage',
           (q.docs -> 'payment_stages' -> (p_stage - 1) ->> 'proportion_percent')::numeric
      into v_stage_name, v_pct
      from quote_pack_drafts q
     where q.job_id = p_job and q.status = 'approved'
     order by q.approved_at desc nulls last, q.created_at desc
     limit 1;
  end if;

  if v_pct is null then
    v_from_pack := false;
    if p_stage = 1 then
      v_pct := 100;
      v_stage_name := 'The whole job';
    else
      return;
    end if;
  end if;

  v_labour_amt := round(coalesce(v_quote.labour_jmd, 0) * v_pct / 100);
  v_margin     := round(v_labour_amt * 0.05);
  v_rate       := v_labour_amt - v_margin;

  select exists (
    select 1 from evidence e
     where e.job_id = p_job and coalesce(e.stage, 1) = p_stage and e.kind = 'materials'
  ) into v_has_materials;
  v_materials_amt := case when v_has_materials then coalesce(v_quote.materials_jmd, 0) else 0 end;

  v_amount := v_rate + v_materials_amt;
  if v_amount <= 0 then return; end if;

  v_desc := coalesce(v_stage_name, 'Stage ' || p_stage);
  v_id := public.new_invoice_number();

  insert into public.invoices (id, client_name, client_email, worker_email, job_id, stage, drafted_by, currency, period_label, payable_to, notes)
  values (v_id, 'Yaadly Ltd', 'payable@yaadly.invalid', v_quote.worker_email, p_job, p_stage, 'human', 'JMD', v_desc, 'worker',
    'What Yaadly owes ' || coalesce(v_quote.worker_name, 'the tradesperson') || ' for "' || v_desc || '," raised the moment the client approved this stage. '
      || 'Their quoted labour for this stage less the agreed 5%'
      || (case when v_has_materials then ', plus materials at cost with nothing deducted' else '' end) || '.'
      || (case when v_from_pack then '' else ' No payment schedule was on file for this job, so it was treated as one stage: the whole job.' end)
      || ' Yaadly pays this directly. The client is not a party to it.');

  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_id, null, v_job.title || ', ' || coalesce(v_quote.worker_name, 'tradesperson') || ', ' || v_desc || ', agreed rate', 1, v_rate, 'manual');
  if v_materials_amt > 0 then
    insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
    values (v_id, null, 'Materials, at cost, nothing deducted', 1, v_materials_amt, 'manual');
  end if;

  update public.invoices set status = 'sent' where id = v_id;

  return query select v_id, v_amount;
end $function$;

-- ── repair: booked, unfinished jobs with no schedule ───────────────────────
do $$
declare
  r record;
begin
  for r in
    select q.id as quote_id, lower(j.client_email) as client_email
      from public.jobs j
      join public.job_quotes q on q.job_id = j.id and q.status = 'accepted'
     where coalesce(j.worker_email, '') <> ''
       and j.status <> 'complete'
       and not exists (select 1 from public.kickoff_packs k where k.job_id = j.id and k.status = 'approved')
       and not exists (select 1 from public.quote_pack_drafts d where d.job_id = j.id and d.status = 'approved')
       and public.parse_payment_stages(q.payment_stage_note) is not null
  loop
    perform public.write_stage_schedule_from_quote(
      r.quote_id,
      'client acceptance: ' || coalesce(r.client_email, 'the client') || ' (schedule written 13 Sep 2026 from the quote they accepted)'
    );
  end loop;
end $$;

commit;
