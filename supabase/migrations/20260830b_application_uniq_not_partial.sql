-- The upsert that creates a profile keys on application_id, and PostgREST
-- cannot infer a PARTIAL index for on_conflict: Postgres will only use one
-- when the statement carries a matching WHERE clause, which PostgREST does
-- not emit. So every profile insert failed with "no unique or exclusion
-- constraint matching the ON CONFLICT specification".
--
-- The predicate bought nothing anyway. A plain unique index already permits
-- any number of NULLs, which is the only reason the predicate was there.
drop index if exists public.worker_profiles_application_uniq;

create unique index if not exists worker_profiles_application_uniq
  on public.worker_profiles (application_id);
