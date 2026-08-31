-- The other half of the FAQ's walkthrough sentence: "the notes are
-- recorded, you confirm them in your portal, and both land on your
-- Completion Report." 20260831l built the request and the call itself;
-- this is the aftermath.
--
-- walk_notes already exists and stays exactly what it was: the client's own
-- note at request time, what they want walked through. What the call
-- actually found needed its own column, because conflating a request with
-- its answer would mean a worker's write-up silently overwrote the
-- question that was asked.

alter table public.jobs
  add column if not exists walk_call_notes         text,
  add column if not exists walk_notes_confirmed_at timestamptz,
  add column if not exists walk_notes_confirmed_by text;

comment on column public.jobs.walk_call_notes is
  'What the worker found and raised on the confirmed call, their own words, through record_walkthrough_notes(). Editing it clears any existing confirmation, the same rule a fresh walkthrough request applies to a stale link.';
comment on column public.jobs.walk_notes_confirmed_at is
  'When the client confirmed walk_call_notes were an accurate account of the call, through confirm_walkthrough_notes(). Null means not yet confirmed, whether or not notes exist.';
comment on column public.jobs.walk_notes_confirmed_by is
  'The confirming client''s own email, stamped by confirm_walkthrough_notes() rather than trusted from the caller.';

create or replace function public.record_walkthrough_notes(p_job text, p_notes text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  v_email := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
  if v_email is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  if v_notes is null then
    raise exception 'Notes are needed to record.' using errcode = 'check_violation';
  end if;

  update public.jobs
     set walk_call_notes         = v_notes,
         -- Editing after confirmation outdates the client's confirmation of
         -- the OLD text; they have not agreed to the new wording yet.
         walk_notes_confirmed_at = null,
         walk_notes_confirmed_by = null
   where id = p_job
     and lower(coalesce(worker_email, '')) = v_email
     and walk_link is not null;

  if not found then
    raise exception 'No confirmed call exists on this job to write notes against, or it is not yours.'
      using errcode = '28000';
  end if;
end;
$$;

create or replace function public.confirm_walkthrough_notes(p_job text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
begin
  v_email := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
  if v_email is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  update public.jobs
     set walk_notes_confirmed_at = now(),
         walk_notes_confirmed_by = v_email
   where id = p_job
     and lower(coalesce(client_email, '')) = v_email
     and walk_call_notes is not null;

  if not found then
    raise exception 'There are no call notes on this job yet to confirm, or it is not yours.'
      using errcode = '28000';
  end if;
end;
$$;

revoke all on function public.record_walkthrough_notes(text, text) from public, anon, authenticated;
grant execute on function public.record_walkthrough_notes(text, text) to authenticated;

revoke all on function public.confirm_walkthrough_notes(text) from public, anon, authenticated;
grant execute on function public.confirm_walkthrough_notes(text) to authenticated;
