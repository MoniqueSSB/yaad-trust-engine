-- Founder's own finding, 31 Aug 2026: a stage with more than one item has
-- no way to say which AI finding or which comment belongs to which. The
-- ledger shows "2 items" and the AI review returns two findings, but
-- nothing on either side names which item they are about, and nothing a
-- worker or client types over WhatsApp can point at one specific photo
-- either, only the whole stage.
--
-- The job code (JOB-WEB-1788006231445) is the pattern already proven to
-- work typed back over WhatsApp, but copying its length onto a per-photo
-- code would be the wrong lesson to take from it: this repository already
-- paid for one assumption about a code's length going unverified (the
-- sign-in OTP, DECISIONS.md 31 Aug 2026, six assumed, eight actually
-- issued). The fix there was not a longer code, it was checking the real
-- one rather than guessing. Applied here: an item code only ever has to
-- be unique WITHIN a job a person is already inside, over WhatsApp with an
-- active session or in the portal on that job's own page, never across
-- the whole system, so there is no reason to carry a job's own long id
-- inside it at all. Short and disposable: P1, P2, P3, sequential per job
-- in filing order. "P" rather than a bare number specifically so it can
-- never be misread as the ordinal-number convenience pickJobChoice() and
-- matchApprovingJob() already use elsewhere in this repository ("reply 1
-- to confirm", "reply 1 to send the draft"), which answers a different
-- question and must never be confused with this one.

alter table public.evidence add column if not exists item_code text;

-- Backfilled in filing order, same order the ledger already lists items in.
update public.evidence e
   set item_code = 'P' || sub.n
  from (
    select id, row_number() over (partition by job_id order by created_at, id) as n
      from public.evidence
  ) sub
 where sub.id = e.id
   and e.item_code is null;

alter table public.evidence add constraint evidence_item_code_uniq unique (job_id, item_code);

-- Assigns the next code in filing order at insert time, the same "one
-- authority decides" shape sync_job_status() already uses for jobs.status:
-- callers never set item_code themselves, so there is one place this can
-- go wrong rather than one per caller (the portal upload, the video
-- upload, and WhatsApp evidence intake all insert into this table).
create or replace function public.assign_evidence_item_code()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  next_n integer;
begin
  if new.item_code is not null then
    return new;
  end if;
  -- A burst of photos filed at once (the founder's own "what if someone
  -- sends several at the same time" question, 31 Aug 2026) is exactly the
  -- case where two inserts could read the same max before either commits.
  -- An advisory lock scoped to this job serialises code assignment for
  -- that job only; a different job's upload is never blocked by this, and
  -- the lock releases itself at the end of the transaction.
  perform pg_advisory_xact_lock(hashtext(new.job_id));
  select coalesce(max(substring(item_code from '^P(\d+)$')::integer), 0) + 1
    into next_n
    from public.evidence
   where job_id = new.job_id;
  new.item_code := 'P' || next_n;
  return new;
end;
$$;

drop trigger if exists trg_assign_evidence_item_code on public.evidence;
create trigger trg_assign_evidence_item_code
  before insert on public.evidence
  for each row execute function public.assign_evidence_item_code();

comment on column public.evidence.item_code is
  'Short per-job code (P1, P2, ...), sequential in filing order. Lets one WhatsApp reply or portal comment name a single photo or video rather than only a whole stage. Assigned once at insert, never edited.';
