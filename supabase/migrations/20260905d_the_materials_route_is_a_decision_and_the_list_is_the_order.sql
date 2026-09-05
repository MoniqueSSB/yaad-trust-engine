-- Step 1 of specs/MATERIALS-ROUTE-FLOW-SPEC.md: the database learns the
-- materials route, and the worker gets somewhere to say what he actually
-- needs. Database only. No form changes here, so nothing visible moves yet.
--
-- WHY THE ROUTE HAD TO BECOME A REAL COLUMN. jobs.materials_by has existed
-- since 20260826f as unconstrained free text, written once by yaad-post-job
-- and read only to print a chip on the board and a column in the desk. It
-- decided nothing. The route was in fact decided by the WORKER, in
-- web/app/jobs/actions.ts, by whether he typed a number into materials_jmd.
-- Under the principal structure that is the wrong person: who buys the
-- materials decides who carries the risk on the goods, and that is the
-- client's call, made before anybody prices anything.
--
-- WHY THE LIST IS NOT A NOTE. job_quotes already carries scope_summary,
-- included_note and excluded_note, and a materials list could have been
-- another paragraph. It is a table instead because on Route B the list is not
-- description, it is an ORDER: the client is buying, and if nothing tells them
-- what to buy, the worker arrives to a site with no blocks on it. That is the
-- failure this table exists to stop, and a paragraph cannot be ticked off item
-- by item as it turns up. supplied_at is how a line stops being outstanding.
--
-- On Route A the same list does the other job: it is what the materials money
-- is released against, and what the hardware receipt is read against later.
-- One structure, two uses, which is why it hangs off the quote rather than off
-- either route's machinery.

-- ------------------------------------------------------- the route, for real

-- NOT VALID on purpose. Existing rows carry whatever free text the old form
-- and the prototype put there ("Worker supplies and invoices with receipts",
-- "Split, agree item by item", and so on), none of which survives the
-- principal structure, and none of which is read by anything. Validating the
-- old rows would fail the migration to correct decoration. New and updated
-- rows are held to the two real answers from today. The backfill of legacy
-- rows is a data decision and belongs with the form change, not here.
alter table public.jobs drop constraint if exists jobs_materials_by_chk;
alter table public.jobs add constraint jobs_materials_by_chk
  check (materials_by is null or materials_by in ('yaadly','client')) not valid;

comment on column public.jobs.materials_by is
  'Who buys the materials on this job. yaadly: Yaadly buys them, they are a stage of the price and the first payment, Route A in the subcontract. client: the client supplies them and Yaadly is engaged for labour only, Route B, which moves the materials risk, the programme risk and part of the guarantee onto the client. Null means a job posted before the question existed. The two are never mixed on one job.';

-- ------------------------------------------------------------ the order list

create table if not exists public.quote_materials (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.job_quotes(id) on delete cascade,
  sort        int  not null default 0,
  item        text not null check (btrim(item) <> ''),
  qty         numeric(12,2) check (qty is null or qty > 0),
  unit        text not null default '',
  note        text not null default '',
  supplied_at timestamptz,
  supplied_by text not null default '',
  created_at  timestamptz not null default now()
);

comment on table public.quote_materials is
  'What the worker says this job needs, stated when he quotes. On Route B it is the order the client fills, and supplied_at is the client confirming that line is on site, so the worker does not travel to a job that cannot start. On Route A it is what the materials money is released against and what the receipt is read against. No prices here on purpose: the money is labour_jmd and materials_jmd on the quote, and a second set of figures is a second source of truth.';
comment on column public.quote_materials.supplied_at is
  'Route B only. When the client confirmed this line is on site. Null means outstanding, and an outstanding line is the reason a start date moves rather than the worker being at fault.';

create index if not exists quote_materials_quote_idx
  on public.quote_materials (quote_id, sort, created_at);

-- --------------------------------------------- a Route B quote has no materials

create or replace function public.quote_materials_match_route()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_by text;
begin
  select j.materials_by into v_by from public.jobs j where j.id = new.job_id;

  if v_by = 'client' and coalesce(new.materials_jmd, 0) > 0 then
    raise exception
      'This client is supplying the materials themselves, so a quote on this job is for your labour only. Take the materials figure off and quote your labour. List what the job needs in the materials list and the client buys it, so it is on site when you get there.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

comment on function public.quote_materials_match_route() is
  'Refuses a materials figure on a quote for a job the client is supplying. The form will hide the field, but the form is not the rule: a hidden field is a suggestion and this is the gate. The message tells the worker what to do instead rather than only refusing, because a refusal he cannot act on becomes a support message to Monique.';

drop trigger if exists trg_quote_materials_match_route on public.job_quotes;
create trigger trg_quote_materials_match_route
  before insert or update on public.job_quotes
  for each row execute function public.quote_materials_match_route();

-- ------------------------------------------------------------------- RLS

alter table public.quote_materials enable row level security;

drop policy if exists qm_admin        on public.quote_materials;
drop policy if exists qm_worker_write on public.quote_materials;
drop policy if exists qm_client_read  on public.quote_materials;
drop policy if exists qm_client_mark  on public.quote_materials;

create policy qm_admin on public.quote_materials
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- The worker who wrote the quote owns its list, and only while the quote is
-- still his to change. Once it is accepted the list is what both sides agreed
-- and editing it silently would move the order under the client.
create policy qm_worker_write on public.quote_materials
  for all to authenticated
  using (exists (
    select 1 from public.job_quotes q
     where q.id = quote_materials.quote_id
       and nullif(btrim(lower(auth.jwt() ->> 'email')), '') = nullif(btrim(lower(q.worker_email)), '')
  ))
  with check (exists (
    select 1 from public.job_quotes q
     where q.id = quote_materials.quote_id
       and nullif(btrim(lower(auth.jwt() ->> 'email')), '') = nullif(btrim(lower(q.worker_email)), '')
       and q.status not in ('accepted','kickoff_requested')
  ));

-- The client reads the list on their own job. On Route B they are buying from
-- it, so they need it before they accept, not after.
create policy qm_client_read on public.quote_materials
  for select to authenticated
  using (exists (
    select 1 from public.job_quotes q
     where q.id = quote_materials.quote_id
       and public.job_client_email_matches(q.job_id, (auth.jwt() ->> 'email'))
  ));

grant select, insert, update, delete on public.quote_materials to authenticated;

-- ------------------------------------------- the client ticks a line off

-- Deliberately an RPC and not an update policy. The client may set exactly two
-- fields on exactly their own lines, and row level security cannot say "these
-- columns only". A broad update policy would let a client rewrite the item, the
-- quantity or the note on a quote they are about to accept, which is the order
-- changing under the worker. Same reasoning as nominate_materials_store in
-- 20260828d: the rule lives in one function in Postgres, and the page carries
-- the form to it.
create or replace function public.mark_material_supplied(p_line uuid, p_on boolean default true)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_email text; v_ok boolean;
begin
  v_email := nullif(btrim(lower(auth.jwt() ->> 'email')), '');

  select public.job_client_email_matches(q.job_id, v_email)
    into v_ok
    from public.quote_materials m
    join public.job_quotes q on q.id = m.quote_id
   where m.id = p_line;

  if not coalesce(v_ok, false) then
    raise exception 'That materials line is not on one of your jobs.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.quote_materials
     set supplied_at = case when p_on then now() else null end,
         supplied_by = case when p_on then coalesce(v_email, '') else '' end
   where id = p_line;
end $$;

comment on function public.mark_material_supplied(uuid, boolean) is
  'Route B. The client confirms one materials line is on site, or takes the confirmation back. Sets supplied_at and supplied_by and nothing else, so the order cannot be edited under the worker by the person filling it. Admins go through the desk, not this.';

revoke all on function public.mark_material_supplied(uuid, boolean) from public;
grant execute on function public.mark_material_supplied(uuid, boolean) to authenticated;
