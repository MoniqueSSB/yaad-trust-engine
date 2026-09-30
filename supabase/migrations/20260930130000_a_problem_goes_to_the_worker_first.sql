-- A problem with the work goes to the worker first. 30 Sep 2026.
--
-- Founder: "when a client raises an issues it goes to the worker to solve,
-- only when there is no resolve then it comes to me to intervene". This
-- reverses the 28 September rule that opened every dispute with Yaadly, and
-- restores what the table and the trigger of 20260913130100 always allowed:
-- a dispute opens 'direct', the worker replies once, the client closes it
-- ('resolved') or brings Yaadly in ('escalated').
--
-- New here:
--   1. the desk is told at raise only when a dispute is opened already
--      escalated; otherwise it hears at escalation, as
--      notify_desk_dispute_escalated has done since 13 September.
--   2. the client is told when the worker replies (kind dispute_replied).
--   3. a dispute with no reply after two days escalates on its own, once a
--      day (escalate_stale_disputes, cron yaad-dispute-escalation).
--   4. both sides can do their part on WhatsApp: raise, reply, close or
--      escalate. Each door checks the phone against the job. Service role
--      only: the caller is yaad-inbound after Twilio's signature check.
--
-- Nothing here approves, releases or rules. A dispute open in any state
-- still stops approval on the job, exactly as before.

-- 1. The raise trigger: worker always, client receipt always, desk only for
--    an escalated open.
create or replace function public.notify_dispute_raised_to_worker_and_desk()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform net.http_post(
    url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
    body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id,
      'kind', 'dispute_raised_worker', 'meta', jsonb_build_object('id', new.id)),
    headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
    timeout_milliseconds := 15000
  );
  if new.state = 'escalated' then
    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id,
        'kind', 'desk_alert', 'meta', jsonb_build_object('event', 'dispute_raised', 'id', new.id)),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
end;
$$;
revoke all on function public.notify_dispute_raised_to_worker_and_desk() from public, anon, authenticated;

-- 2. The client hears the reply.
create or replace function public.notify_client_dispute_replied()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.reply is not null and old.reply is distinct from new.reply then
    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id,
        'kind', 'dispute_replied', 'meta', jsonb_build_object('id', new.id)),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
end;
$$;
revoke all on function public.notify_client_dispute_replied() from public, anon, authenticated;
drop trigger if exists trg_notify_client_dispute_replied on public.disputes;
create trigger trg_notify_client_dispute_replied
  after update on public.disputes
  for each row execute function public.notify_client_dispute_replied();

-- 3. Two days with no reply: Yaadly steps in on its own. Runs with no
--    request token, so trg_disputes_each_side_moves_its_own_part lets it
--    through, and notify_desk_dispute_escalated tells the desk.
create or replace function public.escalate_stale_disputes()
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n int;
begin
  update public.disputes
     set state = 'escalated', updated_at = now()
   where state = 'direct'
     and reply is null
     and created_at < now() - interval '2 days';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.escalate_stale_disputes() from public, anon, authenticated;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'yaad-dispute-escalation') then
    perform cron.unschedule('yaad-dispute-escalation');
  end if;
  -- 15:37 UTC daily, half an hour after the check reminders.
  perform cron.schedule('yaad-dispute-escalation', '37 15 * * *', 'select public.escalate_stale_disputes();');
end
$do$;

-- 4. The WhatsApp doors.
create or replace function public.raise_dispute_via_whatsapp(p_job text, p_phone text, p_body text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_job   public.jobs%rowtype;
  v_body  text := left(nullif(btrim(coalesce(p_body, '')), ''), 2000);
  v_id    uuid;
begin
  if v_body is null then raise exception 'Say what is wrong.' using errcode = 'check_violation'; end if;
  select * into v_job from public.jobs j where j.id = p_job and public.same_phone(j.client_phone, p_phone);
  if v_job.id is null then
    raise exception 'That is not a job on this number.' using errcode = '28000';
  end if;
  if exists (select 1 from public.disputes d where d.job_id = p_job and d.state in ('direct', 'escalated')) then
    raise exception 'A problem is already open on this job. Reply SORTED or NOT FIXED with the job code.' using errcode = 'check_violation';
  end if;
  insert into public.disputes (job_id, raised_by, kinds, body, state)
  values (p_job, lower(coalesce(v_job.client_email, '')), '[]'::jsonb, v_body, 'direct')
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.raise_dispute_via_whatsapp(text, text, text) from public, anon, authenticated;
grant execute on function public.raise_dispute_via_whatsapp(text, text, text) to service_role;

create or replace function public.reply_dispute_via_whatsapp(p_job text, p_phone text, p_reply text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_reply text := left(nullif(btrim(coalesce(p_reply, '')), ''), 2000);
begin
  if v_reply is null then raise exception 'Say what you will do.' using errcode = 'check_violation'; end if;
  update public.disputes d
     set reply = v_reply, updated_at = now()
   where d.job_id = p_job
     and d.state = 'direct'
     and d.reply is null
     and exists (select 1 from public.jobs j
                   join public.worker_profiles w on w.active is true and lower(w.worker_email) = lower(coalesce(j.worker_email, ''))
                  where j.id = p_job and public.same_phone(w.phone, p_phone));
  if not found then
    raise exception 'No open problem waiting on your reply on this job.' using errcode = '28000';
  end if;
end;
$$;
revoke all on function public.reply_dispute_via_whatsapp(text, text, text) from public, anon, authenticated;
grant execute on function public.reply_dispute_via_whatsapp(text, text, text) to service_role;

create or replace function public.close_dispute_via_whatsapp(p_job text, p_phone text, p_state text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_state not in ('resolved', 'escalated') then
    raise exception 'A dispute closes as sorted, or goes to Yaadly.' using errcode = 'check_violation';
  end if;
  update public.disputes d
     set state = p_state, updated_at = now()
   where d.job_id = p_job
     and d.state = 'direct'
     and exists (select 1 from public.jobs j where j.id = p_job and public.same_phone(j.client_phone, p_phone));
  if not found then
    raise exception 'No open problem on this job for this number.' using errcode = '28000';
  end if;
end;
$$;
revoke all on function public.close_dispute_via_whatsapp(text, text, text) from public, anon, authenticated;
grant execute on function public.close_dispute_via_whatsapp(text, text, text) to service_role;
