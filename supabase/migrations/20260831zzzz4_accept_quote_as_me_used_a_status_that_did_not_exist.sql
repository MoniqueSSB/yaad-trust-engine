-- Found while building Stage 6's WhatsApp booking, not asked for at the
-- time: accept_quote_as_me(), called from the pre-account quotes page
-- (/jobs/[id]/quotes, AcceptPanel.tsx), tries to mark a losing quote
-- 'not_chosen'. job_quotes' own status check constraint has only ever
-- allowed submitted, withdrawn, accepted, declined. 'not_chosen' is not
-- one of them.
--
-- Narrow in practice: the UPDATE that uses it only touches a row when a
-- SECOND quote is sitting on the same job at the moment one is accepted.
-- With exactly one quote, the common case, that UPDATE matches nothing and
-- the constraint is never reached, which is why this was not caught
-- sooner. A client choosing between two or more quotes on this specific
-- page would have had their booking fail outright.
--
-- Fixing the literal turned up something worse underneath: job_quotes_touch
-- (a trigger predating tracked migrations) reverts any status other than
-- submitted/withdrawn back to its old value on every UPDATE, unless the
-- caller is admin or has set the session flag yaadly.choosing = '1' first.
-- choose_worker() sets that flag around its own updates; accept_quote_as_me()
-- never did. So this function was never actually a "crashes sometimes" bug:
-- it has been a "reports success and silently leaves the quote's own status
-- exactly as it was" bug the entire time, on every booking through this
-- page, not only the two-quote case. jobs.worker_email did get set
-- correctly (that table has no such trigger), so a booking looked as if it
-- had gone through while the quote itself stayed marked submitted forever.
--
-- Fixed by adding the same set_config handshake choose_worker() already
-- uses, nothing else changed. Left alone on purpose: whether this page
-- should also require the scope agreement choose_worker() enforces is a
-- real product question, not a database typo, and bundling that in here
-- would risk turning a page that now visibly books into one that visibly
-- refuses every booking until a scope-agreement step exists on it.
-- Flagged, not decided.
create or replace function public.accept_quote_as_me(p_quote uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare q record; j record; me text;
begin
  me := lower(coalesce(auth.jwt() ->> 'email', ''));
  if me = '' then raise exception 'You need to be signed in to accept a quote.'; end if;

  select * into q from job_quotes where id = p_quote;
  if q is null then raise exception 'That quote no longer exists.'; end if;

  select * into j from jobs where id = q.job_id;
  if j is null then raise exception 'That job no longer exists.'; end if;

  if lower(coalesce(j.client_email,'')) <> me then
    raise exception 'That is not your job to book.';
  end if;

  if coalesce(j.worker_email,'') <> '' then
    raise exception 'This job already has a worker on it. Talk to Yaadly before changing that.';
  end if;

  perform set_config('yaadly.choosing', '1', true);
  update job_quotes set status = 'accepted', updated_at = now() where id = p_quote;
  update job_quotes set status = 'declined', updated_at = now()
   where job_id = q.job_id and id <> p_quote and status = 'submitted';
  update jobs set worker_email = q.worker_email, updated_at = now() where id = q.job_id;
  perform set_config('yaadly.choosing', '', true);

  return q.job_id;
end;
$$;

revoke all on function public.accept_quote_as_me(uuid) from anon;
revoke all on function public.accept_quote_as_me(uuid) from public;
grant execute on function public.accept_quote_as_me(uuid) to authenticated;
