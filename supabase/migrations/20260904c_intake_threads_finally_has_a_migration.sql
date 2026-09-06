-- intake_threads finally has a migration.
--
-- This table is the record of every conversation Yaadly has ever had, and it
-- was created by hand in the Supabase dashboard rather than through a file.
-- Later migrations add columns to it (20260829a its policies, 20260829q the
-- client read, 20260902a human_handling), so the repository has been able to
-- alter a table it could not create.
--
-- That matters more here than it would elsewhere. Supabase is on the free
-- plan: no daily backups, no point in time recovery (CLAUDE.md section 12,
-- scripts/backup-db.sh). The shape of the table holding every client
-- conversation existed in exactly one place, which was the running database.
--
-- WRITTEN FROM THE LIVE TABLE, not from memory. Columns, the composite primary
-- key, the foreign key with its ON DELETE CASCADE, the stage check constraint,
-- the job index and both policies were all read out of leffyisvfvjwzilydlwf on
-- 4 September 2026 and are reproduced here exactly.
--
-- EVERY STATEMENT IS IF NOT EXISTS OR A NO-OP ON THE LIVE DATABASE. Running
-- this against production changes nothing; it exists so that a rebuild from
-- the repository produces the table that is actually there. If it ever does
-- change something, that is the drift it was written to make visible.

create table if not exists public.intake_threads (
  channel        text not null,
  from_addr      text not null,
  job_id         text not null references public.jobs(id) on delete cascade,
  transcript     text not null default '',
  turns          integer not null default 1,
  last_at        timestamptz not null default now(),
  stage          text not null default 'gathering',
  human_handling boolean not null default false,
  primary key (channel, from_addr)
);

-- gathering: still collecting. confirming: read back, waiting on the client to
-- say it is right. done: the job was written and the client agreed to it.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.intake_threads'::regclass and conname = 'intake_threads_stage_chk'
  ) then
    alter table public.intake_threads
      add constraint intake_threads_stage_chk
      check (stage = any (array['gathering'::text, 'confirming'::text, 'done'::text]));
  end if;
end $$;

create index if not exists intake_threads_job_idx on public.intake_threads (job_id);

alter table public.intake_threads enable row level security;

-- Both policies as they stand live. Repeated here rather than left to their
-- original migrations, so this file alone rebuilds a table that is safe.
drop policy if exists "intake_threads_admin_all" on public.intake_threads;
create policy "intake_threads_admin_all" on public.intake_threads
  for all using (is_admin()) with check (is_admin());

-- A client reads their own conversation, and only once the job actually
-- carries their proven email. A blank on either side matches nothing, which is
-- what the two btrim guards are for: without them every job with an empty
-- client_email would be readable by any session with an empty JWT email.
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

comment on table public.intake_threads is
  'One row per person per channel: the whole conversation, word for word, as the assistant and the desk saw it. human_handling true means Monique has taken it and yaad-inbound stands down. Created by hand in August 2026; this migration was written from the live table on 4 Sep 2026 so the repository can rebuild it.';
