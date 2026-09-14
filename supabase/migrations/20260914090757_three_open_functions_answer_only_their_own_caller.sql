-- Three SECURITY DEFINER functions stop answering questions about other people.
--
-- Founder instruction, 13 September 2026 ("do that"), on the sweep logged in
-- DECISIONS.md the same evening. That sweep read every SECURITY DEFINER
-- function in public that anon or authenticated can execute, after
-- 20260913223042 found a payable function open to the internet. These three
-- are what it found. Everything else it read either checks the caller in its
-- own body, is a trigger function (which cannot be called over the API), or is
-- open on purpose.
--
-- 1. match_workers_for_job(text, int). Any signed-in account, client or
--    worker, could list the name, email, trade, parish and completed-job count
--    of every active worker who fits an open job. 20260826_yaad_match granted
--    it to authenticated with no reason given. The only callers are yaad-match
--    and yaad-inbound, both with the service role key. Fix: the grant comes
--    off. Nothing else about it changes.
--
-- 2. job_client_email_matches(text, text). Anyone, signed in or not, could
--    ask "is this email the client on this job?" and get an answer. Worse,
--    with no email at all it answered yes for any job with no client email
--    yet, and jq_select_client applies to every role, so a caller with no
--    session passed that half of the policy on an unclaimed job. Checked
--    before writing this: no unclaimed job has a quote today, so nothing was
--    exposed through it. Fix: it answers only about the caller's own
--    non-empty email. Its five callers (qm_client_read, jq_select_client,
--    mark_material_supplied, "parties read quote change requests" from
--    20260913230000 and "parties read quote agreements" from 20260913230642,
--    both of which landed while this was being written) all pass the
--    caller's own email already, so what they decide is unchanged. Checked
--    against the live policy text on 14 Sep before this was applied. The anon grant stays, deliberately:
--    jq_select_client is written for every role, and taking the function away
--    from anon would turn an anon read of job_quotes into an error instead of
--    an empty result. With this body anon always gets false, which is the
--    right answer.
--
-- 3. may_use_agents(text). Anyone could ask whether an email belongs to a
--    Yaadly client cleared for go-live. PUBLIC held EXECUTE, so anon did too.
--    Fix: an admin still gets true; otherwise it answers only about the
--    caller's own email. yaad-agent, the one deployed caller, sends the
--    signed-in person's own verified email with their own token, so it is
--    unaffected. (The README also names yaad-vision; it is not deployed.) The
--    grant comes off public and anon. authenticated keeps it because
--    yaad-agent calls it as the user.
--
-- WHY THIS FILE WAS RESTAMPED, and why the second function reads as it does.
-- This was applied to production on 13 Sep 2026 as 20260913230100. A
-- parallel session's 20260913230642 (a quoting worker sees the tender pack)
-- was applied after it, found the same blank-email flaw independently, and
-- redefined job_client_email_matches() with btrim() and a non-empty check but
-- without the caller's own email. Neither session could see the other's
-- branch. So production lost the own-email half of item 2 while keeping the
-- blank-email half, and the function's comment still claimed both. This file
-- now sorts after 20260913230742 and carries the two versions combined:
-- 230642's btrim() on both sides, plus the own-email check. A fresh replay
-- therefore ends where production should be. Items 1 and 3 are unchanged
-- from what was applied and were still live when checked on 14 Sep.
--
-- No function here moves money or rules on anything. This is who may ask.

create or replace function public.match_workers_for_job(p_job text, p_limit integer default 25)
returns table(worker_email text, name text, trade text, parish text, jobs_done integer, match_reason text, rank_score integer)
language sql
stable security definer
set search_path to 'public'
as $function$
  with j as (
    select id,
           trade_key(trade)  as tk,
           parish_key(parish) as pk
    from jobs
    where id = p_job
      and open is true
      and coalesce(worker_email,'') = ''
      and stage = 0
  )
  select w.worker_email,
         w.name,
         w.trade,
         w.parish,
         w.jobs_completed,
         case
           when trade_key(w.trade) = j.tk and parish_key(w.parish) = j.pk then 'trade and parish'
           when trade_key(w.trade) = j.tk then 'trade, different parish'
           else 'parish, related trade'
         end,
         (case when trade_key(w.trade)  = j.tk then 100 else 0 end)
       + (case when parish_key(w.parish) = j.pk then 50  else 0 end)
       + least(w.jobs_completed, 25)
    from worker_profiles w
    cross join j
   where w.active
     and coalesce(w.worker_email,'') <> ''
     and exists (
       select 1 from doc_signatures ds
        where ds.doc_type = 'worker_guidelines'
          and lower(ds.signer_email) = lower(w.worker_email)
          and (current_doc_version('worker_guidelines') is null
               or ds.doc_version = current_doc_version('worker_guidelines'))
     )
     and (trade_key(w.trade) = j.tk or parish_key(w.parish) = j.pk)
     and not exists (
       select 1 from job_alerts a
        where a.job_id = j.id
          and lower(a.worker_email) = lower(w.worker_email)
          and a.status = 'sent'
     )
   order by 7 desc, w.jobs_completed desc
   limit greatest(p_limit, 1);
$function$;

-- Restated rather than altered so this file carries the whole of what is
-- live; the body is unchanged from production. The grant is the change.
revoke all on function public.match_workers_for_job(text, integer) from public, anon, authenticated;
grant execute on function public.match_workers_for_job(text, integer) to service_role;

create or replace function public.job_client_email_matches(p_job_id text, p_email text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(btrim(p_email), '') <> ''
     and lower(btrim(p_email)) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
     and exists (
       select 1 from jobs j
       where j.id = p_job_id
         and lower(coalesce(j.client_email, '')) = lower(btrim(p_email))
     );
$function$;

comment on function public.job_client_email_matches(text, text) is
  'True only when p_email is the caller''s own signed-in email and that email is the client on the job. Used inside job_quotes and quote_materials policies to break an RLS loop (20260901w). Answers nothing about anybody else since 20260914090757.';

create or replace function public.may_use_agents(p_email text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select public.is_admin()
      or (coalesce(p_email, '') <> ''
          and lower(p_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
          and public.client_cleared_for_golive(p_email));
$function$;

revoke all on function public.may_use_agents(text) from public, anon;
grant execute on function public.may_use_agents(text) to authenticated, service_role;

comment on function public.may_use_agents(text) is
  'Who may invoke yaad-agent: the Yaadly admin, or a signed-in client asking about their own email who has a profile and has signed the CURRENT Client Guidelines version. Answers nothing about anybody else since 20260914090757.';
