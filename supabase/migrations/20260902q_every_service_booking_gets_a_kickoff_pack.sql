-- Every service booking gets a Kickoff Pack (2 Sep 2026, founder's own
-- instruction: "made regardless and can be edited"). The pack machinery
-- built for jobs learns a second parent: a service booking. No new tables,
-- no second pipeline; kickoff_drafts and kickoff_packs each gain a
-- nullable service_id, the read policy gains a service-client arm, and the
-- desk gains the two levers it never had anywhere: edit a section's prose,
-- and approve. yaad-kickoff-check drafts one automatically for every live
-- booking, the same auto-issue-if-guardrail-clean rule the job path uses.

alter table public.kickoff_drafts
  add column if not exists service_id text references public.services(id) on delete set null;
alter table public.kickoff_packs
  add column if not exists service_id text references public.services(id) on delete set null;
create index if not exists kickoff_drafts_service_id_idx
  on public.kickoff_drafts (service_id) where service_id is not null;
create index if not exists kickoff_packs_service_id_idx
  on public.kickoff_packs (service_id) where service_id is not null;

-- The read policy, verbatim from 20260901g, plus one arm: the client on a
-- service booking reads that booking's approved pack. Same approved-only
-- rule; a draft or in_review pack is invisible outside the desk.
drop policy "parties read approved packs" on public.kickoff_packs;
create policy "parties read approved packs" on public.kickoff_packs
  for select
  to authenticated
  using (
    status = 'approved'
    and (
      exists (
        select 1 from jobs j
         where j.id = kickoff_packs.job_id
           and (
             lower(coalesce(j.client_email, '')) = lower(auth.jwt() ->> 'email')
             or lower(coalesce(j.worker_email, '')) = lower(auth.jwt() ->> 'email')
           )
      )
      or exists (
        select 1 from job_quotes q
         where q.id = kickoff_packs.quote_id and q.worker_user = auth.uid()
      )
      or exists (
        select 1 from services s
         where s.id = kickoff_packs.service_id
           and lower(coalesce(s.client_email, '')) = lower(auth.jwt() ->> 'email')
      )
    )
  );

-- notify_worker_kickoff_pack_ready() posts jobId to the notify hub, which
-- requires a real job. A service pack has none, so the trigger now only
-- fires for job packs; the function body (and the secret baked in it) is
-- deliberately untouched.
drop trigger if exists trg_notify_kickoff_pack_ready on public.kickoff_packs;
create trigger trg_notify_kickoff_pack_ready
  after update on public.kickoff_packs
  for each row
  when (new.job_id is not null)
  execute function public.notify_worker_kickoff_pack_ready();

-- The manual door for a held-for-review draft, mirroring
-- link_kickoff_draft_to_job (20260831zzzz11) including its hard guardrail
-- gate: a draft still flagging price language, banned language or foreign
-- text cannot become a client-facing pack through this door either.
create or replace function public.link_kickoff_draft_to_service(p_draft_id uuid, p_service_id text)
returns table(pack_id text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_draft kickoff_drafts%rowtype;
  v_svc   services%rowtype;
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

  select * into v_svc from services where id = p_service_id;
  if not found then
    raise exception 'No such service booking.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from kickoff_packs k where k.service_id = p_service_id) then
    raise exception 'This booking already has a Kickoff Pack. Edit that one rather than issuing a second.'
      using errcode = 'check_violation';
  end if;

  v_pack_id := 'KO-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text;

  insert into public.kickoff_packs (id, service_id, project_title, client_name, parish, intake, docs, model, confirm_code)
  values (
    v_pack_id,
    p_service_id,
    coalesce(nullif(btrim(v_draft.intake->>'title'), ''), coalesce(v_svc.type, 'Service booking')),
    coalesce(nullif(btrim(v_draft.intake->>'client_name'), ''), v_svc.client_name),
    coalesce(nullif(btrim(v_draft.intake->>'parish'), ''), v_svc.parish),
    v_draft.intake,
    v_draft.docs,
    v_draft.model,
    upper(substring(encode(extensions.gen_random_bytes(4), 'hex') from 1 for 6))
  );

  return query select v_pack_id;
end $$;

revoke execute on function public.link_kickoff_draft_to_service(uuid, text) from anon, public;
grant  execute on function public.link_kickoff_draft_to_service(uuid, text) to authenticated;

-- "Can be edited", made real, for every pack, job or service. The desk
-- never had a way to change a word of a pack; this edits one section's
-- readable prose. Structured lists stay the model's until a redraft. The
-- kickoff_touch trigger does the bookkeeping this leans on: any docs
-- change archives the old revision, bumps rev, and knocks an approved
-- pack back to in_review, which hides it from the portal until it is
-- approved again. That is the point: an edited pack is a new revision a
-- named human re-approves, never a silent swap under an old approval.
create or replace function public.edit_kickoff_doc_section(p_pack text, p_section text, p_text text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_path text[];
  v_rev integer;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  if coalesce(btrim(p_text), '') = '' then
    raise exception 'Nothing to write. Type the replacement text.' using errcode = 'check_violation';
  end if;

  v_path := case p_section
    when 'cover'    then array['cover_note']
    when 'scope'    then array['scope_of_works','summary']
    when 'timeline' then array['timeline','basis']
    when 'payment'  then array['payment_schedule','note']
    else null
  end;
  if v_path is null then
    raise exception 'Unknown section %. The editable ones are cover, scope, timeline and payment.', p_section
      using errcode = 'check_violation';
  end if;

  update public.kickoff_packs
     set docs = jsonb_set(coalesce(docs, '{}'::jsonb), v_path, to_jsonb(p_text), true)
   where id = p_pack;
  if not found then
    raise exception 'No such pack.' using errcode = 'check_violation';
  end if;

  select rev into v_rev from public.kickoff_packs where id = p_pack;
  return v_rev;
end $$;

revoke execute on function public.edit_kickoff_doc_section(text, text, text) from anon, public;
grant  execute on function public.edit_kickoff_doc_section(text, text, text) to authenticated;

-- Approval by a named admin, from the desk. Until now approval only ever
-- happened inside choose_worker() or the cron's clean-draft auto-issue,
-- so an edited (in_review) pack had no way back to the portal. The
-- kickoff_guard_approval trigger still refuses an approval whose payment
-- stages do not total exactly 100, and kickoff_approval_attributed still
-- demands a name; this supplies the caller's own email as that name.
create or replace function public.approve_kickoff_pack(p_pack text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;

  update public.kickoff_packs
     set status = 'approved',
         approved_by = coalesce(auth.jwt() ->> 'email', 'admin'),
         approved_at = now()
   where id = p_pack and status <> 'approved';
  if not found then
    raise exception 'No such pack, or it is already approved.' using errcode = 'check_violation';
  end if;
  return p_pack;
end $$;

revoke execute on function public.approve_kickoff_pack(text) from anon, public;
grant  execute on function public.approve_kickoff_pack(text) to authenticated;
