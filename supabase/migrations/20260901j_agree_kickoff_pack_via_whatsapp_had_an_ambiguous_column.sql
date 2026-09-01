-- Caught live testing the function this same night introduced
-- (20260901i): "column reference pack_id is ambiguous". RETURNS TABLE
-- column names become implicitly-declared variables inside the function
-- body, PL/pgSQL's own well-known gotcha, and this function's own return
-- shape, job_id and pack_id, is exactly what the candidates CTE below
-- also names its columns. Postgres could not tell whether a bare pack_id
-- inside the embedded SQL meant the CTE's own column or the function's
-- output variable of the same name, and refused to guess. Fixed by
-- qualifying every reference to the CTE's own columns with its name,
-- which is unambiguous either way once written down.

create or replace function public.agree_kickoff_pack_via_whatsapp(p_phone text)
returns table(agreed_side text, both_confirmed boolean, job_id text, pack_id text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tail text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9);
  v_count integer;
  v_pack_id text;
  v_side text;
  v_email text;
  v_job_id text;
begin
  if length(v_tail) < 7 then
    raise exception 'No usable phone number.';
  end if;

  with candidates as (
    select p.id as pack_id, p.job_id, 'client' as side, lower(j.client_email) as email
      from kickoff_packs p
      join jobs j on j.id = p.job_id
     where p.status = 'approved'
       and right(regexp_replace(coalesce(j.client_phone,''), '\D', '', 'g'), 9) = v_tail
       and not exists (
         select 1 from kickoff_pack_agreements a
          where a.pack_id = p.id and a.rev = p.rev and a.side = 'client'
       )
    union all
    select p.id as pack_id, p.job_id, 'worker' as side, lower(q.worker_email) as email
      from kickoff_packs p
      join job_quotes q on q.id = p.quote_id
      join worker_profiles wp on lower(wp.worker_email) = lower(q.worker_email)
     where p.status = 'approved'
       and right(regexp_replace(coalesce(wp.phone,''), '\D', '', 'g'), 9) = v_tail
       and not exists (
         select 1 from kickoff_pack_agreements a
          where a.pack_id = p.id and a.rev = p.rev and a.side = 'worker'
       )
  )
  select count(*),
         (array_agg(candidates.pack_id))[1],
         (array_agg(candidates.side))[1],
         (array_agg(candidates.email))[1],
         (array_agg(candidates.job_id))[1]
    into v_count, v_pack_id, v_side, v_email, v_job_id
    from candidates;

  if coalesce(v_count, 0) = 0 then
    raise exception 'No Kickoff Pack is waiting on your confirmation right now.';
  end if;
  if v_count > 1 then
    raise exception 'More than one Kickoff Pack is waiting on you. Use the link to confirm the right one.';
  end if;

  return query
    select r.agreed_side, r.both_confirmed, v_job_id, v_pack_id
      from public._do_agree_kickoff_pack(v_pack_id, v_side, v_email) r;
end $function$;
