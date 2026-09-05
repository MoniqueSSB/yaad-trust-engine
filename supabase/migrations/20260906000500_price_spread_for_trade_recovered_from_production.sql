-- The aggregate the client and the worker actually read, recovered from
-- production on 5 September 2026.
--
-- WHY IT WAS MISSING. It was applied live through the Supabase MCP when the
-- price panel was built, and the MCP assigns its own version number rather
-- than writing a file into this directory. The sibling table went in as
-- 20260906000400_price_observations.sql and this function did not, so a load
-- bearing object existed in exactly one place, which is the database. Same
-- failure as the Vault migration on 3 September and work_log_pins on 4
-- September, and this one is the worst of the three, because the app depends
-- on it: web/app/portal/(gated)/jobs/[id]/page.tsx calls it by name, so a
-- rebuild from this repository would produce a portal page that calls a
-- function that does not exist.
--
-- TRANSCRIBED FROM pg_get_functiondef, NOT AUTHORED HERE. The body below is
-- what is running. The grants were read the same way and are reproduced
-- exactly: authenticated yes, anon and public no.
--
-- WHAT IT IS FOR, and the reason it returns an aggregate and never rows.
-- price_observations holds one row per real quoted price, and a row identifies
-- a tradesperson's commercial terms on a named job. The client is not entitled
-- to that and neither is another worker. So the table stays admin only and
-- this is the only door onto it from a session: four numbers, no rows, no job
-- reference, no worker reference.
--
-- THE "having count(*) >= 3" IS A PRIVACY CONTROL AND A HONESTY CONTROL AT
-- ONCE, which is why it sits in SQL rather than in the page. With one
-- observation the low, the high and the middle are all the same number, which
-- is that worker's price published to whoever asks. With two, anyone who knows
-- one of them can subtract and read the other. Three is the first count where
-- the numbers stop being individually recoverable. It is also the first count
-- where a spread means anything at all, so the same line stops the panel
-- dressing noise as evidence. A caller below the threshold gets no row back,
-- and the page says nothing rather than something thin, which is rule 3 in
-- web/lib/portal/price-context.ts.
--
-- SECURITY DEFINER with a pinned search_path, because the whole point is to
-- read a table the caller cannot read. Do not widen this to anon. Do not add
-- an overload that returns the rows.

CREATE OR REPLACE FUNCTION public.price_spread_for_trade(p_trade text)
 RETURNS TABLE(n integer, low_jmd integer, high_jmd integer, middle_jmd integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with o as (
    select labour_jmd from public.price_observations
     where trade is not distinct from nullif(btrim(p_trade), '')
       and labour_jmd > 0
  )
  select count(*)::integer,
         min(labour_jmd)::integer,
         max(labour_jmd)::integer,
         (percentile_disc(0.5) within group (order by labour_jmd))::integer
    from o
   having count(*) >= 3;
$function$;

revoke all on function public.price_spread_for_trade(text) from public, anon;
grant execute on function public.price_spread_for_trade(text) to authenticated, service_role;
