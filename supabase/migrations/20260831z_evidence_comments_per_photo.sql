-- Founder's own requirement, 31 Aug 2026: a client should be able to
-- comment on the actual picture, in the portal, not only reply on
-- WhatsApp against a whole stage. evidence_id makes that possible;
-- nullable, because a WhatsApp comment still only ever knows which STAGE
-- it is about, never which specific item, and that is a real difference
-- worth keeping rather than papering over with a guess.
--
-- origin distinguishes the two so the worker is notified exactly once per
-- comment: yaad-inbound already sends the WhatsApp notification inline for
-- a comment that arrived BY WhatsApp; a comment written in the portal has
-- nobody doing that yet, so a trigger does it here, gated to origin =
-- 'portal' specifically so a WhatsApp-sourced comment is never notified
-- twice.

alter table public.evidence_comments
  add column if not exists evidence_id uuid references public.evidence(id) on delete set null,
  add column if not exists origin text not null default 'whatsapp';

alter table public.evidence_comments drop constraint if exists evidence_comments_origin_chk;
alter table public.evidence_comments add constraint evidence_comments_origin_chk
  check (origin in ('whatsapp', 'portal'));

comment on column public.evidence_comments.evidence_id is
  'The specific photo this comment is about, when known. Null for a WhatsApp comment, which only ever names a stage, never a specific item.';
comment on column public.evidence_comments.origin is
  'whatsapp or portal: which channel the comment was written in. Gates the notify-the-worker trigger so a WhatsApp comment, already announced inline by yaad-inbound, is never announced a second time.';

-- Parties write from the portal: same identity rule sendMessage() in
-- job-actions.ts already uses for the job chat, from_role locked to
-- 'client' and origin locked to 'portal' so this insert path can never be
-- used to forge a worker's own reply or claim a WhatsApp origin it did not
-- have.
create policy "client writes an evidence comment from the portal" on public.evidence_comments
  for insert to authenticated
  with check (
    from_role = 'client'
    and origin = 'portal'
    and exists (
      select 1 from public.jobs j
       where j.id = evidence_comments.job_id
         and lower(coalesce(j.client_email, '')) = lower(auth.jwt() ->> 'email')
    )
  );

-- The notify trigger. Same shared-secret pattern as every other trigger in
-- this repository (20260827f, 20260831i): the plaintext is generated once,
-- stored only as a hash, and baked into the trigger function body.
do $do$
declare
  s      text := encode(extensions.gen_random_bytes(32), 'hex');
  fn_url text := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client';
  pubkey text := 'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz';
begin
  insert into public.app_settings(key, value)
  values ('notify_trigger_secret_sha256', encode(extensions.digest(s, 'sha256'), 'hex'))
  on conflict (key) do update set value = excluded.value;

  execute format($f$
    create or replace function public.notify_worker_of_portal_comment()
    returns trigger
    language plpgsql
    security definer
    set search_path to 'public'
    as $fn$
    begin
      if new.from_role = 'client' and new.origin = 'portal' then
        perform net.http_post(
          url := %L,
          body := jsonb_build_object('secret', %L, 'jobId', new.job_id, 'kind', 'evidence_comment', 'meta', jsonb_build_object('comment_id', new.id)),
          headers := jsonb_build_object('Content-Type','application/json','apikey',%L,'Authorization','Bearer '||%L),
          timeout_milliseconds := 15000
        );
      end if;
      return new;
    end;
    $fn$;
  $f$, fn_url, s, pubkey, pubkey);
end
$do$;

drop trigger if exists trg_notify_worker_portal_comment on public.evidence_comments;
create trigger trg_notify_worker_portal_comment
  after insert on public.evidence_comments
  for each row execute function public.notify_worker_of_portal_comment();
