-- =====================================================================
-- Trade classification support — 26 Aug 2026
-- Run AFTER 20260826_yaad_match.sql (which adds jobs.trade).
-- =====================================================================

-- Where the trade came from, so a wrong one can be traced to its source.
alter table public.jobs add column if not exists trade_source text
  check (trade_source is null or trade_source in ('wizard','model','regex','admin'));

comment on column public.jobs.trade_source is
  'wizard = the client picked it · model = MiniMax classified it · regex = trade_key() fallback · admin = Monique set it by hand';


-- ---------------------------------------------------------------------
-- set_job_trade — the only way jobs.trade gets written.
--
-- Deliberately narrow: it will not overwrite a trade a human chose.
-- The model is allowed to fill a blank, never to argue with the client.
-- Admins can force, because sometimes the client picks wrong.
-- ---------------------------------------------------------------------
create or replace function public.set_job_trade(
  p_job    text,
  p_trade  text,
  p_source text default 'model',
  p_force  boolean default false
)
returns table (job_id text, trade text, trade_source text, changed boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existing      text;
  v_existing_src  text;
  v_owner_email   text;
  v_norm          text;
  v_admin         boolean := public.is_admin();
begin
  select j.trade, j.trade_source, lower(coalesce(j.client_email,''))
    into v_existing, v_existing_src, v_owner_email
    from jobs j where j.id = p_job;

  if not found then
    raise exception 'no such job: %', p_job using errcode = 'no_data_found';
  end if;

  -- Admin, or the client whose job it is. Nobody else.
  if not v_admin
     and v_owner_email <> lower(coalesce(auth.jwt() ->> 'email','')) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  if p_source = 'admin' and not v_admin then
    raise exception 'only an admin may set trade_source = admin' using errcode = 'insufficient_privilege';
  end if;

  v_norm := public.trade_key(p_trade);
  if v_norm is null or btrim(v_norm) = '' then
    raise exception 'trade is empty after normalising: %', p_trade using errcode = 'invalid_parameter_value';
  end if;

  -- A human's choice wins over the model unless forced by an admin.
  if v_existing is not null and btrim(v_existing) <> ''
     and coalesce(v_existing_src,'') in ('wizard','admin')
     and p_source not in ('admin')
     and not (p_force and v_admin) then
    return query select p_job, v_existing, v_existing_src, false;
    return;
  end if;

  update jobs
     set trade = v_norm,
         trade_source = p_source,
         updated_at = now()
   where id = p_job;

  return query select p_job, v_norm, p_source, true;
end;
$$;

revoke all on function public.set_job_trade(text,text,text,boolean) from public, anon;
grant execute on function public.set_job_trade(text,text,text,boolean) to authenticated, service_role;

comment on function public.set_job_trade(text,text,text,boolean) is
  'The only writer of jobs.trade. Normalises through trade_key(). Will not overwrite a wizard or admin choice unless an admin forces it.';


-- ---------------------------------------------------------------------
-- backfill_missing_trades — the regex fallback, run over old rows.
-- Reads title + descr. Marks everything it touches as source = regex so
-- you can find and re-check them later.
-- ---------------------------------------------------------------------
create or replace function public.backfill_missing_trades(p_dry boolean default true)
returns table (job_id text, guessed text, from_text text)
language sql
security definer
set search_path to 'public'
as $$
  with cand as (
    select j.id,
           public.trade_key(coalesce(j.title,'') || ' ' || coalesce(j.descr,'')) as guess,
           left(coalesce(j.title,''), 60) as src
      from jobs j
     where coalesce(j.trade,'') = ''
  ),
  good as (
    select * from cand
     where guess is not null
       and guess in ('plumbing','electrical','roofing','tiling','masonry','painting',
                     'grille and gate','air conditioning','carpentry','landscaping',
                     'security','windows','handyman')
  ),
  upd as (
    update jobs j
       set trade = g.guess, trade_source = 'regex', updated_at = now()
      from good g
     where j.id = g.id and not p_dry
    returning j.id
  )
  select g.id, g.guess, g.src from good g
   where p_dry or exists (select 1 from upd where upd.id = g.id);
$$;

revoke all on function public.backfill_missing_trades(boolean) from public, anon;
grant execute on function public.backfill_missing_trades(boolean) to service_role;

comment on function public.backfill_missing_trades(boolean) is
  'Dry-run by default. select * from backfill_missing_trades() to see what it would do; pass false to write.';


-- =====================================================================
-- The canonical trade list. Kept in app_settings so the prompt and the
-- database cannot drift apart — yaad-agent reads it at call time.
-- =====================================================================
insert into public.app_settings (key, value) values
  ('trade_list',
   'plumbing,electrical,roofing,tiling,masonry,painting,grille and gate,air conditioning,carpentry,landscaping,security,windows,handyman')
on conflict (key) do update set value = excluded.value;
