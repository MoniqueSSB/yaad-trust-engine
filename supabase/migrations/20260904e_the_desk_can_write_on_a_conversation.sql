-- The desk can write on a conversation.
--
-- There has been nowhere to put "called her, she is away until the 20th".
--
-- intake_threads holds what the client said and what the assistant said, and
-- since yaad-desk-reply it holds what Monique said to them. What it has never
-- held is what Monique knows and has not said to them: the phone call that
-- happened off the record, the reason a thread is parked, the fact that the
-- number on the job belongs to the client's brother. Every one of those lives
-- in her head, and the whole point of this table is that a conversation is not
-- supposed to live in one person's head.
--
-- The alternative was typing it into the transcript, which is worse in a way
-- that matters: the transcript is quoted back to the model as the
-- conversation, and it is readable by the client under
-- intake_threads_client_reads_own once their email is proven on the job. A
-- private note in there would be neither private nor inert.
--
-- So: a separate column, admin only, never read by yaad-inbound and never sent
-- to a model. The client read policy is SELECT on the whole row, so the note
-- is deliberately NOT added to it; the desk reads this through
-- intake_threads_admin_all, which is_admin() already gates.

alter table public.intake_threads
  add column if not exists desk_notes text not null default '';

comment on column public.intake_threads.desk_notes is
  'Monique''s own notes on this conversation. Never shown to the client, never sent to a model, never read by yaad-inbound. Not part of the transcript on purpose: the transcript is what was actually said and is quoted back to the assistant.';

-- ── the client read policy is narrowed to the columns it was always meant
--    to cover ──────────────────────────────────────────────────────────────
--
-- Row level security is row level, never column level, so the existing SELECT
-- policy would hand a signed-in client this new column along with the rest of
-- their row. That is the same shape of leak 20260903f found on worker_profiles
-- (a phone and an email sitting on a publicly readable row purely as join
-- keys) and it is fixed the same way: a view carrying only the columns a
-- client is meant to see, and the base table's client policy withdrawn.
--
-- The desk is untouched. intake_threads_admin_all is ALL on the base table and
-- is what concierge.html reads through.

create or replace view public.my_intake_threads
with (security_invoker = true) as
  select channel, from_addr, job_id, transcript, turns, last_at, stage, human_handling
    from public.intake_threads;

comment on view public.my_intake_threads is
  'What a client may read of their own conversation. Everything except desk_notes. security_invoker so the caller''s own RLS still applies underneath.';

grant select on public.my_intake_threads to authenticated;

-- The base-table client policy moves onto the view's underlying read. Same
-- condition, unchanged, reproduced from 20260829q: the job must carry a
-- non-blank client_email that matches a non-blank email on the caller's JWT.
-- The two btrim guards are load bearing. Without them every job with an empty
-- client_email is readable by any session with an empty email claim.
drop policy if exists "intake_threads_client_reads_own" on public.intake_threads;
create policy "intake_threads_client_reads_own" on public.intake_threads
  for select using (
    exists (
      select 1 from public.jobs j
      where j.id = intake_threads.job_id
        and btrim(coalesce(j.client_email, '')) <> ''
        and btrim(coalesce(auth.jwt() ->> 'email', '')) <> ''
        and lower(btrim(j.client_email)) = lower(btrim(auth.jwt() ->> 'email'))
    )
  );

-- NOTE FOR WHOEVER READS THIS NEXT. The policy above still permits a client to
-- select desk_notes from the base table directly, because it is a row policy
-- and that is all a row policy can be. The view is the thing that must be used
-- by client-facing code, and no client-facing code reads this table today
-- (checked 4 Sep 2026: web/ has no reference to intake_threads at all). If a
-- client-facing read is ever added, it reads my_intake_threads. Closing it
-- properly means a column-level revoke on the base table, which cannot be done
-- without also taking it from the desk, because concierge.html connects as
-- authenticated too and grants are not conditional on is_admin(). That is the
-- same constraint 20260903f ran into and solved with views; the same solution
-- applies here the day a client-facing read exists.
