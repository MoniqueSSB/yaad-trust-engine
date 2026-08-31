-- The video walkthrough, requested by the client.
--
-- jobs has carried walk_platform, walk_link, walk_date, walk_who, walk_notes
-- and signoff_method since 23 Aug, and none of the six has ever been read or
-- written by any code in this repository. The FAQ has described the feature
-- they belong to in the meantime: "At sign-off you can approve from the
-- evidence package, or book a live video walkthrough: the worker walks the
-- whole site with you on WhatsApp video, Google Meet or Zoom, whichever
-- suits you." This gives that description an actual path.
--
-- Two functions, two sides, the same shape as approve_stage: jobs carries no
-- client-write or worker-write RLS policy at all (only admin write, plus
-- client/worker read), so each is the one narrow door for its side.
--
-- request_walkthrough, the CLIENT: names a platform and a preferred date,
-- and a note about what they want walked through. Requesting again before a
-- worker has confirmed simply updates the request; requesting again AFTER a
-- confirmed link exists clears it, because a changed date makes the old link
-- stale and a worker who has not seen the change should not have their old
-- confirmation stand in for it.
--
-- confirm_walkthrough, the WORKER: sets the real link once the call is
-- actually arranged (over WhatsApp, same as everything else in this
-- product), and may adjust the platform or date if what the client proposed
-- did not work. Refused outright if the client never asked: a worker should
-- not be able to schedule a call onto a client who did not request one.
--
-- clear_walkthrough, either side: cancels a request or a confirmed call and
-- resets every field to null. Every state this migration adds has a way out
-- of it, the same reasoning Stage 4 already applied to a worker a client
-- will not take.
--
-- Money, evidence and approval are untouched. approve_stage() does not read
-- signoff_method and never will: the FAQ's "or" is a client's choice of how
-- to LOOK at the evidence before approving, not a gate on approving it, and
-- the Approve button stays available exactly as it already was regardless
-- of whether a walkthrough was ever requested.

alter table public.jobs drop constraint if exists jobs_walk_platform_chk;
alter table public.jobs add constraint jobs_walk_platform_chk
  check (walk_platform is null or walk_platform in ('whatsapp','google_meet','zoom'));

alter table public.jobs drop constraint if exists jobs_signoff_method_chk;
alter table public.jobs add constraint jobs_signoff_method_chk
  check (signoff_method is null or signoff_method in ('evidence','walkthrough'));

comment on column public.jobs.walk_platform is
  'whatsapp | google_meet | zoom, the client''s choice of platform for a video walkthrough, matching the three options in the FAQ. Set by request_walkthrough(), optionally adjusted by confirm_walkthrough().';
comment on column public.jobs.walk_link is
  'The real meeting link, set by the worker once the call is actually arranged, through confirm_walkthrough(). Null means requested but not yet confirmed.';
comment on column public.jobs.walk_date is
  'Free text: a preferred date and time from the client, possibly adjusted by the worker on confirmation. Not a calendar slot; this is a single ad hoc call, not a recurring booking.';
comment on column public.jobs.walk_who is
  'Who is confirmed to be on the call, the worker''s own words, set alongside the link.';
comment on column public.jobs.walk_notes is
  'What the client wants walked through, their own words, set at request time. Not the notes the call itself produces; that is a later piece of work.';
comment on column public.jobs.signoff_method is
  'evidence | walkthrough | null. Which sign-off path the client is currently using. Informational only: approve_stage() does not read this column and a request never blocks the Approve button.';

create or replace function public.request_walkthrough(p_job text, p_platform text, p_date text, p_notes text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email    text;
  v_platform text := nullif(btrim(coalesce(p_platform, '')), '');
begin
  v_email := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
  if v_email is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  if v_platform is null or v_platform not in ('whatsapp','google_meet','zoom') then
    raise exception 'Choose WhatsApp video, Google Meet or Zoom.' using errcode = 'check_violation';
  end if;

  update public.jobs
     set walk_platform  = v_platform,
         walk_date      = nullif(btrim(coalesce(p_date, '')), ''),
         walk_notes     = nullif(btrim(coalesce(p_notes, '')), ''),
         signoff_method = 'walkthrough',
         -- A fresh request outdates any link already confirmed against the
         -- old date or platform. The worker sees the request has changed and
         -- confirms again.
         walk_link      = null,
         walk_who       = null
   where id = p_job
     and lower(coalesce(client_email, '')) = v_email
     and coalesce(worker_email, '') <> '';

  if not found then
    raise exception 'That is not your job to request a walkthrough on, or it has no worker yet.'
      using errcode = '28000';
  end if;
end;
$$;

create or replace function public.confirm_walkthrough(p_job text, p_platform text, p_date text, p_link text, p_who text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email    text;
  v_link     text := nullif(btrim(coalesce(p_link, '')), '');
  v_platform text := nullif(btrim(coalesce(p_platform, '')), '');
begin
  v_email := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
  if v_email is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  if v_link is null then
    raise exception 'A link is needed to confirm the call.' using errcode = 'check_violation';
  end if;
  if v_platform is not null and v_platform not in ('whatsapp','google_meet','zoom') then
    raise exception 'Choose WhatsApp video, Google Meet or Zoom.' using errcode = 'check_violation';
  end if;

  update public.jobs
     set walk_link     = v_link,
         walk_who      = nullif(btrim(coalesce(p_who, '')), ''),
         walk_platform = coalesce(v_platform, walk_platform),
         walk_date     = coalesce(nullif(btrim(coalesce(p_date, '')), ''), walk_date)
   where id = p_job
     and lower(coalesce(worker_email, '')) = v_email
     and signoff_method = 'walkthrough';

  if not found then
    raise exception 'No walkthrough has been requested on this job, or it is not yours to confirm.'
      using errcode = '28000';
  end if;
end;
$$;

create or replace function public.clear_walkthrough(p_job text)
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
     set walk_platform  = null,
         walk_link      = null,
         walk_date      = null,
         walk_who       = null,
         walk_notes     = null,
         signoff_method = null
   where id = p_job
     and (lower(coalesce(client_email, '')) = v_email or lower(coalesce(worker_email, '')) = v_email);

  if not found then
    raise exception 'That is not your job.' using errcode = '28000';
  end if;
end;
$$;

revoke all on function public.request_walkthrough(text, text, text, text) from public, anon, authenticated;
grant execute on function public.request_walkthrough(text, text, text, text) to authenticated;

revoke all on function public.confirm_walkthrough(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.confirm_walkthrough(text, text, text, text, text) to authenticated;

revoke all on function public.clear_walkthrough(text) from public, anon, authenticated;
grant execute on function public.clear_walkthrough(text) to authenticated;
