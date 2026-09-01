-- Quote Kickoff Pack, follow-on to 20260901o: quotes_for_code() needs
-- included_note and excluded_note too, same reasoning as 20260901n. Drop
-- and recreate again, not create or replace: Postgres still refuses to
-- change a function's OUT columns in place (42P13).
drop function public.quotes_for_code(text, text);

create function public.quotes_for_code(p_job text, p_code text)
returns table (
  id uuid, worker_name text, labour_jmd integer, materials_jmd integer,
  materials_at_cost boolean, earliest_start text, days_estimate text,
  note text, status text,
  scope_summary text, timeline_note text, payment_stage_note text,
  included_note text, excluded_note text
)
language sql security definer set search_path to 'public'
as $$
  select q.id, q.worker_name, q.labour_jmd, q.materials_jmd, q.materials_at_cost,
         q.earliest_start, q.days_estimate, q.note, q.status,
         q.scope_summary, q.timeline_note, q.payment_stage_note,
         q.included_note, q.excluded_note
    from job_quotes q
    join jobs j on j.id = q.job_id
   where j.id = p_job and coalesce(j.portal_code,'') <> '' and j.portal_code = p_code
   order by q.created_at;
$$;

revoke all on function public.quotes_for_code(text, text) from public;
grant execute on function public.quotes_for_code(text, text) to anon, authenticated;
