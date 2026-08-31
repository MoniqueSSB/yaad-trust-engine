-- "No account to get quotes, an account once a job is booked."
-- Founder decision, 30 August 2026. Quotes lived only inside the portal,
-- which is behind auth, so the first half of that was not true: a client had
-- to make an account before they could see a single price.
--
-- These functions are the two halves of the decision.

-- ── Reading quotes with no account ───────────────────────────────────────
-- The job code is the bearer token, the same secret the WhatsApp link and the
-- portal claim already ride on. Nothing here returns the client's contact
-- details or the address, only what a client needs in order to choose.
create or replace function public.quotes_for_code(p_job text, p_code text)
returns table (
  id uuid, worker_name text, labour_jmd integer, materials_jmd integer,
  materials_at_cost boolean, earliest_start text, days_estimate text,
  note text, status text
)
language sql security definer set search_path to 'public'
as $$
  select q.id, q.worker_name, q.labour_jmd, q.materials_jmd, q.materials_at_cost,
         q.earliest_start, q.days_estimate, q.note, q.status
    from job_quotes q
    join jobs j on j.id = q.job_id
   where j.id = p_job and coalesce(j.portal_code,'') <> '' and j.portal_code = p_code
   order by q.created_at;
$$;

revoke all on function public.quotes_for_code(text, text) from public;
grant execute on function public.quotes_for_code(text, text) to anon, authenticated;

create or replace function public.job_for_code(p_job text, p_code text)
returns table (id text, title text, parish text, descr text, worker_email text)
language sql security definer set search_path to 'public'
as $$
  select j.id, j.title, j.parish, j.descr, j.worker_email
    from jobs j
   where j.id = p_job and coalesce(j.portal_code,'') <> '' and j.portal_code = p_code;
$$;

revoke all on function public.job_for_code(text, text) from public;
grant execute on function public.job_for_code(text, text) to anon, authenticated;

-- ── Accepting one, which is the booking ──────────────────────────────────
-- Authenticated only, and it refuses anybody who is not this job's client, so
-- holding the code is enough to LOOK and never enough to CHOOSE.
--
-- A job that already has a worker is not re-bookable here. Changing a worker
-- once one is on the job is a desk decision with a conversation behind it.
create or replace function public.accept_quote_as_me(p_quote uuid)
returns text
language plpgsql security definer set search_path to 'public'
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

  update job_quotes set status = 'accepted', updated_at = now() where id = p_quote;
  update job_quotes set status = 'not_chosen', updated_at = now()
   where job_id = q.job_id and id <> p_quote and status = 'submitted';
  update jobs set worker_email = q.worker_email, updated_at = now() where id = q.job_id;

  return q.job_id;
end $$;

-- anon is a role with its own grant, not a member of PUBLIC for this purpose,
-- so it has to be named. A booking function anonymous callers may CALL is one
-- bug away from one they may USE, whatever the body checks.
revoke all on function public.accept_quote_as_me(uuid) from anon;
revoke all on function public.accept_quote_as_me(uuid) from public;
grant execute on function public.accept_quote_as_me(uuid) to authenticated;
