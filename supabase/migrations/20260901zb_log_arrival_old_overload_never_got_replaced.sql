-- CREATE OR REPLACE FUNCTION cannot change a function's argument list.
-- 20260901za's log_arrival(text, double precision, double precision,
-- numeric) did not replace log_arrival(text): Postgres has no way to
-- "replace" a function under a different signature, so it silently
-- created a second, overloaded function instead, and the original
-- one-argument version was left standing with its old body, still
-- granted to authenticated, still capable of logging an arrival with no
-- coordinates captured at all. Caught by checking pg_proc directly rather
-- than assuming the migration did what its own comment said.
--
-- One door, not two: the stale overload is dropped. Every caller now
-- reaches the version that captures lat/lon/accuracy, whether it passes
-- them or leaves them null.

drop function if exists public.log_arrival(text);
