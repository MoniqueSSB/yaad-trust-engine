-- A discovery is not an issue, and an after answers a named before.
--
-- Builds on 20260906000700, which added evidence.phase and the five sections a
-- client reads a stage in. This does not replace any of that. It adds the one
-- value that was missing and the one relationship that was not recorded.
--
-- Written after a collision: two Claude sessions were asked for this on the
-- same day and both built it. 20260906000700 was merged first and is the one
-- that survives. Founder's call, 5 September 2026, on being shown both.
--
-- ── Why 'new' is its own value and not a kind of issue ──
--
-- 20260906000700 describes issue as "a problem found on site: rot behind the
-- panel, a pipe nobody knew was there", and the client-facing note under it
-- reads "Found on site, and not part of what was originally quoted". That is
-- two different things wearing one word, and the difference is money.
--
--   issue  a problem with work that is already in scope and already priced.
--          The wall is not square, the joint the worker was paid to make has
--          failed. Nothing about it changes what the client pays.
--   new    something discovered that was never in the job. Rot behind a panel
--          nobody had opened. Work nobody has quoted and nobody has agreed,
--          and somebody is going to have to pay for it.
--
-- Founder's instruction: keep them apart. Folded together, the one that costs
-- money is hidden inside the one that does not, which is how it turns into an
-- argument in December instead of a decision in November.
--
-- 'new' is a plain value in a text column. It is not a keyword here, and
-- nothing in this file is a plpgsql NEW record.
--
-- ── The pairing ──
--
-- An after names the before it answers, so the portal can show them as a
-- matched pair rather than two lists the client eyeballs. The key is item_code
-- (P1, P2, P3), added by 20260831zzzz2 so one WhatsApp reply could name one
-- photograph rather than a whole stage. This is the second thing it turned out
-- to be for. The worker types the code; pairs_with holds the id.
--
-- Enforced in a trigger, not a CHECK, because every rule is about ANOTHER row:
-- an after only, pointing at a before, on the same job, never at itself. A
-- CHECK cannot see another row, and a foreign key alone would let an after on
-- one job answer a before on somebody else's.

alter table public.evidence drop constraint if exists evidence_phase_chk;
alter table public.evidence add constraint evidence_phase_chk
  check (
    phase is null
    or (phase in ('before', 'during', 'after', 'issue', 'new') and kind is distinct from 'materials')
  );

comment on column public.evidence.phase is
  'before, during, after, issue (a problem with work already in scope and already priced) or new (something discovered on site that was never in the job, and that nobody has quoted or agreed), declared by the person filing it in answer to a direct question, never read out of the label. Null means nobody said, which is not the same as no, and is what every row filed before 5 Sep 2026 carries. Refused on kind = materials, which is its own section and is read off kind instead.';

-- on delete set null rather than cascade. If a before is ever removed, the
-- after is still real evidence of real work and must not vanish with it; it
-- simply stops claiming to answer something that is no longer there.
alter table public.evidence add column if not exists pairs_with uuid
  references public.evidence(id) on delete set null;

comment on column public.evidence.pairs_with is
  'The before this after answers, by id. The worker names it with the short item_code (P3). Only ever set on an after, only ever points at a before on the same job. See trg_evidence_pair_is_sane.';

create or replace function public.evidence_pair_is_sane()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  target record;
begin
  if new.pairs_with is null then
    return new;
  end if;

  if new.pairs_with = new.id then
    raise exception 'A photo cannot answer itself.';
  end if;

  if new.phase is distinct from 'after' then
    raise exception 'Only an after photo can answer a before.';
  end if;

  select job_id, phase, item_code into target
    from public.evidence where id = new.pairs_with;

  if not found then
    raise exception 'That before photo does not exist.';
  end if;
  if target.job_id is distinct from new.job_id then
    raise exception 'A before and the after that answers it must be on the same job.';
  end if;
  if target.phase is distinct from 'before' then
    raise exception 'An after can only answer a before, and % is not one.', coalesce(target.item_code, 'that item');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_evidence_pair_is_sane on public.evidence;
create trigger trg_evidence_pair_is_sane
  before insert or update of phase, pairs_with on public.evidence
  for each row execute function public.evidence_pair_is_sane();

create index if not exists evidence_pairs_with_idx on public.evidence(pairs_with) where pairs_with is not null;

-- ── Correcting a phase, and saying who corrected it ──
--
-- A worker's answer is their claim about their own photograph, not a ruling,
-- and the desk has to be able to fix a wrong one: an after filed as a before
-- puts it in the wrong section of a client's record and no amount of good
-- intent fixes that afterwards.
--
-- What it must not be is silent. This is evidence. Overwriting what the worker
-- said with no trace of who changed it would make the record less trustworthy
-- than leaving the mistake in. Null means nobody has corrected it and the
-- answer is exactly what the person who filed it gave.
alter table public.evidence add column if not exists phase_set_by text;
alter table public.evidence add column if not exists phase_set_at timestamptz;

comment on column public.evidence.phase_set_by is
  'Who corrected this photograph''s phase at the desk, if anybody. Null means it is exactly what the person who filed it said. A correction never touches the image, the description or the fingerprint: only which section it belongs to, and which before an after answers.';

create or replace function public.retag_evidence(
  p_id      uuid,
  p_phase   text,
  p_answers text default null   -- the item_code of the before, e.g. 'P3'
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_job    text;
  v_kind   text;
  v_target uuid;
  v_who    text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not public.is_admin() then
    raise exception 'Admin only.';
  end if;
  if v_who = '' then
    -- Same rule as publishing a worker's profile: a correction whose author
    -- cannot be named is not one anybody can rely on later.
    raise exception 'Cannot tell who is signed in, so this correction would have no name against it.';
  end if;

  select job_id, kind into v_job, v_kind from public.evidence where id = p_id;
  if v_job is null then
    raise exception 'No such evidence item.';
  end if;
  if v_kind = 'materials' then
    raise exception 'Materials evidence is its own section and carries no phase.';
  end if;
  if p_phase is null or p_phase not in ('before','during','after','issue','new') then
    raise exception 'Pick one of before, during, after, issue or new.';
  end if;

  if p_answers is not null and btrim(p_answers) <> '' then
    select id into v_target from public.evidence
     where job_id = v_job and upper(item_code) = upper(btrim(p_answers));
    if v_target is null then
      raise exception 'There is no % on this job.', btrim(p_answers);
    end if;
  end if;

  update public.evidence
     set phase        = p_phase,
         -- A code given against anything but an after is dropped rather than
         -- argued with. trg_evidence_pair_is_sane refuses the rest.
         pairs_with   = case when p_phase = 'after' then v_target else null end,
         phase_set_by = v_who,
         phase_set_at = now()
   where id = p_id;
end;
$$;

grant execute on function public.retag_evidence(uuid, text, text) to authenticated;
