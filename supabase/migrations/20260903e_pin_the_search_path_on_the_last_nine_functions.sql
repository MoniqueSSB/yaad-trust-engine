-- Pin search_path on the last nine functions that did not have it.
--
-- Supabase's advisor reports these as `function_search_path_mutable`. Worth
-- being precise about what that does and does not mean here, because the
-- advisor's wording implies more than is true of this set.
--
-- The classic search_path attack is against a SECURITY DEFINER function: the
-- caller puts a malicious table or operator earlier on the path, the function
-- resolves to it, and the body then runs against that object with the OWNER's
-- privileges. That is escalation, and it is why every definer function in this
-- schema already carries `set search_path to 'public'`.
--
-- All nine below are SECURITY INVOKER. They run with the caller's own
-- privileges, so there is nothing to escalate to: somebody bending the path
-- for one of these is attacking themselves.
--
-- They are pinned anyway, for a duller reason that is real. Four of them are
-- TRIGGER functions (job_quotes_touch, normalise_job_trade,
-- reviews_guard_update, sync_job_status) and a trigger fires in whatever
-- session context happens to be writing at the time. A trigger that resolved
-- `jobs` to something other than public.jobs would corrupt data quietly rather
-- than fail loudly, and sync_job_status in particular decides what stage a job
-- is at. Determinism is worth more there than the attack surface is.
--
-- ALTER FUNCTION rather than CREATE OR REPLACE on purpose: this sets one
-- attribute and does not retype a single line of any body, so there is no way
-- for this migration to change behaviour by transcription error.

alter function public.job_quotes_touch()                    set search_path to 'public';
alter function public.normalise_job_trade()                 set search_path to 'public';
alter function public.reviews_guard_update()                set search_path to 'public';
alter function public.sync_job_status()                     set search_path to 'public';
alter function public.normalize_parish(p_parish text)       set search_path to 'public';
alter function public.parish_centroid(p_parish text)        set search_path to 'public';
alter function public.parish_key(p text)                    set search_path to 'public';
alter function public.trade_key(p text)                     set search_path to 'public';
alter function public.km_between(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
  set search_path to 'public';
