-- Founder's own instruction, live, after seeing the mockup: build it for
-- real, on the site she uses. Raises Yaadly's own 15% Guarantee & Support
-- fee, per stage, on a marketplace job - never the worker's own pay,
-- which the client still pays the worker directly, per the published
-- terms; nothing here touches that.
--
-- Two schema changes to the existing invoices table from
-- 20260826_invoicing.sql, not a new invoicing system:
--
-- 1. currency gains 'JMD' alongside 'GBP'. A marketplace job's own price
--    is JMD (job_quotes.labour_jmd); converting it to GBP at raise time
--    would mean inventing an FX rate and a rate policy this migration is
--    not the place to decide. Raising in the job's own currency needs no
--    such decision.
--
-- 2. invoices gains `stage`, nullable, only ever set on a job-stage fee
--    invoice. Without it, "has this stage already been raised" would
--    have to be guessed from period_label text; with it, the check is
--    exact and the same column doubles as the join key the concierge
--    view uses to show raised/ready/waiting per stage.
--
-- raise_job_stage_invoice() is deliberately gated on the stage actually
-- being approved (stage_approvals), matching the founder's own words:
-- "it would be actioned once the evidence is received... I would only
-- have to click a button once I know the evidence is there." The amount
-- is never typed: 15% of that stage's own proportion_percent of the
-- winning quote's labour_jmd, read from the job's own approved Kickoff
-- Pack, the same numbers the portal's own PackStageProgress already
-- shows the client. price_source is 'manual' for the same reason
-- raise_service_invoice() used it for the split halves: a computed
-- percentage of a real number is a policy decision, not the model's, and
-- 'manual' already means exactly that in this schema.

alter table public.invoices drop constraint invoices_currency_check;
alter table public.invoices add constraint invoices_currency_check check (currency in ('GBP', 'JMD'));

alter table public.invoices add column if not exists stage integer;

comment on column public.invoices.stage is
  'Set only on a job-stage fee invoice (raise_job_stage_invoice()): which payment stage of the job''s Kickoff Pack this invoice is for. Null for every other kind of invoice.';

create or replace function public.raise_job_stage_invoice(p_job text, p_stage integer)
returns table(invoice_id text, total_jmd integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job jobs%rowtype;
  v_quote job_quotes%rowtype;
  v_pack_docs jsonb;
  v_stages jsonb;
  v_stage_row jsonb;
  v_stage_name text;
  v_pct numeric;
  v_fee integer;
  v_id text;
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  if p_stage is null or p_stage < 1 then
    raise exception 'A stage number is required.' using errcode = 'check_violation';
  end if;

  select * into v_job from jobs where id = p_job;
  if not found then
    raise exception 'No such job.' using errcode = 'check_violation';
  end if;
  if coalesce(v_job.client_email, '') = '' then
    raise exception 'This job has no client email on file to invoice.' using errcode = 'check_violation';
  end if;

  select * into v_quote from job_quotes where job_id = p_job and status = 'accepted';
  if not found then
    raise exception 'No accepted quote on this job yet.' using errcode = 'check_violation';
  end if;

  select docs into v_pack_docs from kickoff_packs where job_id = p_job and status = 'approved'
   order by updated_at desc limit 1;
  if v_pack_docs is null then
    raise exception 'This job has no approved Kickoff Pack yet.' using errcode = 'check_violation';
  end if;
  v_stages := v_pack_docs->'payment_schedule'->'stages';
  if v_stages is null or jsonb_typeof(v_stages) <> 'array' or jsonb_array_length(v_stages) < p_stage then
    raise exception 'This job''s Kickoff Pack has no stage %.', p_stage using errcode = 'check_violation';
  end if;
  v_stage_row := v_stages->(p_stage - 1);
  v_stage_name := v_stage_row->>'stage';
  v_pct := (v_stage_row->>'proportion_percent')::numeric;
  if v_stage_name is null or v_pct is null then
    raise exception 'Stage % on this job''s Kickoff Pack is missing a name or a percentage.', p_stage using errcode = 'check_violation';
  end if;

  if not exists (select 1 from stage_approvals a where a.job_id = p_job and a.stage = p_stage) then
    raise exception 'Stage % has not been approved yet - nothing to raise against.', p_stage using errcode = 'check_violation';
  end if;
  if exists (select 1 from invoices i where i.job_id = p_job and i.stage = p_stage and i.status <> 'void') then
    raise exception 'Stage % on this job has already been raised.', p_stage using errcode = 'check_violation';
  end if;

  v_fee := round(v_quote.labour_jmd * (v_pct / 100) * 0.15);

  v_id := public.new_invoice_number();
  insert into public.invoices (id, client_name, client_email, service_id, job_id, stage, drafted_by, currency, period_label, notes)
  values (v_id, coalesce(v_job.client_name, v_job.client_email), v_job.client_email, null, p_job, p_stage, 'human', 'JMD', v_stage_name,
    'Yaadly''s own Guarantee & Support fee for this stage: 15% of ' || v_pct || '% of the agreed labour price, per the payment terms you agreed with your tradesperson directly. Their own pay for this stage is paid to them by you, direct, and is never invoiced by Yaadly.');
  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_id, null, v_job.title || ' — ' || v_stage_name || ', Yaadly''s fee', 1, v_fee, 'manual');

  return query select v_id, v_fee;
end $function$;

revoke all on function public.raise_job_stage_invoice(text, integer) from public;
grant execute on function public.raise_job_stage_invoice(text, integer) to authenticated;
