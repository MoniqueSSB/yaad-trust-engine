-- Views stop being writable by the browser.
--
-- Supabase's default privileges grant ALL on every new object to anon and
-- authenticated. On a TABLE that is survivable, because row level security is
-- what actually decides, and every table here has it. On a VIEW it is not,
-- and the reason is worth writing down because it is not obvious:
--
--   a view with no `security_invoker` runs as its OWNER. A simple view (one
--   table, no join, no aggregate) is also AUTO-UPDATABLE, so a write through
--   it reaches the base table. Put those together and a definer view with a
--   DELETE grant is a hole straight past RLS.
--
-- public_worker_profiles was exactly that combination, created earlier the
-- same day by 20260903f: single table, plain WHERE, no security_invoker, and
-- DELETE/INSERT/UPDATE/TRUNCATE granted to anon by default. Reads through it
-- were safe, which is what that migration was for. Writes were not, and
-- nobody meant to allow them.
--
-- Nothing in this repository writes through a view. Checked, per view, across
-- web/, supabase/functions/ and concierge/ before this was written: zero
-- insert, update, delete or upsert calls against any of them. So this takes
-- away only privileges that exist by accident.
--
-- SELECT is untouched. That is the entire point of these views.
--
-- Applies to every view in the schema rather than the five that happened to
-- carry the grants, so a view added tomorrow that inherits the defaults is
-- covered by re-running this rather than by somebody remembering.

do $$
declare v record;
begin
  for v in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v','m')
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated, public',
      v.relname
    );
  end loop;
end $$;
