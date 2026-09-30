-- The alert list is matched to a job. 30 Sep 2026.
--
-- Founder: "wire the alerts", yes. Since 6 September people have joined the
-- WhatsApp alert list, said their trades and parishes, and nothing was ever
-- sent, on purpose, until the send could be built and capped. This is the
-- match half: who on the list fits a job. yaad-match sends, when a person
-- presses Match on the desk, through a Meta-approved template, at most five
-- a day to any one number, and records every send in job_alerts.
--
-- trade_keys and parish_keys were written when they joined, by the same
-- trade_key() and parish_key() the job's own trade and parish go through
-- here, so the match is key to key. Service role only.

create or replace function public.match_alert_subscribers_for_job(p_job text)
returns table (phone text, name text, can_quote boolean, match_reason text)
language sql
stable
security definer
set search_path to 'public'
as $$
  with j as (
    select trade_key(trade) as tk, parish_key(parish) as pk
      from jobs where id = p_job
  )
  select v.phone, v.name, v.can_quote,
         case when j.tk = any (s.trade_keys) and j.pk = any (s.parish_keys) then 'trade and parish'
              when j.tk = any (s.trade_keys) then 'trade, any parish'
              else 'parish' end as match_reason
    from job_alert_subscribers s
    join v_job_alert_subscribers v on v.id = s.id
    cross join j
   where s.listening
     and j.tk is not null
     and j.tk = any (s.trade_keys)
     and (cardinality(s.parish_keys) = 0 or j.pk is null or j.pk = any (s.parish_keys))
   order by (j.pk = any (s.parish_keys)) desc, s.created_at
   limit 100;
$$;
revoke all on function public.match_alert_subscribers_for_job(text) from public, anon, authenticated;
grant execute on function public.match_alert_subscribers_for_job(text) to service_role;

-- The daily cap, counted off job_alerts. A number on the list is recorded
-- there as wa:<digits>, since the list has no email.
create or replace function public.whatsapp_alerts_sent_today(p_phone text)
returns int
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::int
    from job_alerts
   where channel = 'whatsapp'
     and status = 'sent'
     and worker_email = 'wa:' || regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
     and created_at > now() - interval '24 hours';
$$;
revoke all on function public.whatsapp_alerts_sent_today(text) from public, anon, authenticated;
grant execute on function public.whatsapp_alerts_sent_today(text) to service_role;
