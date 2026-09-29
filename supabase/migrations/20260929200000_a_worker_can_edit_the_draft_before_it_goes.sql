-- A worker can open the report draft, change the words, and send it.
--
-- Founder, 29 Sep 2026. She tested a stage for real and the draft offered to
-- the worker said a beam had been secured and every task completed, where the
-- worker had written "fixing beam in place". The draft is now held to his own
-- words (yaad-notify-client/report-draft.ts), and this is the other half: a
-- way to correct it that a person on a phone will actually use. Until now the
-- choice was reply 1, or type the whole report again from nothing.
--
-- WHAT THIS IS
--   One row per job: the draft that is waiting on the worker, and the code
--   that opens it. yaad-notify-client writes the row when it drafts. The page
--   at /draft/<job>?code=<code> reads it with no login, the same pattern as
--   the Completion Report link (20260928233000): the code is the key, it is
--   checked here in Postgres, a wrong one counts, and ten lock the link.
--
-- WHAT THIS IS NOT
--   A new way for anything to reach a client. Sending from the page goes
--   through relay_confirmed_report(), the same door a reply of 1 and a typed
--   version have always gone through. Nothing is sent until the worker
--   presses Send, a draft can be sent once, and a newer draft on the same job
--   replaces the row and its code, so an old link opens nothing.
--
-- It moves no money, approves no stage and touches no Yaad Score.

create table if not exists public.report_draft_links (
  job_id       text primary key references public.jobs(id) on delete cascade,
  stage        integer not null default 1,
  code         text not null check (code ~ '^[0-9A-F]{24}$'),
  draft_text   text not null,
  captions     text[] not null default '{}',
  ai_summary   text not null default '',
  -- The worker's WhatsApp number, so that sending from the page also clears
  -- the draft waiting in the chat and "1" cannot send it a second time.
  phone        text not null default '',
  code_failures integer not null default 0,
  drafted_at   timestamptz not null default now(),
  sent_at      timestamptz,
  sent_via     text check (sent_via in ('link','whatsapp'))
);

comment on table public.report_draft_links is
  'The report draft waiting on a worker, and the code that opens its edit page. One row per job, replaced by each new draft. Written by yaad-notify-client on the service role.';

alter table public.report_draft_links enable row level security;
drop policy if exists "admin reads report draft links" on public.report_draft_links;
create policy "admin reads report draft links" on public.report_draft_links
  for select using (public.is_admin());
revoke all on public.report_draft_links from anon, authenticated;
grant select on public.report_draft_links to authenticated;
grant all on public.report_draft_links to service_role;

-- One check for both doors. Returns false rather than raising, because a
-- raised error rolls the call back, the failure count with it, and the lock
-- would never close.
create or replace function public._report_draft_code_check(p_job text, p_code text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v public.report_draft_links%rowtype;
begin
  select * into v from public.report_draft_links where job_id = p_job for update;
  if not found or v.code_failures >= 10 then return false; end if;
  if upper(btrim(coalesce(p_code, ''))) <> v.code then
    update public.report_draft_links set code_failures = code_failures + 1 where job_id = p_job;
    return false;
  end if;
  return true;
end $$;
revoke execute on function public._report_draft_code_check(text, text) from public, anon, authenticated;

create or replace function public._report_draft_refusal(p_job text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object('error', case
    when (select code_failures from public.report_draft_links where job_id = p_job) >= 10
      then 'This link is locked after too many wrong tries. Message Yaadly for a new one.'
    else 'That link is not valid, or it is out of date. Open the latest link from your WhatsApp.' end);
$$;
revoke execute on function public._report_draft_refusal(text) from public, anon, authenticated;

-- What the page shows: the draft, the worker's own captions it was written
-- from, and the job's title. No address, no contact details, no money.
create or replace function public.report_draft_for_code(p_job text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v public.report_draft_links%rowtype;
begin
  if not public._report_draft_code_check(p_job, p_code) then return public._report_draft_refusal(p_job); end if;
  select * into v from public.report_draft_links where job_id = p_job;
  return jsonb_build_object(
    'job', jsonb_build_object('id', v.job_id, 'title', (select title from public.jobs where id = v.job_id)),
    'stage', v.stage,
    'draft', v.draft_text,
    'captions', to_jsonb(v.captions),
    'sent_at', v.sent_at,
    'sent_via', v.sent_via
  );
end $$;

-- Send the words on the page to the client. The same door as a reply of 1.
create or replace function public.send_report_draft_by_code(p_job text, p_code text, p_text text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v public.report_draft_links%rowtype;
  v_text text := btrim(coalesce(p_text, ''));
begin
  if not public._report_draft_code_check(p_job, p_code) then return public._report_draft_refusal(p_job); end if;
  select * into v from public.report_draft_links where job_id = p_job for update;
  if v.sent_at is not null then
    return jsonb_build_object('error', 'This report has already been sent to the client.');
  end if;
  if length(v_text) < 10 then
    return jsonb_build_object('error', 'Say what was done, in a sentence or two.');
  end if;
  if length(v_text) > 2000 then
    return jsonb_build_object('error', 'That is too long to send. Keep it under 2000 characters.');
  end if;

  perform public.relay_confirmed_report(p_job, v_text, v.ai_summary);

  update public.report_draft_links set sent_at = now(), sent_via = 'link' where job_id = p_job;

  -- Whether the draft was good enough, in the same table the WhatsApp reply
  -- writes to, so the two routes are counted together.
  insert into public.draft_decisions (job_id, stage, kind, accepted, drafted_chars, sent_chars, drafted_at)
  values (p_job, v.stage, 'evidence_report', v_text = btrim(v.draft_text), length(v.draft_text), length(v_text), v.drafted_at);

  -- The same draft is waiting in the chat. Clear it, or "1" sends it again.
  if v.phone <> '' then
    delete from public.wa_intake_sessions s
     where s.answers->>'_lane' = 'report_confirm'
       and s.answers->>'job_id' = p_job
       and public.same_phone(s.wa_id, v.phone);
  end if;

  return jsonb_build_object('ok', true, 'changed', v_text <> btrim(v.draft_text));
end $$;

revoke execute on function public.report_draft_for_code(text, text) from public;
revoke execute on function public.send_report_draft_by_code(text, text, text) from public;
grant execute on function public.report_draft_for_code(text, text) to anon, authenticated;
grant execute on function public.send_report_draft_by_code(text, text, text) to anon, authenticated;
