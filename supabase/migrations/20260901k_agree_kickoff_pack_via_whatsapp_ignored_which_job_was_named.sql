-- Caught live, same test as the ambiguous-column fix minutes earlier:
-- test.worker@yaadly.co.uk genuinely has two real Kickoff Packs waiting
-- on them right now, on two different jobs. Replying with the EXACT code
-- of the one they meant still got refused, "More than one Kickoff Pack
-- is waiting on you" - because agree_kickoff_pack_via_whatsapp(p_phone)
-- only ever looked at the phone, never at which job the reply actually
-- named. yaad-inbound had already worked that out one line earlier, via
-- matchApprovingJob() against this exact job's own code, and then threw
-- the answer away calling this function with the phone alone.
--
-- Every other WhatsApp door in this file takes the job it already
-- matched as a parameter - choose_worker_via_whatsapp(p_job, p_phone),
-- approve_stage_via_whatsapp(p_job, p_phone) - and only refuses when the
-- caller genuinely could not narrow it down before asking (more than one
-- quote open, more than one job awaiting approval). This one skipped
-- that shape and tried to do the narrowing itself, from the phone alone,
-- discarding the one piece of information - the code actually typed -
-- that would have resolved it. Fixed to match the established shape:
-- p_job first, phone second, refuse only if this exact job has no
-- pending confirmation for this phone at all.

drop function if exists public.agree_kickoff_pack_via_whatsapp(text);

create function public.agree_kickoff_pack_via_whatsapp(p_job text, p_phone text)
returns table(agreed_side text, both_confirmed boolean, job_id text, pack_id text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tail text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9);
  v_pack_id text;
  v_side text;
  v_email text;
begin
  if length(v_tail) < 7 then
    raise exception 'No usable phone number.';
  end if;

  -- Client side of this specific job.
  select p.id, 'client', lower(j.client_email)
    into v_pack_id, v_side, v_email
    from kickoff_packs p
    join jobs j on j.id = p.job_id
   where p.job_id = p_job
     and p.status = 'approved'
     and right(regexp_replace(coalesce(j.client_phone,''), '\D', '', 'g'), 9) = v_tail
     and not exists (
       select 1 from kickoff_pack_agreements a
        where a.pack_id = p.id and a.rev = p.rev and a.side = 'client'
     )
   order by p.updated_at desc
   limit 1;

  -- Worker side of this specific job, only checked if the client side found
  -- nothing: the same phone cannot plausibly be both on one job.
  if v_pack_id is null then
    select p.id, 'worker', lower(q.worker_email)
      into v_pack_id, v_side, v_email
      from kickoff_packs p
      join job_quotes q on q.id = p.quote_id
      join worker_profiles wp on lower(wp.worker_email) = lower(q.worker_email)
     where p.job_id = p_job
       and p.status = 'approved'
       and right(regexp_replace(coalesce(wp.phone,''), '\D', '', 'g'), 9) = v_tail
       and not exists (
         select 1 from kickoff_pack_agreements a
          where a.pack_id = p.id and a.rev = p.rev and a.side = 'worker'
       )
     order by p.updated_at desc
     limit 1;
  end if;

  if v_pack_id is null then
    raise exception 'No Kickoff Pack on this job is waiting on your confirmation right now.';
  end if;

  return query
    select r.agreed_side, r.both_confirmed, p_job, v_pack_id
      from public._do_agree_kickoff_pack(v_pack_id, v_side, v_email) r;
end $function$;

revoke all on function public.agree_kickoff_pack_via_whatsapp(text, text) from public;
grant execute on function public.agree_kickoff_pack_via_whatsapp(text, text) to service_role, authenticated;
