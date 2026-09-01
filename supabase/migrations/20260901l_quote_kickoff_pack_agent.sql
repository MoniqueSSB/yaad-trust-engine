-- Quote Kickoff Pack, step 1 of 3: the draft store and its trigger.
--
-- Founder's own correction, 1 Sep 2026: what fires the moment a client
-- accepts a quote (request_kickoff_as_me, kickoff_requested) was drafting
-- the big 12-section Kickoff Pack, which is wrong twice over. First, that
-- pack already requires a chosen worker and a job the client is committing
-- to; a quote nobody has picked yet has no business drafting one. Second,
-- and the actual point of this migration: a worker's own quote today is
-- four bare numbers (job_quotes.labour_jmd etc, see QuotePanel.tsx). The
-- founder's stated design is that a worker instead gets a short AI-drafted
-- overview of the job (what's being done, roughly when, how payment stages
-- work) the moment the job goes live, reviews and edits it to their own
-- terms, drops their price in, and THAT edited pack is what gets sent to
-- the client as their quote. The big Kickoff Pack is untouched by any of
-- this: it still fires at kickoff_requested exactly as it does today,
-- against whichever quote(s) the client has by then accepted.
--
-- One draft per JOB, not per worker: the scope and rough timeline come from
-- the job intake, which does not change depending on who is reading it.
-- Every worker who opens the quote form for that job edits their own copy
-- of the SAME starting draft; editing it is a client-side operation on
-- job_quotes, not a write to this table.
--
-- Same shape as kickoff_drafts on purpose (status/docs/model/guardrail/
-- error/created_at/finished_at), deliberately smaller: no evidence
-- checklist, no risk register, none of the big pack's twelve sections.
-- Written only by yaad-quote-pack, service role, same as kickoff_drafts.
create table if not exists public.quote_pack_drafts (
  id          uuid primary key default gen_random_uuid(),
  job_id      text not null references public.jobs(id),
  status      text not null default 'drafting' check (status in ('drafting','ready','failed')),
  docs        jsonb,
  model       text,
  guardrail   jsonb,
  error       text,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists quote_pack_drafts_job_id_idx on public.quote_pack_drafts(job_id);

alter table public.quote_pack_drafts enable row level security;

create policy "admin full access to quote_pack_drafts"
  on public.quote_pack_drafts for all
  using (public.is_admin()) with check (public.is_admin());

-- Same audience as the open_jobs board itself (jobs.open = true, unassigned,
-- stage = 0): this draft describes nothing a worker could not already read
-- on the board, and every worker considering the job needs to see it, not
-- only whoever eventually quotes. No insert/update/delete policy for
-- authenticated: only the service role, from yaad-quote-pack, ever writes
-- a row here, same trust boundary as kickoff_drafts.
create policy "workers can read drafts for open jobs"
  on public.quote_pack_drafts for select
  to authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = quote_pack_drafts.job_id
        and j.open = true
        and coalesce(j.worker_email, '') = ''
        and j.stage = 0
    )
  );

-- The worker's edited pack travels with their quote, not as a separate
-- table: it is specific to one worker's price and terms the moment they
-- touch it, which job_quotes already is and quote_pack_drafts deliberately
-- is not. Plain text, same as the draft: the founder's own description is
-- "editable text" for all three, not a structured form.
alter table public.job_quotes
  add column if not exists scope_summary text,
  add column if not exists timeline_note text,
  add column if not exists payment_stage_note text;

comment on table public.quote_pack_drafts is
  'One AI-drafted overview per job (scope, rough timeline, payment-stage structure), no prices, no escrow. A worker reviews, edits and adds their own price on job_quotes; that edited copy is the quote the client sees. See CLAUDE.md guardrail on price/escrow language and 20260901l.';
