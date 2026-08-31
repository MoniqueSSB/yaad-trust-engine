-- The other half of choose_worker()'s new requirement (20260831x). That
-- migration made choosing a worker refuse without an approved Kickoff Pack
-- for the job. Nothing anywhere could create one: yaad-kickoff only ever
-- writes to kickoff_drafts, and grepping every function, every page and the
-- desk itself turns up nothing that ever inserts into kickoff_packs. Every
-- reference to it, everywhere, is a read. Applied together they would have
-- meant no client could ever accept a quote, on any job, because there was
-- no door in.
--
-- link_kickoff_draft_to_job() is that door: a named admin picks a finished
-- draft and the job it belongs to, and a kickoff_packs row is created from
-- it, status 'draft', not yet approved. Approval itself still only ever
-- happens the one way 20260831x wired it, at the moment a client accepts a
-- quote. This function drafts nothing and approves nothing; it only lets a
-- human attach a written draft to a real job so there is something for that
-- moment to approve.
create or replace function public.link_kickoff_draft_to_job(p_draft_id uuid, p_job_id text)
returns table(pack_id text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_draft kickoff_drafts%rowtype;
  v_job   jobs%rowtype;
  v_pack_id text;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;

  select * into v_draft from kickoff_drafts where id = p_draft_id;
  if not found then
    raise exception 'No such draft.' using errcode = 'check_violation';
  end if;
  if v_draft.status <> 'ready' or v_draft.docs is null then
    raise exception 'This draft is not ready. Only a finished, successful draft can become a Kickoff Pack.'
      using errcode = 'check_violation';
  end if;

  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;

  -- Same id shape as every pack already in the table: KO- plus the
  -- millisecond clock, not a uuid, so the desk's own KO-... rows and this
  -- one look like they came from the same place, because they now do.
  v_pack_id := 'KO-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text;

  insert into public.kickoff_packs (id, job_id, project_title, client_name, parish, intake, docs, model)
  values (
    v_pack_id,
    p_job_id,
    coalesce(nullif(btrim(v_draft.intake->>'title'), ''), 'Untitled project'),
    nullif(btrim(v_draft.intake->>'client_name'), ''),
    coalesce(nullif(btrim(v_draft.intake->>'parish'), ''), v_job.parish),
    v_draft.intake,
    v_draft.docs,
    v_draft.model
  );

  return query select v_pack_id;
end $$;

revoke execute on function public.link_kickoff_draft_to_job(uuid, text) from anon, public;
grant  execute on function public.link_kickoff_draft_to_job(uuid, text) to authenticated;
