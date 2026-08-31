-- "Say where materials are kept" becomes a go-live condition only when the
-- accepted quote includes materials; small jobs default to worker supplies.
-- Founder's own wording, Stage 5.4.
--
-- Before this, EVERY job was refused at go-live until the client named a
-- materials store, whatever the job actually needed: a two hour call-out
-- with nothing to buy was held up by a question that did not apply to it.
--
-- One function decides this, materials_store_nominated(), and both callers
-- inherit the fix for free: enforce_store_before_open() (the trigger that
-- guards jobs.open flipping true) and client_go_live() (which reads the same
-- function inside its own WHERE clause). One authority, changed once, rather
-- than the same rule re-implemented in two places that could drift apart.
--
-- The test is the ACCEPTED quote, job_quotes.status = 'accepted', because
-- that is the one number both sides have actually agreed to. A submitted
-- quote that was not chosen says nothing about what this job will need.
create or replace function public.materials_store_nominated(p_job text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    -- No accepted quote with materials on it: nothing to nominate a store
    -- for, so there is nothing to block on. This covers a job with no
    -- accepted quote yet as well as one whose accepted quote is labour only.
    not exists (
      select 1 from public.job_quotes q
       where q.job_id = p_job
         and q.status = 'accepted'
         and coalesce(q.materials_jmd, 0) > 0
    )
    or
    -- There is materials money on the accepted quote, so the original rule
    -- applies in full: a real place named, or the explicit "none available"
    -- answer, which is itself an answer and not a way round the question.
    exists (
      select 1 from public.jobs j
       where j.id = p_job
         and j.materials_store_type is not null
         and (j.materials_store_type = 'none_available'
              or coalesce(btrim(j.materials_store), '') <> '')
    );
$$;
