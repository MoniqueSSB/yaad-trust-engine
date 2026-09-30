-- Yaadly reviews a worker's file when they want to quote. 30 Sep 2026.
--
-- Founder: "yaadly only review workers files once they want to quotes for
-- jobs on the board and they complete the application and it has gone
-- through the AI agent". So a person's queue is not everybody who applied.
-- It is the applications where all three are true: the worker has tried to
-- quote, the check is complete (ID approved, TRN approved, Guidelines
-- signed), and the AI agent has written its notes.
--
-- wants_to_quote_at is stamped by mark_wants_to_quote(), called from the
-- board when a not-yet-published worker tries to price a job. The view is
-- what the desk reads for its queue. Nothing here publishes anybody: a
-- person still presses Publish, and the publish gate of 20260830c still
-- refuses a file that is not complete.

alter table public.applications
  add column if not exists wants_to_quote_at timestamptz;

comment on column public.applications.wants_to_quote_at is
  'First time this applicant tried to quote on the board. A person reviews the file only once this is set and the check is complete.';

create or replace function public.mark_wants_to_quote()
returns table (application_id uuid, upload_token uuid, app_id text, complete boolean, ai_read boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
begin
  if v_email is null then raise exception 'Not signed in.' using errcode = '28000'; end if;
  update public.applications a
     set wants_to_quote_at = coalesce(a.wants_to_quote_at, now())
   where lower(coalesce(a.email, '')) = v_email
     and a.status = 'received';
  return query
    select a.id, a.upload_token, a.app_id,
           (coalesce(a.persona_status, '') in ('approved', 'completed')
              and a.trn_status = 'approved'
              and a.signed_at is not null) as complete,
           exists (select 1 from public.vetting_reviews r where r.application_id = a.id and r.error is null) as ai_read
      from public.applications a
     where lower(coalesce(a.email, '')) = v_email
       and a.status = 'received'
     order by a.created_at desc
     limit 1;
end;
$$;
revoke all on function public.mark_wants_to_quote() from public, anon;
grant execute on function public.mark_wants_to_quote() to authenticated;

-- The desk's queue: what a person actually reviews.
create or replace view public.v_applications_for_review as
  select a.*,
         (coalesce(a.persona_status, '') in ('approved', 'completed')
            and a.trn_status = 'approved'
            and a.signed_at is not null) as check_complete,
         exists (select 1 from public.vetting_reviews r where r.application_id = a.id and r.error is null) as ai_read,
         exists (select 1 from public.worker_profiles p where p.application_id = a.id and p.active is true) as published
    from public.applications a
   where a.status = 'received'
     and a.wants_to_quote_at is not null;

comment on view public.v_applications_for_review is
  'Applications a person reviews: the worker tried to quote. check_complete and ai_read say whether the file is ready; the desk shows the ready ones first.';

revoke all on public.v_applications_for_review from public, anon;
grant select on public.v_applications_for_review to authenticated;
