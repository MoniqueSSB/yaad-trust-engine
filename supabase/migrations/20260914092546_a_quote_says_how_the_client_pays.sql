-- A quote says how the client pays: in full, or by stage.
-- Piece 2 of 4 (DECISIONS.md, 13 Sep 2026, "The accepted quote writes the
-- stage schedule; billing follows it"). Founder decisions, 13 Sep 2026:
--
--   under J$ 100,000 client total   always paid in full
--   J$ 100,000 and over             the quote says "in full" or "by stage",
--                                   and accepting the quote agrees it
--
-- "Client total" is what the client pays Yaadly: labour, plus the 15% on
-- labour, plus materials at cost. The same sum as raise_job_client_invoice()
-- and web/lib/jobs/client-bill.ts.
--
-- This file only RECORDS the choice and enforces the line. It raises no
-- invoice and changes nothing about when a job starts: drafting invoices,
-- and letting a stage billed job start on its stage 1 invoice, is piece 3.
-- A quote with no choice recorded (every quote before today, and anything
-- not sent through the quote form) reads as in full, which is how every job
-- is billed today.
--
-- Stage billing also needs stages the database can read, because the stages
-- are what each invoice would follow. parse_payment_stages() is the rule
-- (20260913230001).
--
-- quotes_for_code() is recreated to return the choice, because the no-sign-in
-- quotes page shows it beside the price. Its return type changes, so it is
-- dropped and created in one transaction and its grants are put back exactly
-- as they were: anon and authenticated may execute it.
--
-- Applied to production: not yet.

begin;

alter table public.job_quotes
  add column if not exists billing_mode text
  check (billing_mode is null or billing_mode in ('in_full', 'by_stage'));

comment on column public.job_quotes.billing_mode is
  'How the client pays if this quote is accepted: in_full or by_stage. Null reads as in_full. by_stage only at or above quote_billing_threshold_jmd() client total, and only with readable payment stages.';

create or replace function public.quote_billing_threshold_jmd()
returns integer
language sql
immutable
set search_path to 'public'
as $function$
  select 100000;
$function$;

comment on function public.quote_billing_threshold_jmd() is
  'The client total, in J$, at or above which a quote may be billed by stage. Founder decision, 13 Sep 2026. Mirrored by BILLING_THRESHOLD_JMD in web/lib/jobs/billing.ts.';

create or replace function public.quote_client_total_jmd(p_labour integer, p_materials integer)
returns integer
language sql
immutable
set search_path to 'public'
as $function$
  select coalesce(p_labour, 0) + round(coalesce(p_labour, 0) * 0.15)::integer + coalesce(p_materials, 0);
$function$;

comment on function public.quote_client_total_jmd(integer, integer) is
  'What the client pays Yaadly for a quote: labour, the 15% on labour, materials at cost. Same arithmetic as raise_job_client_invoice() and web/lib/jobs/client-bill.ts.';

create or replace function public.quote_billing_mode_allowed()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.billing_mode = 'by_stage' then
    if public.quote_client_total_jmd(new.labour_jmd, new.materials_jmd) < public.quote_billing_threshold_jmd() then
      raise exception 'Under J$100,000 all in, the client pays in full. Stage billing starts at J$100,000.'
        using errcode = 'check_violation';
    end if;
    if public.parse_payment_stages(new.payment_stage_note) is null then
      raise exception 'Stage billing needs payment stages that can be read, one per line as Stage name: 30%%: what proves it is done.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_quote_billing_mode_allowed on public.job_quotes;
create trigger trg_quote_billing_mode_allowed
  before insert or update of billing_mode, labour_jmd, materials_jmd, payment_stage_note on public.job_quotes
  for each row execute function public.quote_billing_mode_allowed();

-- As live, with billing_mode added as the last column returned.
drop function if exists public.quotes_for_code(text, text);
create function public.quotes_for_code(p_job text, p_code text)
returns table(id uuid, worker_name text, labour_jmd integer, materials_jmd integer, materials_at_cost boolean, earliest_start text, days_estimate text, note text, status text, scope_summary text, timeline_note text, payment_stage_note text, included_note text, excluded_note text, recommended_at timestamp with time zone, recommended_by text, recommended_reason text, billing_mode text)
language sql
security definer
set search_path to 'public'
as $function$
  select q.id, q.worker_name, q.labour_jmd, q.materials_jmd, q.materials_at_cost,
         q.earliest_start, q.days_estimate, q.note, q.status,
         q.scope_summary, q.timeline_note, q.payment_stage_note,
         q.included_note, q.excluded_note,
         q.recommended_at, q.recommended_by, q.recommended_reason,
         q.billing_mode
    from job_quotes q
    join jobs j on j.id = q.job_id
   where j.id = p_job and coalesce(j.portal_code,'') <> '' and j.portal_code = p_code
     and public.client_may_see_quote(q.job_id, q.status, q.recommended_at)
   order by q.created_at;
$function$;

revoke all on function public.quotes_for_code(text, text) from public;
grant execute on function public.quotes_for_code(text, text) to anon, authenticated;

commit;
