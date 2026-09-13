-- A vetting decision says who made it.
--
-- CLAUDE.md §2: "AI coordinates, verifies and drafts. It never releases money,
-- rules on a dispute, or alters a reputation. A named human confirms every
-- consequential step." Passing or blocking a worker's application is the step
-- that decides whether somebody can earn on this platform. It is as
-- consequential as anything here.
--
-- It was true in practice and unprovable afterwards. The desk wrote
-- applications.status directly, through the generic action mechanism, with no
-- record of who pressed the button or when. vetting_reviews holds the AI's
-- read of the documents, not the person's ruling. So on the day somebody asks
-- why a worker was blocked, the answer is a status string with nobody's name
-- on it.
--
-- THE SHAPE IS THE ONE THIS REPOSITORY ALREADY USES for anything that has to
-- prove a human decided: a security definer RPC that derives the actor from
-- the session rather than trusting a caller-supplied name, plus a trigger that
-- refuses the write if the attribution is absent. approve_quote_pack_draft()
-- is the RPC pattern, kickoff_approval_attributed is the trigger pattern. The
-- trigger is what makes it a rule rather than a habit: it holds for the desk,
-- for a script, for psql, and for whatever surface is written next.
--
-- THE HISTORY IS LEFT NULL ON PURPOSE. There are eleven already-decided rows
-- and nobody knows who decided them. Backfilling a plausible name would put a
-- false attribution into the exact record this exists to make trustworthy, and
-- backfilling 'system' would claim a machine did it, which is worse. NULL
-- reads as "not recorded", which is the true statement.

alter table public.applications add column if not exists decided_by    text;
alter table public.applications add column if not exists decided_at    timestamptz;
alter table public.applications add column if not exists decision_note text;

comment on column public.applications.decided_by is
  'The named person who passed, blocked or gapped this application, taken from their session by decide_application() and never from a caller-supplied value. NULL means the decision predates attribution (5 September 2026) and genuinely is not recorded; it is deliberately not backfilled, because a guessed name in this column is worse than an absent one.';

-- 'approved' and 'declined' are legacy spellings still present in the data.
-- They are in the guarded set so a decision cannot be slipped in under an old
-- name, which is the obvious way round a list of three.
create or replace function public.application_decision_attributed()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  decided constant text[] := array['passed','blocked','gap','approved','declined'];
  who text;
begin
  if new.status is distinct from old.status and new.status = any (decided) then
    who := nullif(btrim(coalesce(new.decided_by, '')), '');
    if who is null then
      raise exception
        'A vetting decision has to say who made it. Call decide_application() rather than writing status directly.'
        using errcode = 'check_violation';
    end if;
    if who ~* '^(system|auto|agent|admin)$' or who like 'system:%' then
      raise exception
        '% is not a named human. A vetting decision records the person who made it.', who
        using errcode = 'check_violation';
    end if;
    if new.decided_at is null then
      new.decided_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_application_decision_attributed on public.applications;
create trigger trg_application_decision_attributed
  before update on public.applications
  for each row execute function public.application_decision_attributed();

-- The one door. Admin only, and the name comes from the session, so a caller
-- cannot decide as somebody else.
create or replace function public.decide_application(
  p_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_admin text := nullif(btrim(lower(auth.jwt() ->> 'email')), '');
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  if v_admin is null then
    raise exception 'No signed-in person to attribute this to.' using errcode = '28000';
  end if;
  if p_status not in ('passed','blocked','gap') then
    raise exception 'A vetting decision is passed, blocked or gap.' using errcode = 'check_violation';
  end if;

  update public.applications
     set status        = p_status,
         decided_by    = v_admin,
         decided_at    = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;

  if not found then
    raise exception 'No such application.' using errcode = 'check_violation';
  end if;
end;
$$;

revoke all on function public.decide_application(uuid, text, text) from public, anon;
grant execute on function public.decide_application(uuid, text, text) to authenticated;

-- Capacity stops undercounting. Sending a gap back is included: it is still
-- the person's judgement and still their evening, which is what this measures.
create or replace view public.desk_decisions
with (security_invoker = true) as
    select 'evidence sign-off'::text as kind, sa.job_id, sa.approved_at as at, sa.approved_by as who
      from public.stage_approvals sa
     where sa.approved_at is not null
       and coalesce(sa.approved_by, '') <> ''
       and sa.approved_by not like 'system:%'
  union all
    select 'quote review', qr.job_id, qr.created_at, qr.reviewed_by
      from public.quote_reviews qr
     where coalesce(qr.reviewed_by, '') <> ''
       and qr.reviewed_by not like 'system:%'
  union all
    select 'materials release', mr.job_id, mr.released_at, mr.released_by
      from public.materials_releases mr
     where mr.released_at is not null
       and coalesce(mr.released_by, '') <> ''
       and mr.released_by not like 'system:%'
  union all
    select 'quote pack cleared', qp.job_id, qp.approved_at, qp.approved_by
      from public.quote_pack_drafts qp
     where qp.approved_at is not null
       and coalesce(qp.approved_by, '') <> ''
       and qp.approved_by not like 'system:%'
  union all
    select 'kickoff pack approved', kp.job_id, kp.approved_at, kp.approved_by
      from public.kickoff_packs kp
     where kp.approved_at is not null
       and coalesce(kp.approved_by, '') <> ''
       and kp.approved_by not like 'system:%'
  union all
    select 'sketch pack approved', sp.job_id, sp.approved_at, sp.approved_by
      from public.sketch_packs sp
     where sp.approved_at is not null
       and coalesce(sp.approved_by, '') <> ''
       and sp.approved_by not like 'system:%'
  union all
    -- No job_id: a vetting decision is about a person, not a job.
    select 'vetting decision', null::text, a.decided_at, a.decided_by
      from public.applications a
     where a.decided_at is not null
       and coalesce(a.decided_by, '') <> ''
       and a.decided_by not like 'system:%';

comment on view public.desk_decisions is
  'Every consequential step a named person actually took, with when. Rows whose approver reads system:* are excluded, because an auto-issued guardrail-clean pack is the system deciding the content was clean, not a person sitting down to a decision. Vetting decisions carry no job_id because they are about a person. Decisions taken before 5 September 2026 are absent from the vetting arm: they were never attributed and are deliberately not backfilled.';

grant select on public.desk_decisions to authenticated;
