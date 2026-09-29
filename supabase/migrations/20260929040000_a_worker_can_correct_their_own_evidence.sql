-- A worker can correct their own evidence, and the correction stays on record.
--
-- WHY. Founder instruction, 28 Sep 2026, while running a job end to end from
-- the worker's side: "there should be sections always for the worker to edit
-- or make corrections". Until now a filed item could not be touched by the
-- person who filed it. The portal said so ("It cannot be edited now"), and a
-- wrong caption or a photo marked Before that was really During stayed wrong
-- in front of the client for good.
--
-- WHAT CAN CHANGE. The words on the item (label) and which part of the job it
-- shows (phase), on WORK items only. Never the file, never its fingerprint,
-- never the stage it is filed on, never the kind: a materials item is what
-- passes the risk in the materials to the client, and that is not a caption.
--
-- WHEN. Only by the worker who filed it (evidence.uploaded_by is their JWT
-- email, and they are the booked worker on the job), only while the item is
-- on the stage still being worked (evidence.stage = jobs.stage), and never on
-- a closed job. Once the client has signed a stage off, jobs.stage has moved
-- past it and its evidence is fixed, because that is what was approved.
--
-- ON RECORD. Every correction writes a row to evidence_corrections with the
-- wording and part before and after, who, and when, and stamps
-- evidence.corrected_at so the portal can say "Corrected" on the card. The
-- original wording is never lost, and the client is never shown an edit as if
-- it were what was first sent.
--
-- WHAT THIS DOES NOT DO. It does not let anybody withdraw or delete an item,
-- and it does not touch the client's approval, the stage, or any money.

alter table public.evidence
  add column if not exists corrected_at timestamptz;

comment on column public.evidence.corrected_at is
  'Last time the worker who filed this corrected its words or part, through correct_evidence_as_me(). The history is in evidence_corrections.';

create table if not exists public.evidence_corrections (
  id          uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references public.evidence(id) on delete cascade,
  job_id      text not null,
  by_email    text not null,
  at          timestamptz not null default now(),
  old_label   text,
  new_label   text,
  old_phase   text,
  new_phase   text
);

comment on table public.evidence_corrections is
  'Every correction a worker made to their own evidence: the words and part before and after. Written only by correct_evidence_as_me(). Nothing edits or deletes a row here.';

create index if not exists evidence_corrections_evidence_idx on public.evidence_corrections (evidence_id, at);

alter table public.evidence_corrections enable row level security;

-- Read by the two parties to the job and by an admin. No insert, update or
-- delete policy: the function below is the only writer.
drop policy if exists "job party reads evidence corrections" on public.evidence_corrections;
create policy "job party reads evidence corrections" on public.evidence_corrections
  for select using (
    public.is_admin() or exists (
      select 1 from public.jobs j
       where j.id = evidence_corrections.job_id
         and (lower(j.client_email) = lower(auth.jwt() ->> 'email')
           or lower(j.worker_email) = lower(auth.jwt() ->> 'email'))
    )
  );

create or replace function public.correct_evidence_as_me(p_id uuid, p_label text, p_phase text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_ev    public.evidence%rowtype;
  v_job   public.jobs%rowtype;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_phase text := nullif(btrim(coalesce(p_phase, '')), '');
begin
  if v_email = '' then
    raise exception 'Sign in to correct your evidence.';
  end if;

  select * into v_ev from public.evidence where id = p_id for update;
  if not found then
    raise exception 'That evidence item was not found.';
  end if;

  select * into v_job from public.jobs where id = v_ev.job_id;

  if lower(coalesce(v_ev.uploaded_by, '')) <> v_email
     or lower(coalesce(v_job.worker_email, '')) <> v_email then
    raise exception 'Only the worker who filed this can correct it.';
  end if;

  if v_job.status = 'complete' or coalesce(v_ev.stage, 0) <> coalesce(v_job.stage, 0) then
    raise exception 'This stage has been signed off, so its evidence is fixed as it was approved. Add a new item or message Yaadly instead.';
  end if;

  if v_label is null then
    raise exception 'Say what the item shows before saving.';
  end if;
  if length(v_label) > 300 then
    raise exception 'Keep it under 300 characters.';
  end if;

  if v_ev.kind = 'materials' then
    v_phase := null;
  elsif v_phase is not null and v_phase not in ('before', 'during', 'after', 'issue', 'new') then
    raise exception 'That is not one of the parts of the job.';
  end if;

  if v_label is not distinct from v_ev.label and v_phase is not distinct from v_ev.phase then
    return false;
  end if;

  insert into public.evidence_corrections (evidence_id, job_id, by_email, old_label, new_label, old_phase, new_phase)
  values (v_ev.id, v_ev.job_id, v_email, v_ev.label, v_label, v_ev.phase, v_phase);

  update public.evidence
     set label = v_label,
         phase = v_phase,
         -- an After that is no longer an After answers nothing
         pairs_with = case when v_phase = 'after' then pairs_with else null end,
         phase_set_by = case when v_phase is distinct from v_ev.phase then v_email else phase_set_by end,
         phase_set_at = case when v_phase is distinct from v_ev.phase then now() else phase_set_at end,
         corrected_at = now()
   where id = v_ev.id;

  return true;
end;
$$;

comment on function public.correct_evidence_as_me(uuid, text, text) is
  'The worker who filed an item corrects its words and part while its stage is still being worked. Never the file, fingerprint, stage or kind. Logged to evidence_corrections.';

revoke all on function public.correct_evidence_as_me(uuid, text, text) from public, anon;
grant execute on function public.correct_evidence_as_me(uuid, text, text) to authenticated;
