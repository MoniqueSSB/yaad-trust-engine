-- The client adds a WhatsApp number to their job, to be told of updates there.
--
-- Founder, 29 September 2026: "the client should be informed on whatsapp of
-- the job update."
--
-- On that day no job carried a client phone number. A job posted from the web
-- is anonymous by design (yaad-post-job writes no name, email or number), the
-- client is attached later by email, and nothing afterwards asked for a
-- number. So every stage report had gone by email, and the WhatsApp message
-- yaad-notify-client has always been able to send had never been sent once.
--
-- set_job_whatsapp_as_me() lets the job's own client add, change or remove
-- the number. It writes jobs.client_phone, which is the column every sender
-- already reads, so nothing downstream changes.
--
-- REMOVING IT IS THE SAME DOOR. An empty value clears the number and the
-- updates stop. A person who gave a number must be able to take it back
-- without asking anybody.
--
-- THE NUMBER IS NEVER LOGGED. agent_actions is read more widely than a phone
-- number should be, so the entry records that it was set, changed or removed
-- and nothing else. Same rule as the street address (20260929070000).
--
-- No new table and no new column, so there is nothing here to put RLS on.
-- jobs.client_phone is already hidden from the worker and from the board.
--
-- DATA PROTECTION, stated because CLAUDE.md section 10 makes it hers: this
-- asks a client for a phone number they were not asked for before, for one
-- purpose, updates on their own job. The founder made that decision on the
-- date above. The privacy notice should name it.

create or replace function public.set_job_whatsapp_as_me(p_job text, p_phone text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email  text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_job    jobs%rowtype;
  v_raw    text := btrim(coalesce(p_phone, ''));
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_new    text;
  v_had    boolean;
begin
  if v_email is null then
    raise exception 'Sign in to add a WhatsApp number.' using errcode = '28000';
  end if;
  select * into v_job from jobs where id = p_job for update;
  if not found or lower(coalesce(v_job.client_email, '')) <> v_email then
    raise exception 'Only the client on this job can set its WhatsApp number.' using errcode = '28000';
  end if;
  if v_job.status = 'complete' then
    raise exception 'This job is complete, so there are no more updates to send.';
  end if;

  if v_raw = '' then
    v_new := '';
  else
    -- 00 is how an international number is dialled from most of Europe.
    if v_digits like '00%' then v_digits := substr(v_digits, 3); end if;
    if left(v_raw, 1) <> '+' and v_raw not like '00%' then
      raise exception 'Start the number with + and the country code, for example +44 for the UK, +1 for Jamaica, the US and Canada.';
    end if;
    if char_length(v_digits) < 9 or char_length(v_digits) > 15 then
      raise exception 'That does not look like a full number. Give it with the country code, for example +447700900123.';
    end if;
    v_new := '+' || v_digits;
  end if;

  v_had := coalesce(btrim(v_job.client_phone), '') <> '';
  if v_new is not distinct from coalesce(btrim(v_job.client_phone), '') then
    return false;
  end if;

  update jobs set client_phone = v_new, updated_at = now() where id = p_job;

  insert into agent_actions (job_id, actor, actor_kind, action, summary, refs)
  values (p_job, v_email, 'human', 'set_job_whatsapp',
          case when v_new = '' then 'The client removed their WhatsApp number. Updates go by email.'
               when v_had then 'The client changed their WhatsApp number.'
               else 'The client added a WhatsApp number for updates.' end,
          jsonb_build_object('jobs', p_job, 'had_number', v_had, 'has_number', v_new <> ''));
  return true;
end $function$;

comment on function public.set_job_whatsapp_as_me(text, text) is
  'The job''s client adds, changes or removes the WhatsApp number their updates go to. Logged to agent_actions without the number.';

revoke all on function public.set_job_whatsapp_as_me(text, text) from public, anon;
grant execute on function public.set_job_whatsapp_as_me(text, text) to authenticated;
