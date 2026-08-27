-- app_settings had row level security switched on and not one policy written
-- against it. RLS with no policy is not "admin only", it is "nobody", so every
-- read from the desk came back as zero rows and the Settings view showed its
-- empty state. An empty view is supposed to mean an empty table. It did not
-- here, and that is the worst kind of wrong: quiet.
--
-- The edge functions were never affected. They hold the service role key,
-- which bypasses RLS, which is exactly why nobody noticed.
--
-- Admin only, read and write, using the same predicate every other table uses.
alter table public.app_settings enable row level security;

drop policy if exists "app_settings are admin only" on public.app_settings;
create policy "app_settings are admin only"
  on public.app_settings for all
  to authenticated
  using (is_admin())
  with check (is_admin());
