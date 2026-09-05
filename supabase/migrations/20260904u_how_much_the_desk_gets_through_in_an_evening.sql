-- How much the desk gets through in an evening.
--
-- The system review asked for capacity: at what point does the person become
-- the bottleneck. The whole product is that a named human confirms every
-- consequential step, so the honest version of "can this scale" is "how many
-- of those confirmations fit in an evening", and until now nothing counted.
--
-- IT MUST BE BUILT BEFORE THE PILOT, NOT AFTER. December is the run that
-- produces the first real capacity data. A view added in January measures
-- nothing that already happened, which is exactly the mistake the stall
-- history migration had to go back and fix.
--
-- WHAT COUNTS AS A DECISION, and this is the part that had to be checked
-- rather than assumed. kickoff_packs and quote_pack_drafts both have an
-- approved_by column, and on 4 September 2026 they held 7 and 307 rows
-- respectively, every one of them reading 'system: auto-issued,
-- guardrail-clean'. Counting them would have reported a desk getting through
-- three hundred items and would have been nonsense in the direction that
-- flatters the business.
--
-- CORRECTED BY 20260905a, READ THAT ONE TOO. This comment originally called
-- them "documents issued automatically after a human accepted a quote", which
-- is wrong and wrong in a way that matters. The quote pack does not follow a
-- quote, it is what a worker quotes AGAINST, and it is the gate on whether a
-- job reaches a worker at all. Excluding the auto-issued rows was right;
-- excluding the whole table also discarded the human path, where an admin
-- clears a flagged draft that was deliberately held for them.
--
-- So the rule is explicit: a row counts only when a real person is named.
-- Anything prefixed 'system:' is excluded, and the exclusion is a pattern
-- rather than a table list so a new auto-issuer cannot quietly join the count.
--
-- WHY 05:00 AND NOT MIDNIGHT. The person doing this work is a night owl and
-- says so; a sign-off at half past midnight belongs to the evening that just
-- happened, not to the morning it technically lands in. Grouping on the plain
-- Jamaica date would split most real sessions in two and halve the number.
-- The day boundary is therefore pushed to 05:00 local.
--
-- WHAT IS MISSING AND IS NOT A VIEW'S FAULT. Passing or failing a worker's
-- application is a human decision under section 2 of CLAUDE.md, and nothing
-- records who made it or when: applications.status moves and leaves no
-- attributed row. vetting_reviews is the AI's read, not the person's ruling.
-- So this measures evidence sign-offs, quote reviews and materials releases,
-- and undercounts the real evening by however much vetting takes. Recorded in
-- DECISIONS.md as an open governance gap rather than papered over here.

create or replace view public.desk_decisions
with (security_invoker = true) as
    select 'evidence sign-off'::text as kind, sa.job_id, sa.approved_at as at, sa.approved_by as who
      from public.stage_approvals sa
     where sa.approved_at is not null
       and coalesce(sa.approved_by, '') <> ''
       and sa.approved_by not like 'system:%'
  union all
    select 'quote review', qr.job_id, qr.created_at, qr.reviewed_by
      from public.quote_reviews qr
     where coalesce(qr.reviewed_by, '') <> ''
       and qr.reviewed_by not like 'system:%'
  union all
    select 'materials release', mr.job_id, mr.released_at, mr.released_by
      from public.materials_releases mr
     where mr.released_at is not null
       and coalesce(mr.released_by, '') <> ''
       and mr.released_by not like 'system:%';

comment on view public.desk_decisions is
  'Every consequential step a named person actually took, with when. Rows whose approver reads system:* are excluded on purpose: an auto-issued guardrail-clean pack is the system deciding the content was clean, not a person sitting down to a decision. Superseded by 20260905a, which adds back the human path on the pack tables.';

grant select on public.desk_decisions to authenticated;

-- One row per working session. The 05:00 Jamaica roll-over is what makes a
-- session an evening rather than a calendar day.
create or replace view public.desk_sessions
with (security_invoker = true) as
  select
    ((d.at at time zone 'America/Jamaica') - interval '5 hours')::date as session_date,
    d.who,
    count(*)                                                          as decisions,
    min(d.at)                                                         as first_at,
    max(d.at)                                                         as last_at,
    round(extract(epoch from (max(d.at) - min(d.at))) / 60.0)         as minutes
  from public.desk_decisions d
  group by 1, 2;

comment on view public.desk_sessions is
  'One row per person per working session, where a session runs 05:00 to 05:00 Jamaica time rather than midnight to midnight, because a sign-off at half past midnight belongs to the evening that just happened.';

grant select on public.desk_sessions to authenticated;

create or replace view public.desk_capacity
with (security_invoker = true) as
  select
    count(*)                                             as sessions,
    sum(decisions)                                       as decisions,
    round(avg(decisions), 1)                             as avg_per_session,
    max(decisions)                                       as busiest_session,
    round(avg(minutes) filter (where decisions > 1))     as avg_minutes,
    max(session_date)                                    as last_session
  from public.desk_sessions;

comment on view public.desk_capacity is
  'Desk capacity: how many consequential decisions a named person gets through in one working session, all time. Undercounts by however long worker vetting takes, because a vetting pass or fail is not recorded with who decided it or when.';

grant select on public.desk_capacity to authenticated;
