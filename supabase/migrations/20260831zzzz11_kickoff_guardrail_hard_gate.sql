-- Kickoff Pack dual agreement, step 2 of 5: the guardrail becomes a hard
-- gate instead of an advisory note. Before this, link_kickoff_draft_to_job()
-- would happily attach a draft that yaad-kickoff itself flagged as
-- containing price language, banned terms or foreign text, trusting the
-- admin to have noticed the flags in the desk before clicking link. Nothing
-- in the database actually stopped it. This refuses the link outright while
-- any of the three flags is still true, naming exactly which ones and what
-- to fix, so a dirty draft cannot become a client-facing pack by a missed
-- click.
--
-- v_reasons || 'text' failed live with "malformed array literal": Postgres
-- resolved || between text[] and an untyped string literal against the
-- array-literal overload, not anyarray||anyelement, and tried to parse the
-- literal as an array. array_append() is unambiguous; this is the version
-- that actually ran clean, not the first draft.
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
  v_reasons text[] := '{}';
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

  if coalesce((v_draft.guardrail->>'price_language_detected')::boolean, false) then
    v_reasons := array_append(v_reasons, 'price language');
  end if;
  if coalesce((v_draft.guardrail->>'banned_language_detected')::boolean, false) then
    v_reasons := array_append(v_reasons, 'banned language');
  end if;
  if coalesce((v_draft.guardrail->>'foreign_text_detected')::boolean, false) then
    v_reasons := array_append(v_reasons, 'foreign text');
  end if;
  if array_length(v_reasons, 1) > 0 then
    raise exception 'This draft still flags % and cannot be issued as written. Fix or redraft it first.',
      array_to_string(v_reasons, ', ')
      using errcode = 'check_violation';
  end if;

  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;

  v_pack_id := 'KO-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text;

  insert into public.kickoff_packs (id, job_id, project_title, client_name, parish, intake, docs, model, confirm_code)
  values (
    v_pack_id,
    p_job_id,
    coalesce(nullif(btrim(v_draft.intake->>'title'), ''), 'Untitled project'),
    nullif(btrim(v_draft.intake->>'client_name'), ''),
    coalesce(nullif(btrim(v_draft.intake->>'parish'), ''), v_job.parish),
    v_draft.intake,
    v_draft.docs,
    v_draft.model,
    upper(substring(encode(extensions.gen_random_bytes(4), 'hex') from 1 for 6))
  );

  return query select v_pack_id;
end $$;

revoke execute on function public.link_kickoff_draft_to_job(uuid, text) from anon, public;
grant  execute on function public.link_kickoff_draft_to_job(uuid, text) to authenticated;
