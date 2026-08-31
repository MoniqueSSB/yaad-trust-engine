-- Stage 6. A client can approve a stage by replying on WhatsApp, not only
-- by tapping the button in the portal. Same underlying rule either way:
-- nothing has been filed, no approval; a dispute is open, no approval;
-- somebody who is not this job's client, no approval. WhatsApp is a second
-- door into the same room, not a looser one.
--
-- approve_stage() cannot be called as it stands from an inbound WhatsApp
-- message: it authenticates the caller through auth.uid(), and the Edge
-- Function handling a Twilio webhook runs on the service role with no
-- Supabase session behind it at all. So the part of approve_stage() that
-- actually decides whether a stage is approvable is pulled out into
-- _do_approve_stage(), which takes an already-established identity as an
-- argument rather than deriving one from auth.uid() itself. approve_stage()
-- becomes a thin wrapper that derives that identity from the portal
-- session, same as always; approve_stage_via_whatsapp() derives it from a
-- phone number matched against this specific job's own client_phone, and
-- is never exposed to PostgREST at all, only ever callable with the
-- service role a Twilio-triggered Edge Function runs on.
--
-- One rule stays identical between the two paths because it is the same
-- function underneath: an open dispute blocks either kind of approval, and
-- an unfiled stage cannot be approved from a portal tap or a text message.

alter table public.stage_approvals drop constraint if exists stage_approvals_confirmed_method_chk;
alter table public.stage_approvals add constraint stage_approvals_confirmed_method_chk
  check (confirmed_method in ('evidence', 'in_person', 'whatsapp'));

comment on column public.stage_approvals.confirmed_method is
  'evidence means the client approved reviewing the filed evidence remotely, the default and the original behaviour. in_person means the client attested to physically inspecting the work on the property themselves. whatsapp means the client replied to approve from the number on file for the job, rather than tapping Approve in the portal. Set once, at approval, immutable like every other column on this table: it is a record of what happened, not a setting.';

-- The shared core. Not exposed to PostgREST, not granted to anyone:
-- approve_stage() and approve_stage_via_whatsapp() are the only two doors
-- in, and both are SECURITY DEFINER owned by the same role this runs as,
-- which is what lets them call it at all without their own grant on it.
create or replace function public._do_approve_stage(p_job text, p_email text, p_method text)
returns table(job_id text, stage integer, evidence_count integer, confirmed_method text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  j record;
  v_stage integer;
  v_evidence jsonb;
  v_count integer;
  v_dispute_open boolean;
  v_method text := case when p_method in ('in_person', 'whatsapp') then p_method else 'evidence' end;
begin
  if p_email is null or p_email = '' then
    raise exception 'No email on record to approve as.' using errcode = '28000';
  end if;

  select * into j from public.jobs where id = p_job;
  if j.id is null then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;

  if lower(coalesce(j.client_email, '')) <> lower(p_email) then
    raise exception 'That is not your job to approve.' using errcode = '28000';
  end if;

  select exists (
    select 1 from public.disputes d
     where d.job_id = p_job and d.state <> 'resolved'
  ) into v_dispute_open;

  if v_dispute_open then
    raise exception 'A dispute is open on this job. Nothing can be approved while it is.'
      using errcode = 'check_violation';
  end if;

  v_stage := greatest(coalesce(j.stage, 0), 1);

  select jsonb_agg(
           jsonb_build_object('id', e.id, 'sha256', e.sha256, 'label', e.label, 'created_at', e.created_at)
           order by e.created_at
         ),
         count(*)
    into v_evidence, v_count
    from public.evidence e
   where e.job_id = p_job and coalesce(e.stage, 1) = v_stage;

  if coalesce(v_count, 0) = 0 then
    raise exception 'Nothing has been filed for this stage yet.' using errcode = 'check_violation';
  end if;

  insert into public.stage_approvals (job_id, stage, approved_by, evidence, confirmed_method)
  values (p_job, v_stage, lower(p_email), v_evidence, v_method);

  update public.jobs
     set stage = v_stage + 1,
         status = 'in_progress',
         updated_at = now()
   where id = p_job;

  return query select p_job, v_stage, v_count, v_method;
end;
$$;

revoke all on function public._do_approve_stage(text, text, text) from public, anon, authenticated;

-- The portal path. Unchanged from the outside: same name, same two
-- arguments, same auth.uid() gate. Everything past establishing v_email now
-- lives in _do_approve_stage.
create or replace function public.approve_stage(p_job text, p_method text default 'evidence')
returns table(job_id text, stage integer, evidence_count integer, confirmed_method text)
language plpgsql
security definer
set search_path to 'public, auth'
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  select lower(btrim(u.email)) into v_email
    from auth.users u
   where u.id = v_uid and u.email_confirmed_at is not null;

  if v_email is null or v_email = '' then
    raise exception 'Confirm your email address first.' using errcode = '28000';
  end if;

  return query select * from public._do_approve_stage(p_job, v_email, p_method);
end;
$$;

-- Grants on a redefined function are dropped by CREATE OR REPLACE only if
-- the signature changes; it did not this time, but reasserted anyway
-- rather than assumed carried over, same discipline every function in this
-- repository that moves work or money follows.
revoke all on function public.approve_stage(text, text) from public, anon, authenticated;
grant execute on function public.approve_stage(text, text) to authenticated;

-- The WhatsApp path. p_phone is whatever the Edge Function read off the
-- inbound message; the only thing trusted about it is that it matches, on
-- the same last-nine-digit tail every phone comparison in this repository
-- uses, the client_phone actually on file for THIS job. A phone that
-- matches some other job with the same client email is not good enough:
-- the check is against this job's own number, not a global "whose phone is
-- this" lookup, which is the tighter of the two and the one that actually
-- answers "does this message belong to this job."
create or replace function public.approve_stage_via_whatsapp(p_job text, p_phone text)
returns table(job_id text, stage integer, evidence_count integer, confirmed_method text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  j record;
  v_tail text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9);
begin
  if length(v_tail) < 7 then
    raise exception 'No usable phone number.' using errcode = '28000';
  end if;

  select * into j from public.jobs where id = p_job;
  if j.id is null then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;

  if right(regexp_replace(coalesce(j.client_phone, ''), '\D', '', 'g'), 9) <> v_tail then
    raise exception 'That number is not on record for this job.' using errcode = '28000';
  end if;

  return query select * from public._do_approve_stage(p_job, j.client_email, 'whatsapp');
end;
$$;

-- No grant to authenticated, and none to anon or public either: this is
-- reached only from yaad-inbound, on the service role, after it has
-- already matched the sender's number to this exact job and asked for the
-- job's own code back. A client-side session has no business calling this
-- directly, it has approve_stage() for that.
revoke all on function public.approve_stage_via_whatsapp(text, text) from public, anon, authenticated;
