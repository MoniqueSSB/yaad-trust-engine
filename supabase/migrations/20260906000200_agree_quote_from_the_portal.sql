-- Named 20260906 although it was written on 5 September 2026. The prefix is an
-- ordering token, not a date. scripts/check-migration-order.mjs requires a new
-- migration to sort after every existing one, the last of which is
-- 20260905d_a_vetting_decision_says_who_made_it.sql, and no 14-digit stamp
-- beginning 20260905 can sort after a letter, because '9' sorts before 'd'. So
-- on the day the rule landed, the first correct name is the next day's. The
-- ordering is what the check is protecting and the ordering is right.
--
-- Accepting a price should not require a Kickoff Pack.
--
-- Founder's instruction, 4 September 2026: take the Kickoff Pack out of the
-- flow, offer it as an addition where a client wants project documentation,
-- and leave the Quote Pack as it now is.
--
-- ── Why this is a migration and not a UI change ──
--
-- The booking gate already allowed both routes. `_do_choose_worker` books a
-- job when the quote is `quote_confirmed` (both sides agreed the PRICE, no
-- pack anywhere) OR when it is `kickoff_requested` and the pack is confirmed
-- by both sides. So a no-pack route has existed all along.
--
-- It was unreachable from the web. The only function that produces
-- `quote_confirmed` is `agree_quote_via_whatsapp`, which identifies people by
-- the last nine digits of a phone number. A client in the portal has a signed
-- in session and an email, and no phone match, so the portal's Accept button
-- had exactly one thing it could call: `request_kickoff_as_me`. Accepting a
-- price therefore always ordered a ten section project pack, including on a
-- £300 repair, and since 4 Sep that pack also waits on a human approving it.
-- The pack was optional in the database and mandatory in practice.
--
-- This adds the missing door. Same table, same dual agreement rows, same
-- resulting status, identified by the session's own email rather than by a
-- phone number. Nothing about the booking gate changes, because it never
-- needed to.
--
-- ── What both sides now agree to, which is a question for the solicitor ──
--
-- On the pack route the dual confirmed artefact is the Kickoff Pack. On this
-- route it is the accepted quote and its Quote Pack: scope, inclusions,
-- exclusions, rough timeline and payment stages. That is a narrower document.
-- It is very probably the right one for a small repair and it is a real change
-- in what a client has signed up to, so it belongs in the solicitor brief
-- rather than in a code comment. Flagged, not decided here.

create or replace function public.agree_quote_as_me(p_quote uuid)
returns table(agreed_side text, both_confirmed boolean, job_id text, quote_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_quote public.job_quotes%rowtype;
  v_job   public.jobs%rowtype;
  v_side  text;
  v_both  boolean;
begin
  if v_email is null then
    raise exception 'Sign in to confirm a price.' using errcode = '28000';
  end if;

  select * into v_quote from public.job_quotes where id = p_quote;
  if v_quote.id is null then
    raise exception 'No such price.';
  end if;

  -- Only a price still open may be confirmed. A quote already accepted,
  -- declined, or sitting on the pack route is refused rather than quietly
  -- rerouted: a client who asked for a Kickoff Pack should not have that
  -- request dropped because they later pressed a different button.
  if v_quote.status <> 'submitted' then
    raise exception 'That price is not open for confirmation.';
  end if;

  select * into v_job from public.jobs where id = v_quote.job_id;
  if v_job.id is null then
    raise exception 'No such job.';
  end if;

  if v_email = lower(coalesce(v_job.client_email, '')) then
    v_side := 'client';
  elsif v_email = lower(coalesce(v_quote.worker_email, '')) then
    v_side := 'worker';
  else
    raise exception 'Only the client of this job or the worker who quoted it may confirm this price.'
      using errcode = '28000';
  end if;

  insert into public.quote_agreements (quote_id, side, email)
  values (v_quote.id, v_side, v_email)
  on conflict (quote_id, side) do nothing;

  select (count(*) filter (where side = 'client') > 0)
     and (count(*) filter (where side = 'worker') > 0)
    into v_both
    from public.quote_agreements where quote_id = v_quote.id;

  if v_both then
    perform set_config('yaadly.choosing', '1', true);
    update public.job_quotes set status = 'quote_confirmed', updated_at = now() where id = v_quote.id;
    perform set_config('yaadly.choosing', '', true);
  end if;

  return query select v_side, coalesce(v_both, false), v_job.id, v_quote.id;
end;
$function$;

comment on function public.agree_quote_as_me(uuid) is
  'The portal twin of agree_quote_via_whatsapp. Lets the signed-in client or the worker who quoted confirm a price without ordering a Kickoff Pack. Added 4 Sep 2026 because the portal Accept button could only call request_kickoff_as_me, which made an optional pack mandatory in practice.';

revoke all on function public.agree_quote_as_me(uuid) from public, anon;
grant execute on function public.agree_quote_as_me(uuid) to authenticated;
