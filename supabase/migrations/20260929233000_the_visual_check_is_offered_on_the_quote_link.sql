-- The Visual Check is offered on the quote link, to whoever holds the job code.
--
-- WHAT WAS MISSING. The portal quote card offers the Visual Check as an
-- optional line since 29 Sep 2026. The no-account page, /jobs/<id>/quotes,
-- could not: service_catalogue is readable by a signed-in user only
-- (catalogue_read, 20260826), and the person reading a quote from a WhatsApp
-- link has no account yet. So the client most likely to be deciding was the
-- one client who was never shown the option.
--
-- WHAT THIS DOES. One read-only function that returns the two job check
-- rows, and only to somebody holding a valid code for a real job, the same
-- bearer test job_for_code() and quotes_for_code() already apply. It does
-- not open service_catalogue to the public, and a wrong code returns nothing.
--
-- WHAT THIS DOES NOT DO. It chooses nothing, books nothing and raises no
-- invoice. choose_job_check() is unchanged and still refuses anybody who is
-- not signed in as this job's client, and still refuses a check before a
-- worker is on the job. Holding the link is enough to read a price, never
-- enough to add one.

create or replace function public.job_check_prices_for_code(p_job text, p_code text)
returns table (id text, name text, blurb text, full_pence integer, founding_pence integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.id, c.name, c.blurb, c.full_pence, c.founding_pence
    from public.service_catalogue c
   where c.active
     and c.id in ('job-visual-check', 'job-technical-check')
     and exists (
       select 1 from public.jobs j
        where j.id = p_job
          and coalesce(j.portal_code, '') <> ''
          and j.portal_code = p_code
     );
$$;

revoke all on function public.job_check_prices_for_code(text, text) from public;
grant execute on function public.job_check_prices_for_code(text, text) to anon, authenticated;

comment on function public.job_check_prices_for_code(text, text) is
  'Read only. The two job check catalogue rows, returned only to a caller holding a valid portal code for the job. Used by the no-account quotes page to show the Visual Check price. Chooses nothing: choose_job_check() is the gate.';
