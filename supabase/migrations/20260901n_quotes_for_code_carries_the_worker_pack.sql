-- Quote Kickoff Pack, follow-on: quotes_for_code() is the only door the
-- client's own quotes page (web/app/jobs/[id]/quotes/page.tsx) reads
-- through, code-bearer access, no account. It returned the four bare
-- price fields job_quotes always had; the worker's scope_summary,
-- timeline_note and payment_stage_note (20260901l) are exactly the
-- content that makes this "the final quote", per the founder's own
-- description, so a client who never signs in still could not have read
-- any of it. Same discipline as this repository's standing rule after the
-- secret-mismatch incident: extend a function in place rather than layer a
-- second one that can drift from it. create or replace could not do that
-- here: Postgres refuses to change a function's OUT columns in place
-- (42P13), so this drops and recreates instead, run and confirmed live.
drop function public.quotes_for_code(text, text);

create function public.quotes_for_code(p_job text, p_code text)
returns table (
  id uuid, worker_name text, labour_jmd integer, materials_jmd integer,
  materials_at_cost boolean, earliest_start text, days_estimate text,
  note text, status text,
  scope_summary text, timeline_note text, payment_stage_note text
)
language sql security definer set search_path to 'public'
as $$
  select q.id, q.worker_name, q.labour_jmd, q.materials_jmd, q.materials_at_cost,
         q.earliest_start, q.days_estimate, q.note, q.status,
         q.scope_summary, q.timeline_note, q.payment_stage_note
    from job_quotes q
    join jobs j on j.id = q.job_id
   where j.id = p_job and coalesce(j.portal_code,'') <> '' and j.portal_code = p_code
   order by q.created_at;
$$;

revoke all on function public.quotes_for_code(text, text) from public;
grant execute on function public.quotes_for_code(text, text) to anon, authenticated;
