-- Founder's own instruction, live: "I never saw when the small pack was
-- issued for review" -> build a review step for the Quote Kickoff Pack
-- (quote_pack_drafts), matching how the big Kickoff Pack is reviewed
-- rather than the design as found, which had no review step anywhere -
-- a guardrail-clean 'ready' draft went straight into a worker's quote
-- form the instant it finished, with no gate at all.
--
-- Same shape as yaad-kickoff-check's own two phases: a clean draft is
-- auto-approved (system-attributed, same wording), a dirty one is held
-- at 'ready' for a human to clear in the concierge desk's own new Quote
-- Pack Drafts view, same hard rule link_kickoff_draft_to_job() already
-- enforces - never issue flagged content, whoever is asking.
--
-- 'approved' is the new gate a worker's own quote form reads, not
-- 'ready': RLS is what actually enforces this, not the page's own
-- usableDraft() check, the same "RLS is the real protection" rule
-- CLAUDE.md §6 states for everything else in this repository.

alter table public.quote_pack_drafts drop constraint quote_pack_drafts_status_check;
alter table public.quote_pack_drafts add constraint quote_pack_drafts_status_check
  check (status = any (array['drafting','ready','approved','failed']));

alter table public.quote_pack_drafts add column if not exists approved_by text;
alter table public.quote_pack_drafts add column if not exists approved_at timestamptz;

drop policy "workers can read drafts for open jobs" on public.quote_pack_drafts;
create policy "workers can read drafts for open jobs" on public.quote_pack_drafts
  for select
  to authenticated
  using (
    status = 'approved'
    and exists (
      select 1 from jobs j
       where j.id = quote_pack_drafts.job_id
         and j.open = true
         and coalesce(j.worker_email, '') = ''
         and j.stage = 0
    )
  );

-- The manual door, same discipline as link_kickoff_draft_to_job(): admin
-- only, refuses outright on any guardrail flag rather than allowing an
-- override, and attributes the approval to the actual signed-in admin
-- rather than a generic string, so "a named human confirms" is something
-- this row can actually prove, not just claim.
create or replace function public.approve_quote_pack_draft(p_draft_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_draft quote_pack_drafts%rowtype;
  v_reasons text[] := '{}';
  v_admin text := coalesce(nullif(btrim(auth.jwt()->>'email'), ''), 'admin');
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;

  select * into v_draft from quote_pack_drafts where id = p_draft_id;
  if not found then
    raise exception 'No such draft.' using errcode = 'check_violation';
  end if;
  if v_draft.status not in ('ready', 'approved') or v_draft.docs is null then
    raise exception 'This draft is not ready. Only a finished, successful draft can be approved.'
      using errcode = 'check_violation';
  end if;

  if coalesce((v_draft.guardrail->>'price_language_detected')::boolean, false) then
    v_reasons := array_append(v_reasons, 'price language');
  end if;
  if coalesce((v_draft.guardrail->>'banned_language_detected')::boolean, false) then
    v_reasons := array_append(v_reasons, 'banned language');
  end if;
  if array_length(v_reasons, 1) > 0 then
    raise exception 'This draft still flags % and cannot be issued as written. Fix or redraft it first.',
      array_to_string(v_reasons, ', ')
      using errcode = 'check_violation';
  end if;

  update public.quote_pack_drafts
     set status = 'approved', approved_by = v_admin, approved_at = now()
   where id = p_draft_id;
end $function$;

revoke all on function public.approve_quote_pack_draft(uuid) from public;
grant execute on function public.approve_quote_pack_draft(uuid) to authenticated;
