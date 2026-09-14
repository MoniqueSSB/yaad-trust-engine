-- Materials money is marked sent by a person, and only then is the worker
-- told it is on its way.
--
-- Founder, 14 Sep 2026. After the first real release on the desk: "who was
-- it released to? Where does that money go? Do they receive a link?" A
-- release (20260914112000) records a decision and moves nothing: no payout,
-- no transfer, no message. Nothing told the worker, and nothing recorded
-- that the money had actually left. She then decided, the same day:
--
--   * Yaadly does NOT store worker bank details. Until Stripe Global Payouts
--     is live she pays from her own business bank, using a payee saved in
--     the bank's own app; the worker's details never enter this database.
--   * The desk gets a "Pay the worker" step under each release: how it was
--     sent and the transfer reference, stamped with who pressed it and when.
--   * The WhatsApp to the worker fires on that step, not on the release, so
--     it only ever says what is true: the money has been sent.
--
-- WHAT CHANGES
--   1. materials_releases.sent_at, sent_by, sent_method, sent_ref. Blank on
--      every existing row, which reads as "released, not yet sent".
--   2. mark_materials_sent(release, method, reference): admin only, on a
--      released row, once. 'bank_transfer' is the only method for now;
--      Stripe is added when Global Payouts is switched on, in its own
--      migration, so the check cannot be satisfied by a button that does
--      not work yet.
--   3. A write-once guard on the table itself. The desk reads and writes
--      materials_releases directly as an admin (materials_releases_admin),
--      so a rule that lived only inside the function could be walked round
--      with a plain UPDATE. The trigger stamps sent_at and sent_by from the
--      signed-in person, whatever the caller wrote, refuses to mark a row
--      sent with nobody signed in, and refuses to change a sent row at all.
--   4. The worker is told: when sent_at goes from blank to set, the shared
--      trigger shape (20260913130000) calls yaad-notify-client with kind
--      materials_sent_worker and the release id. Never text. The function
--      reads the row itself.
--
-- NO HUMAN GATE MOVES. Marking money sent is a named person saying they sent
-- it. It releases nothing, pays nothing, and the release itself is still its
-- own admin click. The live views materials_open_releases and
-- materials_reconciliation select named columns and are untouched.

begin;

alter table public.materials_releases
  add column if not exists sent_at     timestamptz,
  add column if not exists sent_by     text not null default '',
  add column if not exists sent_method text,
  add column if not exists sent_ref    text not null default '';

alter table public.materials_releases drop constraint if exists materials_releases_sent_method_check;
alter table public.materials_releases add constraint materials_releases_sent_method_check
  check (sent_method is null or sent_method in ('bank_transfer'));

comment on column public.materials_releases.sent_at is
  'When a person marked this materials money as sent to the worker. Null means released and not yet sent. Set only through mark_materials_sent(), stamped by trigger. 20260914190000.';
comment on column public.materials_releases.sent_by is
  'Who marked it sent: the signed-in admin''s email, written by the trigger, never by the caller.';
comment on column public.materials_releases.sent_method is
  'How it was sent. bank_transfer only, until Stripe Global Payouts is live. Yaadly stores no worker bank details: the payee lives in the business bank''s own app.';
comment on column public.materials_releases.sent_ref is
  'The transfer reference, as the bank shows it. Optional.';

-- ------------------------------------------------------------------ guard

create or replace function public.materials_sent_is_write_once()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_who text := nullif(btrim(lower(coalesce(auth.jwt() ->> 'email', ''))), '');
begin
  if tg_op = 'INSERT' then
    if new.sent_at is not null or new.sent_method is not null
       or btrim(coalesce(new.sent_by, '')) <> '' or btrim(coalesce(new.sent_ref, '')) <> '' then
      raise exception 'Materials money is marked sent after it is released, with mark_materials_sent(), never at the same time.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.sent_at is not null then
    if new.sent_at is distinct from old.sent_at or new.sent_by is distinct from old.sent_by
       or new.sent_method is distinct from old.sent_method or new.sent_ref is distinct from old.sent_ref then
      raise exception 'This materials money was marked sent on % by %. That record is not changed: add a note instead.',
        to_char(old.sent_at at time zone 'America/Jamaica', 'FMDD Mon YYYY'), old.sent_by
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.sent_at is null then
    if new.sent_method is not null or btrim(coalesce(new.sent_by, '')) <> '' or btrim(coalesce(new.sent_ref, '')) <> '' then
      raise exception 'Mark materials money sent with mark_materials_sent(), which records it all at once.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Being marked sent in this update.
  if old.released_at is null then
    raise exception 'That tranche has not been released, so there is nothing to send.' using errcode = 'check_violation';
  end if;
  if v_who is null then
    raise exception 'A named person marks money sent. Nobody is signed in.' using errcode = '28000';
  end if;
  if new.sent_method is null then
    raise exception 'Say how the money was sent.' using errcode = 'check_violation';
  end if;
  new.sent_at  := now();
  new.sent_by  := v_who;
  new.sent_ref := btrim(coalesce(new.sent_ref, ''));
  return new;
end
$function$;

revoke all on function public.materials_sent_is_write_once() from public, anon, authenticated;

drop trigger if exists trg_materials_sent_is_write_once on public.materials_releases;
create trigger trg_materials_sent_is_write_once
  before insert or update on public.materials_releases
  for each row execute function public.materials_sent_is_write_once();

-- ------------------------------------------------------------------ the step

create or replace function public.mark_materials_sent(p_release uuid, p_method text, p_ref text default ''::text)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rel    materials_releases%rowtype;
  v_method text := nullif(btrim(lower(coalesce(p_method, ''))), '');
  v_at     timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  if v_method is distinct from 'bank_transfer' then
    raise exception 'Only a bank transfer can be recorded for now. Stripe payouts are not set up yet.'
      using errcode = 'check_violation';
  end if;

  select * into v_rel from materials_releases where id = p_release for update;
  if not found then
    raise exception 'No such materials release.' using errcode = 'check_violation';
  end if;
  if v_rel.released_at is null then
    raise exception 'That tranche has not been released, so there is nothing to send.' using errcode = 'check_violation';
  end if;
  if v_rel.sent_at is not null then
    raise exception 'This materials money was already marked sent on % by %.',
      to_char(v_rel.sent_at at time zone 'America/Jamaica', 'FMDD Mon YYYY'), v_rel.sent_by
      using errcode = 'check_violation';
  end if;

  update materials_releases
     set sent_at = now(), sent_method = v_method, sent_ref = btrim(coalesce(p_ref, ''))
   where id = p_release
  returning sent_at into v_at;

  return v_at;
end
$function$;

comment on function public.mark_materials_sent(uuid, text, text) is
  'A named admin records that released materials money has been sent to the worker: how, and the transfer reference. Once per release, never changed. Fires the worker''s WhatsApp. Moves no money itself. 20260914190000.';

revoke execute on function public.mark_materials_sent(uuid, text, text) from public, anon;
grant execute on function public.mark_materials_sent(uuid, text, text) to authenticated;

-- ------------------------------------------------------------------ the worker is told

create or replace function public.notify_worker_materials_sent()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.sent_at is not null and old.sent_at is null then
    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id,
        'kind', 'materials_sent_worker', 'meta', jsonb_build_object('releaseId', new.id)),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
end
$function$;

revoke all on function public.notify_worker_materials_sent() from public, anon, authenticated;

drop trigger if exists trg_notify_worker_materials_sent on public.materials_releases;
create trigger trg_notify_worker_materials_sent
  after update of sent_at on public.materials_releases
  for each row execute function public.notify_worker_materials_sent();

commit;
