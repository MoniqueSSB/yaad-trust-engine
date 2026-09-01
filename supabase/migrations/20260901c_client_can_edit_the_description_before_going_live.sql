-- A client could see exactly what a worker would read (BoardPreview.tsx,
-- "the one moment the question 'what exactly am I publishing?' is live")
-- but had no way to change it if it was wrong. Founder's own point, live,
-- 1 Sep 2026, testing a job written up over WhatsApp: the model's read of a
-- conversation is a good draft, not a guarantee, and the client is the one
-- person who actually knows if it is right.
--
-- Same shape as nominate_materials_store(): the rule lives here, not in the
-- browser, and it is deliberately narrow. Editable only by the job's own
-- client (matched on their confirmed email, same test client_go_live and
-- approve_stage already use) and only before the job opens. Once open,
-- workers may already be reading it or have quoted against it, and a silent
-- rewrite under a live quote is a worse problem than a typo left standing;
-- a change after that point is a conversation with Monique, not a button.
create or replace function public.edit_job_description(p_job text, p_descr text)
returns boolean
language plpgsql
security definer
set search_path to 'public, auth'
as $function$
declare
  v_email text;
  v_hit   int;
begin
  select lower(btrim(u.email)) into v_email
    from auth.users u
   where u.id = auth.uid() and u.email_confirmed_at is not null;

  if v_email is null or v_email = '' then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  update public.jobs j
     set descr = left(btrim(coalesce(p_descr, '')), 4000),
         updated_at = now()
   where j.id = p_job
     and lower(coalesce(j.client_email, '')) = v_email
     and j.open is false;

  get diagnostics v_hit = row_count;

  if v_hit = 0 then
    raise exception 'That job is not yours to edit, or it is already live.' using errcode = '28000';
  end if;

  return true;
end;
$function$;

revoke all on function public.edit_job_description(text, text) from public, anon;
grant execute on function public.edit_job_description(text, text) to authenticated;
