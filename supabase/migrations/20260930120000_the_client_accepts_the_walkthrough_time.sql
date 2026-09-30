-- The client accepts the walkthrough time. 30 Sep 2026.
--
-- Founder, on the worker's walkthrough message: "they dont have their
-- whatsapp to arrange the call", then "i dont confirm not with the client,
-- the client accept the info is sent by yaadly". Neither side has the
-- other's number and no person at Yaadly relays. So: the worker offers a
-- day and time (a WhatsApp reply, or the portal), Yaadly sends it to the
-- client, the client accepts (a WhatsApp reply, a button, or the portal),
-- and both are told. Nothing here approves work or moves money.
--
-- Three columns on jobs. walk_offer is the worker's words; walk_offered_at
-- and walk_accepted_at are the two moments the trigger fires on. The
-- client's own preferred time stays in walk_date, and a Meet or Zoom link
-- stays in walk_link, where the portal already shows it.

alter table public.jobs
  add column if not exists walk_offer text,
  add column if not exists walk_offered_at timestamptz,
  add column if not exists walk_accepted_at timestamptz;

comment on column public.jobs.walk_offer is 'The day and time the worker offered for the video walkthrough, in their words. Sent to the client by yaad-notify-client.';
comment on column public.jobs.walk_accepted_at is 'When the client accepted walk_offer. Set only by accept_walkthrough() or accept_walkthrough_via_whatsapp().';

-- The worker, from WhatsApp. The phone must be an active worker whose email
-- is the job's worker. Service role only: the caller is yaad-inbound after
-- Twilio's signature check.
create or replace function public.offer_walkthrough_via_whatsapp(p_job text, p_phone text, p_offer text, p_link text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_offer text := left(nullif(btrim(coalesce(p_offer, '')), ''), 300);
begin
  if v_offer is null then
    raise exception 'A day and time is needed.' using errcode = 'check_violation';
  end if;
  update public.jobs j
     set walk_offer = v_offer,
         walk_offered_at = now(),
         walk_accepted_at = null,
         walk_link = coalesce(nullif(btrim(coalesce(p_link, '')), ''), j.walk_link)
   where j.id = p_job
     and j.signoff_method = 'walkthrough'
     and exists (select 1 from public.worker_profiles w
                  where w.active is true
                    and lower(w.worker_email) = lower(coalesce(j.worker_email, ''))
                    and public.same_phone(w.phone, p_phone));
  if not found then
    raise exception 'No open walkthrough on this job for this number.' using errcode = '28000';
  end if;
end;
$$;
revoke all on function public.offer_walkthrough_via_whatsapp(text, text, text, text) from public, anon, authenticated;
grant execute on function public.offer_walkthrough_via_whatsapp(text, text, text, text) to service_role;

-- The worker, from the portal.
create or replace function public.offer_walkthrough(p_job text, p_offer text, p_link text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
  v_offer text := left(nullif(btrim(coalesce(p_offer, '')), ''), 300);
begin
  if v_email is null then raise exception 'Not signed in.' using errcode = '28000'; end if;
  if v_offer is null then raise exception 'A day and time is needed.' using errcode = 'check_violation'; end if;
  update public.jobs
     set walk_offer = v_offer, walk_offered_at = now(), walk_accepted_at = null,
         walk_link = coalesce(nullif(btrim(coalesce(p_link, '')), ''), walk_link)
   where id = p_job
     and lower(coalesce(worker_email, '')) = v_email
     and signoff_method = 'walkthrough';
  if not found then
    raise exception 'No walkthrough has been requested on this job, or it is not yours.' using errcode = '28000';
  end if;
end;
$$;
revoke all on function public.offer_walkthrough(text, text, text) from public, anon;
grant execute on function public.offer_walkthrough(text, text, text) to authenticated;

-- The call link, made by Yaadly the moment a time is agreed. Founder, 30 Sep
-- 2026: "the worker should not make the link yaadly should and provide it
-- to the worker ... it should be auto once the work and client agree on
-- time and date". A Jitsi Meet room: a link is a room, no account on either
-- side, opens in the phone's browser. Jitsi is a third party that carries
-- the video of both sides for the length of the call; on the data list for
-- the adviser. The room name is unguessable and never reused. A link the
-- worker already pasted (Meet, Zoom) is kept.
create or replace function public.walkthrough_room_link(p_job text)
returns text
language sql
volatile
set search_path to 'public'
as $$
  select 'https://meet.jit.si/Yaadly-' || regexp_replace(p_job, '[^A-Za-z0-9]', '', 'g') || '-' || encode(extensions.gen_random_bytes(6), 'hex');
$$;
revoke all on function public.walkthrough_room_link(text) from public, anon, authenticated;

-- The client, from the portal.
create or replace function public.accept_walkthrough(p_job text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
begin
  if v_email is null then raise exception 'Not signed in.' using errcode = '28000'; end if;
  update public.jobs
     set walk_accepted_at = now(),
         walk_link = coalesce(walk_link, public.walkthrough_room_link(p_job))
   where id = p_job
     and lower(coalesce(client_email, '')) = v_email
     and signoff_method = 'walkthrough'
     and walk_offer is not null
     and walk_accepted_at is null;
  if not found then
    raise exception 'There is no time waiting for your answer on this job.' using errcode = '28000';
  end if;
end;
$$;
revoke all on function public.accept_walkthrough(text) from public, anon;
grant execute on function public.accept_walkthrough(text) to authenticated;

-- The client, from WhatsApp. The number must be the job's client_phone.
create or replace function public.accept_walkthrough_via_whatsapp(p_job text, p_phone text)
returns table (offer text, platform text, link text)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.jobs j
     set walk_accepted_at = now(),
         walk_link = coalesce(j.walk_link, public.walkthrough_room_link(p_job))
   where j.id = p_job
     and j.signoff_method = 'walkthrough'
     and j.walk_offer is not null
     and j.walk_accepted_at is null
     and public.same_phone(j.client_phone, p_phone);
  if not found then
    raise exception 'There is no time waiting for your answer on this job.' using errcode = '28000';
  end if;
  return query select j.walk_offer, j.walk_platform, j.walk_link from public.jobs j where j.id = p_job;
end;
$$;
revoke all on function public.accept_walkthrough_via_whatsapp(text, text) from public, anon, authenticated;
grant execute on function public.accept_walkthrough_via_whatsapp(text, text) to service_role;

-- The trigger: the 20260917190000 body with two blocks added before return.
create or replace function public.notify_client_on_job_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
    begin
      if coalesce(new.stage,0) > coalesce(old.stage,0)
         and exists (select 1 from public.stage_approvals a where a.job_id = new.id and a.stage = new.stage - 1)
      then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'stage_released'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;

      if new.status = 'complete' and coalesce(old.status, '') is distinct from 'complete' then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'stage_released_worker'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;

      if new.walk_call_notes is not null
         and old.walk_call_notes is distinct from new.walk_call_notes
      then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'walkthrough_notes_ready'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;

      -- A client has requested a video walkthrough, or changed one the
      -- worker has not yet confirmed. 20260915000000.
      if new.signoff_method = 'walkthrough'
         and new.walk_link is null
         and coalesce(new.worker_email, '') <> ''
         and (
           coalesce(old.signoff_method, '') is distinct from 'walkthrough'
           or old.walk_link is not null
           or old.walk_platform is distinct from new.walk_platform
           or old.walk_date     is distinct from new.walk_date
           or old.walk_notes    is distinct from new.walk_notes
         )
      then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'walkthrough_requested'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;

      -- The job has gone live with a worker on it: the client's invoice that
      -- starts the job is paid, and sync_job_status has moved it off
      -- awaiting_payment. booked_worker promised the worker a message when
      -- this happened. 20260917190000.
      if coalesce(new.worker_email, '') <> ''
         and new.status in ('in_progress', 'evidence')
         and coalesce(old.status, '') not in ('in_progress', 'evidence', 'disputed', 'complete', 'cancelled')
      then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'job_live_worker'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;

      -- The worker has offered a day and time for the walkthrough, on
      -- WhatsApp or in the portal. Yaadly sends it to the client, who
      -- accepts. 20260930120000.
      if new.walk_offered_at is not null
         and old.walk_offered_at is distinct from new.walk_offered_at
      then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'walkthrough_offered'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;

      -- The client accepted the offered time. Both sides are told.
      if new.walk_accepted_at is not null
         and old.walk_accepted_at is distinct from new.walk_accepted_at
      then
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'walkthrough_accepted'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
        perform net.http_post(
          url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
          body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.id, 'kind', 'walkthrough_accepted_worker'),
          headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
          timeout_milliseconds := 15000
        );
      end if;


      return new;
    end;
$function$;
