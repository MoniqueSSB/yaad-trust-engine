-- Applied to production 3 Sep 2026 via MCP as
-- a_client_puts_their_own_photograph_on_the_board.
--
-- The client decides whether a photograph THEY sent goes on the public board.
--
-- 20260902v made publishing a photograph a decision at the desk, and it was
-- right to: at that point every photograph had arrived in a WhatsApp
-- conversation, and a picture sent into a private chat is not consent to put
-- it on a public page. 20260902w then gave the client a way to send
-- photographs themselves, and the founder's next instruction was that those
-- should be able to reach the live marketplace with the job. That changes
-- who the consenting person is. A client who uploads a photograph and ticks
-- "show it with the job" has consented in the one place consent can be
-- given, and routing that through the desk would just be a human clicking
-- what the client already said. So for source = 'client' rows only, the
-- client holds board_ok, both ways, and can withdraw the picture entirely.
--
-- WhatsApp photographs (source = 'whatsapp') are unchanged: still private
-- until a person at the desk publishes them, still not the client's to
-- delete, because they were saved by the assistant out of a conversation.
--
-- The board itself did not need to change. app/jobs reads every board_ok row
-- regardless of source, and the storage policy that signs the file for the
-- board checks the folder is named after the job, not which prefix it is
-- under, so 'client/<job>/…' signs the same way 'whatsapp/<job>/…' does.

-- ---------------------------------------------------------------- insert

-- Same policy as 20260902w with one line gone: board_ok may now arrive true.
-- Everything else holds, in particular the path prefix and the job check.
drop policy if exists "client adds photos to own job" on public.job_photos;

create policy "client adds photos to own job" on public.job_photos
  for insert to authenticated
  with check (
    source = 'client'
    and storage_path is not null
    and storage_path like 'client/' || job_id || '/%'
    and exists (
      select 1 from public.jobs j
      where j.id = job_photos.job_id
        and lower(j.client_email) = lower(auth.jwt() ->> 'email')
    )
  );

-- ---------------------------------------------------------------- publish

-- A function rather than an update policy, so the only column a client can
-- reach on this table is the one they are meant to reach. An update policy
-- would have let them rewrite storage_path, and 20260902v records exactly
-- why that must not happen: a row pointing at another job's file, marked
-- for the board, gets the board to sign somebody else's photograph.
create or replace function public.set_job_photo_board_as_me(p_photo uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_row   job_photos%rowtype;
begin
  if v_email is null then
    raise exception 'Sign in as the client of this job to change what the board shows.'
      using errcode = '28000';
  end if;

  select * into v_row from job_photos where id = p_photo for update;
  if not found then
    raise exception 'no such photo';
  end if;

  if not public.is_admin() and not exists (
    select 1 from jobs j
    where j.id = v_row.job_id
      and lower(coalesce(j.client_email, '')) = v_email
  ) then
    raise exception 'Only the client of this job can change what the board shows.'
      using errcode = '42501';
  end if;

  if v_row.source is distinct from 'client' and not public.is_admin() then
    raise exception 'This one came in on WhatsApp, so a person at Yaadly decides whether it is shown. Ask, and it is done the same day.'
      using errcode = '42501';
  end if;

  update job_photos set board_ok = p_on where id = p_photo;
end $$;

revoke execute on function public.set_job_photo_board_as_me(uuid, boolean) from public, anon;
grant  execute on function public.set_job_photo_board_as_me(uuid, boolean) to authenticated;

comment on function public.set_job_photo_board_as_me(uuid, boolean) is
  'The client of a job puts a photograph they sent themselves on or off the public board. WhatsApp photographs stay the desk''s call.';

-- ---------------------------------------------------------------- delete

-- The client may now withdraw a photograph they sent whether or not it is on
-- the board: if they were the one who put it there, they are the one who
-- takes it down. The source check is what still keeps WhatsApp photographs
-- out of reach.
drop policy if exists "client removes a photo they sent" on public.job_photos;

create policy "client removes a photo they sent" on public.job_photos
  for delete to authenticated
  using (
    source = 'client'
    and exists (
      select 1 from public.jobs j
      where j.id = job_photos.job_id
        and lower(j.client_email) = lower(auth.jwt() ->> 'email')
    )
  );

-- Proven 3 Sep 2026 inside a rolled back transaction, as role authenticated
-- with request.jwt.claims set to a made-up client who is NOT an admin, the
-- real job reassigned to them for the duration and a WhatsApp photo row
-- planted on it, all undone by the rollback.
--
--   upload marked for the board .......... ALLOWED
--   upload into whatsapp/ prefix ......... REFUSED 42501
--   upload onto somebody else's job ...... REFUSED 42501
--   take own photo off the board ......... ALLOWED, now private
--   put own photo back on the board ...... ALLOWED, now public
--   publish a WhatsApp photo ............. REFUSED 42501
--   delete a WhatsApp photo .............. REFUSED (0 rows)
--   delete own photo while on the board .. ALLOWED
--   stranger publishes on this job ....... REFUSED 42501
