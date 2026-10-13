-- The WhatsApp number given on the job form reaches the job, 13 October 2026.
--
-- The job form asks for "one way to reach you" and accepts a WhatsApp number.
-- That number only ever landed in enquiries.contact, because the job row is
-- kept anonymous on purpose until the client confirms their email and joins
-- their portal (yaad-post-job writes no name, email or number). At that
-- moment nothing copied the number across, so every client who typed a
-- WhatsApp number got email only, and the client WhatsApp templates Meta
-- approved on 13 October never fired for them.
--
-- This is the hold point release. When a job goes from no client to a client
-- (client_email set for the first time), look up the enquiry the form wrote
-- for this exact job reference, and if what was typed is a phone number,
-- write it to jobs.client_phone, the column every sender already reads.
--
-- Rules, the same as set_job_whatsapp_as_me() (20260929230000):
--   * nothing is written on the unclaimed draft, so anonymity holds;
--   * a number already on the job is never overwritten;
--   * the client removes it from the Job details tab, the same door as before;
--   * the number is never logged: agent_actions records that it was attached
--     and nothing else.
--
-- The enquiry is matched on the "Reference: <job id>" line the form itself
-- writes into the enquiry message (web/app/jobs/new/PostJob.tsx, send()),
-- anchored to a whole line, and only within 60 days, so an old enquiry
-- cannot attach to a new job. No new table and no new column, so there is
-- nothing here to put RLS on.
--
-- DATA PROTECTION, stated because CLAUDE.md section 10 makes it hers: the
-- number is used for one purpose, updates on the client's own job, which is
-- what the form says next to the field from today. The privacy notice names
-- it (docs/privacy.html, same change).

create or replace function public.attach_form_whatsapp_on_claim()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_contact text;
  v_digits  text;
begin
  if coalesce(btrim(old.client_email), '') <> '' then return new; end if;
  if coalesce(btrim(new.client_email), '') = '' then return new; end if;
  if coalesce(btrim(new.client_phone), '') <> '' then return new; end if;

  select e.contact into v_contact
    from enquiries e
   where e.created_at > now() - interval '60 days'
     and e.message ~ ('(^|\n)Reference: ' || new.id || '(\r?\n|$)')
   order by e.created_at desc
   limit 1;
  if v_contact is null or position('@' in v_contact) > 0 then return new; end if;

  v_digits := regexp_replace(v_contact, '\D', '', 'g');
  if v_digits like '00%' then v_digits := substr(v_digits, 3); end if;
  if char_length(v_digits) < 9 or char_length(v_digits) > 15 then return new; end if;

  update jobs set client_phone = '+' || v_digits where id = new.id;

  insert into agent_actions (job_id, actor, actor_kind, action, summary, refs)
  values (new.id, 'job form', 'agent', 'set_job_whatsapp',
          'The WhatsApp number given on the job form was attached to the job when the client joined their portal. Updates go there as well as by email.',
          jsonb_build_object('jobs', new.id, 'had_number', false, 'has_number', true));
  return new;
end $function$;

revoke all on function public.attach_form_whatsapp_on_claim() from public, anon, authenticated;

drop trigger if exists trg_attach_form_whatsapp_on_claim on public.jobs;
create trigger trg_attach_form_whatsapp_on_claim
  after update of client_email on public.jobs
  for each row
  when (coalesce(btrim(old.client_email), '') = '' and coalesce(btrim(new.client_email), '') <> '')
  execute function public.attach_form_whatsapp_on_claim();

comment on function public.attach_form_whatsapp_on_claim() is
  'When a job gets its client for the first time, copies the phone number the client typed on the job form (from the matching enquiry) to jobs.client_phone. Never overwrites, never logs the number.';

-- Proof it is on:
--   select tgname, tgenabled from pg_trigger where tgname = 'trg_attach_form_whatsapp_on_claim';
-- Proof it works, on a job somebody just claimed:
--   select id, client_phone <> '' as has_number from jobs where id = '<job id>';
--   select action, summary from agent_actions where job_id = '<job id>' and action = 'set_job_whatsapp';
