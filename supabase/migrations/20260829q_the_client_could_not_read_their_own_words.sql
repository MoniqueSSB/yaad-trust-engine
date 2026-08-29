-- The client could not read the conversation that created their own job.
--
-- intake_threads holds the WhatsApp or email exchange the intake agent had
-- with the client: what they asked for, in their own words, before any of it
-- was normalised into jobs.descr. Since 20260829a the table has had exactly
-- one policy, is_admin(), so the only people who could read a client's own
-- words back to them were us.
--
-- That is the wrong way round. The transcript is the client's own message.
-- The portal's whole claim is that both sides can see what was agreed, and a
-- brief the reader cannot trace back to what they actually said is an
-- assertion rather than a record.
--
-- THE WORKER IS DELIBERATELY NOT INCLUDED.
--
-- Not an oversight, and not to be relaxed later without deciding it again.
-- The transcript carries the things open_jobs strips from the board for a
-- reason: the address, and the phone number of whoever lets a worker in. A
-- real row on the live site reads
--
--   Who can let a worker in:
--      (my aunt next door, 876 555 0142)
--
-- That is a named person's number attached to a house that is often empty,
-- and it is not the quoting worker's to have. jobs.descr is scrubbed before
-- it reaches the board precisely so this never travels. A policy letting any
-- party to the job read the raw thread would hand it over unscrubbed and
-- quietly undo that.
--
-- The client sees it because it is theirs. Nobody else gains anything here.

drop policy if exists "intake_threads_client_reads_own" on public.intake_threads;

create policy "intake_threads_client_reads_own"
  on public.intake_threads
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.jobs j
       where j.id = intake_threads.job_id
         -- Compared only when both sides are real. Most jobs taken on
         -- WhatsApp have no client_email yet, and a JWT can carry no email at
         -- all. Without this guard '' = '' is true and every one of those
         -- threads would be readable by any signed-in account.
         and btrim(coalesce(j.client_email, '')) <> ''
         and btrim(coalesce(auth.jwt() ->> 'email', '')) <> ''
         and lower(btrim(j.client_email)) = lower(btrim(auth.jwt() ->> 'email'))
    )
  );
