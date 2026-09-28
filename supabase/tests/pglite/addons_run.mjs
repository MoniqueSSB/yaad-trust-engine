// Behaviour test for add-on work (20260928235000), run in PGlite, an
// in-memory Postgres, with stand-ins (addons_stub.sql) for the tables that
// predate the migrations. It proves the migration's own logic: who may write,
// edit, agree, decline and sign off; the stale-version guard; the invoice
// arithmetic; and that the job cannot complete while an add-on is open. It
// does NOT prove the migration against production's real tables: run
// supabase/tests/job_addons_guards.sql there for that, after applying.
//
// The stand-ins are in STUB at the bottom of this file, kept out of any .sql
// file on purpose: supabase/tests/*.sql are run against production.
//
// Run, from any scratch folder (nothing is installed into the repository):
//   npm i @electric-sql/pglite@0.2
//   cp <repo>/supabase/tests/pglite/addons_run.mjs . && node addons_run.mjs <repo>/supabase/migrations/20260928235000_add_on_work_on_a_booked_job.sql
// Every line should read PASS.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const STUB = stub();
const MIG = process.argv[2];
const db = new PGlite();
await db.exec(STUB);
// sync_job_status trigger is attached by an old migration; the migration only replaces the function.
let mig = fs.readFileSync(MIG, "utf8");
await db.exec(mig);
await db.exec(`create trigger invoices_starts_job_default before insert on public.invoices for each row execute function public.invoice_starts_job_default();`);
await db.exec(`create trigger sync_job_status before insert or update on public.jobs for each row execute function public.sync_job_status();`);
await db.exec(`insert into admins values ('admin@yaadly.test');`);

const results = [];
const ok = (name, cond, extra = "") => results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  [" + extra + "]" : ""}`);
async function as(email, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(email ? { email, role: "authenticated" } : {})}', false); set role authenticated;`);
  try { const r = await db.query(sql, params); return { rows: r.rows }; }
  catch (e) { return { err: e.message }; }
  finally { await db.exec(`reset role;`); }
}
const sys = (sql, p = []) => db.query(sql, p);
const C = "client@x.test", W = "worker@x.test", O = "other@x.test", A = "admin@yaadly.test";

// Job J1: booked, fee paid, 2 stages, working stage 1.
await db.exec(`
insert into stage_count values ('J1', 2), ('J2', 1), ('J3', 1);
insert into jobs (id, title, client_email, client_name, worker_email, worker_name, stage) values
  ('J1','Repaint bedrooms','${C}','Client','${W}','Worker',1),
  ('J2','Fix sink','${C}','Client','${W}','Worker',1),
  ('J3','Unbooked','${C}','Client',null,null,0),
  ('J4','Not paid','${C}','Client','${W}','Worker',0);
insert into job_quotes (job_id, worker_email, worker_name, labour_jmd, materials_jmd, status) values ('J1','${W}','Worker',100000,0,'accepted'),('J2','${W}','Worker',50000,0,'accepted');
insert into invoices (id, job_id, client_email, status, payable_to) values ('BILL-J1','J1','${C}','draft','yaadly'),('BILL-J2','J2','${C}','draft','yaadly'),('BILL-J4','J4','${C}','draft','yaadly');
insert into invoice_lines (invoice_id, description, qty, unit_amount_pence, is_fee) values ('BILL-J1','work',1,115000,true),('BILL-J2','work',1,57500,true),('BILL-J4','work',1,1000,true);
update invoices set status='paid' where id in ('BILL-J1','BILL-J2');
update jobs set updated_at = now();
`);
const st = async (j) => (await sys(`select status from jobs where id=$1`, [j])).rows[0].status;
ok("J1 starts in progress", (await st("J1")) === "in_progress", await st("J1"));
ok("fee bill still starts_job", (await sys(`select starts_job from invoices where id='BILL-J1'`)).rows[0].starts_job === true);

// Who may write one
let r = await as(W, `select public.propose_addon_as_me('J1','Extra wall',20000,'in_full') id`);
ok("worker cannot write an add-on", !!r.err, r.err);
r = await as(O, `select public.propose_addon_as_me('J1','Extra wall',20000,'in_full') id`);
ok("stranger cannot write an add-on", !!r.err, r.err);
r = await as(null, `select public.propose_addon_as_me('J1','Extra wall',20000,'in_full') id`);
ok("signed-out refused", !!r.err, r.err);
r = await as(C, `select public.propose_addon_as_me('J3','Extra wall',20000,'in_full') id`);
ok("unbooked job refused", !!r.err && /no tradesperson/.test(r.err), r.err);
r = await as(C, `select public.propose_addon_as_me('J4','Extra wall',20000,'in_full') id`);
ok("job not started refused", !!r.err && /once the job has started/.test(r.err), r.err);
r = await as(C, `select public.propose_addon_as_me('J1','  ',20000,'in_full') id`);
ok("empty scope refused", !!r.err, r.err);
r = await as(C, `select public.propose_addon_as_me('J1','Extra wall',0,'in_full') id`);
ok("zero amount refused", !!r.err, r.err);
r = await as(C, `insert into job_addons (job_id, scope, amount_jmd, written_by) values ('J1','x',1,'${C}')`);
ok("direct insert refused", !!r.err, r.err);

// The client writes it
r = await as(C, `select public.propose_addon_as_me('J1','Paint the hallway ceiling too',20000,'in_full') id`);
ok("client writes an add-on", !r.err, r.err);
const A1 = r.rows?.[0]?.id; if(!A1){console.log(results.join("\n")); process.exit(1);}
let row = (await sys(`select * from job_addons where id=$1`, [A1])).rows[0];
ok("it waits on the worker at rev 1", row.status === "with_worker" && row.rev === 1);
ok("writing it is the client's agreement", (await sys(`select count(*)::int n from job_addon_agreements where addon_id=$1 and rev=1 and side='client'`, [A1])).rows[0].n === 1);

r = await as(C, `select * from public.agree_addon_as_me('${A1}', 1)`);
ok("client cannot agree twice", !!r.err, r.err);
r = await as(C, `select public.edit_addon_as_me('${A1}', 1, 'x', 1, 'in_full')`);
ok("client cannot edit while it is with the worker", !!r.err, r.err);
r = await as(W, `select public.edit_addon_as_me('${A1}', 1, 'Paint the hallway ceiling too', 20000, 'in_full')`);
ok("an edit that changes nothing is refused", !!r.err && /Nothing changed/.test(r.err), r.err);

// The worker edits the amount
r = await as(W, `select public.edit_addon_as_me('${A1}', 1, 'Paint the hallway ceiling too, two coats', 26000, 'in_full') rev`);
ok("worker edits it", !r.err && r.rows[0].rev === 2, r.err);
row = (await sys(`select * from job_addons where id=$1`, [A1])).rows[0];
ok("edit goes back to the client", row.status === "with_client" && row.last_edit_side === "worker");
ok("the old version is kept", Array.isArray(row.history) && row.history.length === 1 && row.history[0].amount_jmd === 20000);
r = await as(C, `select * from public.agree_addon_as_me('${A1}', 1)`);
ok("agreeing a stale revision is refused", !!r.err && /changed while you had it open/.test(r.err), r.err);
r = await as(W, `select * from public.agree_addon_as_me('${A1}', 2)`);
ok("worker cannot agree its own edit again", !!r.err, r.err);

// Stages all done while the add-on is still being agreed
await db.exec(`update jobs set stage = 3 where id='J1'`);
ok("job does not complete while an add-on is being agreed", (await st("J1")) !== "complete", await st("J1"));

// The client accepts
r = await as(C, `select * from public.agree_addon_as_me('${A1}', 2)`);
ok("client agrees rev 2", !r.err && r.rows[0].status === "agreed", r.err);
const INV1 = r.rows?.[0]?.invoice_id;
let inv = (await sys(`select * from invoices where id=$1`, [INV1])).rows[0];
ok("its invoice is drafted, never sent", inv && inv.status === "draft" && inv.addon_id === A1);
ok("an add-on invoice never starts the job", inv.starts_job === false);
ok("client pays the amount plus 15%", inv.total_pence === 26000 + 3900, String(inv.total_pence));
ok("job still not complete: agreed, not signed off", (await st("J1")) !== "complete", await st("J1"));

// Evidence
r = await as(W, `select public.file_addon_evidence_as_me('${A1}', 'J1/addon/one.jpg')`);
ok("no evidence before the add-on invoice is paid", !!r.err && /once its invoice is paid/.test(r.err), r.err);
await db.exec(`update invoices set status='sent' where id='${INV1}'; update invoices set status='paid' where id='${INV1}';`);
r = await as(W, `select public.file_addon_evidence_as_me('${A1}', 'J2/addon/one.jpg')`);
ok("evidence outside the job's folder refused", !!r.err, r.err);
r = await as(O, `select public.file_addon_evidence_as_me('${A1}', 'J1/addon/one.jpg')`);
ok("stranger cannot file evidence", !!r.err, r.err);
r = await as(W, `select public.file_addon_evidence_as_me('${A1}', 'J1/addon/one.jpg', 'abc', 'Ceiling done')`);
ok("worker files evidence once paid", !r.err, r.err);
ok("add-on evidence is not stage evidence", (await sys(`select count(*)::int n from evidence where job_id='J1'`)).rows[0].n === 0);

// Sign-off
r = await as(C, `select * from public.sign_off_addon('${A1}')`);
ok("client cannot sign off", !!r.err, r.err);
r = await as(A, `select * from public.sign_off_addon('${A1}')`);
ok("a named admin signs it off", !r.err, r.err);
const PAY1 = r.rows?.[0]?.worker_payable;
inv = (await sys(`select * from invoices where id=$1`, [PAY1])).rows[0];
ok("worker payable is the amount less 5%, sent", inv && inv.payable_to === "worker" && inv.status === "sent" && inv.total_pence === 26000 - 1300, inv && String(inv.total_pence));
row = (await sys(`select * from job_addons where id=$1`, [A1])).rows[0];
ok("sign-off names the person", row.status === "signed_off" && row.signed_off_by === A);
ok("job completes once the add-on is signed off", (await st("J1")) === "complete", await st("J1"));

// The job's own payable is not blocked by the add-on payable
r = await as(A, `select * from public.raise_job_worker_payable('J1')`);
ok("job payable still raises after an add-on payable", !r.err, r.err);
const PAYJOB = r.rows?.[0]?.invoice_id;
r = await as(A, `select public.worker_pay_client_unpaid('${PAY1}') m`);
ok("add-on payable clears once its invoice is paid", !r.err && r.rows[0].m === null, r.err || r.rows[0].m);
r = await as(A, `select public.worker_pay_client_unpaid('${PAYJOB}') m`);
ok("job payable clears on the job bill", !r.err && r.rows[0].m === null, r.err || r.rows[0].m);
r = await as(C, `select public.propose_addon_as_me('J1','More',100,'in_full') id`);
ok("no add-ons on a complete job", !!r.err && /complete/.test(r.err), r.err);

// Job bill can still be re-raised with an add-on invoice on the job
await db.exec(`update invoices set status='void' where id='BILL-J1'`);
r = await as(A, `select * from public.raise_job_client_invoice('J1')`);
ok("job bill re-raises despite an add-on invoice", !r.err, r.err);

// Half now, half on sign-off, on J2
r = await as(C, `select public.propose_addon_as_me('J2','Replace the waste pipe',15001,'half_now_half_on_signoff') id`);
const A2 = r.rows?.[0]?.id;
r = await as(W, `select * from public.agree_addon_as_me('${A2}', 1)`);
ok("worker accepts as written", !r.err && r.rows[0].status === "agreed", r.err);
const H1 = r.rows?.[0]?.invoice_id;
inv = (await sys(`select * from invoices where id=$1`, [H1])).rows[0];
ok("first half is the larger half plus fee", inv.total_pence === 7501 + Math.round(7501 * 0.15), String(inv.total_pence));
// An unpaid add-on invoice must not block the job's own worker pay
await db.exec(`insert into invoices (id, job_id, payable_to, worker_email, status) values ('PAY-J2','J2','worker','${W}','draft'); insert into invoice_lines (invoice_id, description, qty, unit_amount_pence) values ('PAY-J2','x',1,47500); update invoices set status='sent' where id='PAY-J2';`);
r = await as(A, `select public.worker_pay_client_unpaid('PAY-J2') m`);
ok("an unpaid add-on invoice does not hold up the job's worker pay", !r.err && r.rows[0].m === null, r.err || r.rows[0].m);
r = await as(A, `select * from public.sign_off_addon('${A2}')`);
ok("no sign-off before the add-on invoice is paid", !!r.err, r.err);
await db.exec(`update invoices set status='paid' where id='${H1}'`);
r = await as(A, `select * from public.sign_off_addon('${A2}')`);
ok("no sign-off without evidence", !!r.err && /No evidence/.test(r.err), r.err);
await as(W, `select public.file_addon_evidence_as_me('${A2}', 'J2/a2.jpg')`);
r = await as(A, `select * from public.sign_off_addon('${A2}')`);
ok("signed off with evidence", !r.err, r.err);
const PAY2 = r.rows?.[0]?.worker_payable, H2 = r.rows?.[0]?.second_invoice;
inv = (await sys(`select * from invoices where id=$1`, [H2])).rows[0];
ok("second half drafted on sign-off", inv && inv.status === "draft" && inv.total_pence === 7500 + Math.round(7500 * 0.15), inv && String(inv.total_pence));
r = await as(A, `select public.worker_pay_client_unpaid('${PAY2}') m`);
ok("worker waits for the second half to be paid", !r.err && r.rows[0].m && /not marked paid/.test(r.rows[0].m), r.err || r.rows[0].m);
await db.exec(`update invoices set status='paid' where id='${H2}'`);
r = await as(A, `select public.worker_pay_client_unpaid('${PAY2}') m`);
ok("worker payable clears when both halves are paid", !r.err && r.rows[0].m === null, r.err || r.rows[0].m);

// Parts
r = await sys(`insert into invoices (id, job_id, part_of) values ('PART-X','J2','${H1}')`).then(()=>({}),e=>({err:e.message}));
ok("an add-on invoice cannot be split", !!r.err && /cannot be split/.test(r.err), r.err);

// Declining and withdrawing; completion follows
await db.exec(`update jobs set stage = 1, status = 'in_progress' where id='J2'`);
r = await as(C, `select public.propose_addon_as_me('J2','Tile splashback',9000) id`);
const A3 = r.rows?.[0]?.id;
await db.exec(`update jobs set stage = 2 where id='J2'`);
ok("pending add-on holds J2 open", (await st("J2")) !== "complete", await st("J2"));
r = await as(W, `select public.decline_addon_as_me('${A3}', 'Not my trade') s`);
ok("worker turns it down", !r.err && r.rows[0].s === "declined", r.err);
ok("J2 completes once nothing is open", (await st("J2")) === "complete", await st("J2"));
r = await as(W, `select public.decline_addon_as_me('${A3}')`);
ok("a declined add-on cannot be declined again", !!r.err, r.err);

// Withdraw: the waiting side
await db.exec(`update jobs set stage = 1, status='in_progress' where id='J2'`);
r = await as(C, `select public.propose_addon_as_me('J2','Fix tap',3000) id`);
const A4 = r.rows?.[0]?.id;
r = await as(C, `select public.decline_addon_as_me('${A4}') s`);
ok("client withdraws its own proposal", !r.err && r.rows[0].s === "withdrawn", r.err);

// RLS reads
r = await as(O, `select count(*)::int n from job_addons`);
ok("stranger reads no add-ons", !r.err && r.rows[0].n === 0, r.err);
r = await as(C, `select count(*)::int n from job_addons`);
ok("client reads its add-ons", !r.err && r.rows[0].n === 4, r.err || String(r.rows[0].n));
r = await as(W, `select count(*)::int n from job_addons`);
ok("booked worker reads them", !r.err && r.rows[0].n === 4, r.err || String(r.rows[0].n));
r = await as(W, `update job_addons set amount_jmd = 1`);
ok("direct update refused", !!r.err, r.err);

console.log(results.join("\n"));
const fails = results.filter(x => x.startsWith("FAIL")).length;
console.log(`\n${results.length - fails} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

function stub() {
  return `
-- Stand-ins for what predates the migrations or lives in Supabase itself.
create role anon; create role authenticated; create role service_role;
create schema auth; create schema storage; create schema extensions;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
grant usage on schema auth, storage, public to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create table storage.objects (bucket_id text, name text);
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
alter table storage.objects enable row level security;

create table public.admins (email text);
create function public.is_admin() returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from admins where lower(email) = lower(auth.jwt() ->> 'email')) $$;
grant execute on function public.is_admin() to authenticated, service_role;

create table public.jobs (id text primary key, title text, status text, open boolean default false, stage int default 0,
  client_email text, client_name text, worker_email text, worker_name text, updated_at timestamptz default now());
create table public.job_quotes (id uuid primary key default gen_random_uuid(), job_id text, worker_email text, worker_name text,
  labour_jmd numeric, materials_jmd numeric, status text, billing_mode text);
create table public.evidence (id uuid primary key default gen_random_uuid(), job_id text, stage int, storage_path text);
create table public.stage_approvals (job_id text, stage int);
create table public.stage_count (job_id text primary key, n int);
create function public.job_final_stage_count(p_job text) returns int language sql stable as $$ select (select n from stage_count where job_id = p_job) $$;
create function public.client_cleared_for_golive(p text) returns boolean language sql as $$ select true $$;
create function public.materials_owed_to_worker_jmd(p text) returns int language sql as $$ select 0 $$;

create sequence invoice_seq;
create function public.new_invoice_number() returns text language sql as $$ select 'INV-2026-' || lpad(nextval('invoice_seq')::text, 4, '0') $$;
create table public.invoices (id text primary key, client_name text, client_email text, client_user uuid, service_id text, job_id text,
  status text not null default 'draft' check (status in ('draft','sent','paid','void')), drafted_by text, currency text,
  issue_date date default current_date, due_date date, period_label text, subtotal_pence int default 0, vat_pence int default 0,
  total_pence int default 0, notes text, sent_at timestamptz, paid_at timestamptz, stage int, payable_to text default 'yaadly',
  worker_email text, part_of text references invoices(id), starts_job boolean default false,
  worker_labour_jmd integer, worker_fee_jmd integer);
create table public.invoice_lines (id bigint generated always as identity primary key, invoice_id text references invoices(id),
  catalogue_id text, description text, qty numeric, unit_amount_pence int, line_total_pence int, price_source text, sort int, is_fee boolean default false);
create function public.line_guard() returns trigger language plpgsql as $$ begin
  if (select status from invoices where id = new.invoice_id) <> 'draft' then raise exception 'lines are frozen'; end if;
  new.line_total_pence := round(new.qty * new.unit_amount_pence); return new; end $$;
create trigger line_guard before insert on invoice_lines for each row execute function line_guard();
create function public.recalc() returns trigger language plpgsql as $$ begin
  update invoices set subtotal_pence = (select coalesce(sum(line_total_pence),0) from invoice_lines where invoice_id = new.invoice_id),
    total_pence = (select coalesce(sum(line_total_pence),0) from invoice_lines where invoice_id = new.invoice_id) where id = new.invoice_id;
  return new; end $$;
create trigger recalc after insert on invoice_lines for each row execute function recalc();

-- job_client_email_matches as live
create or replace function public.job_client_email_matches(p_job_id text, p_email text) returns boolean language sql stable security definer set search_path to 'public' as $function$
  select coalesce(btrim(p_email), '') <> '' and lower(btrim(p_email)) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
     and exists (select 1 from jobs j where j.id = p_job_id and lower(coalesce(j.client_email, '')) = lower(btrim(p_email)));
$function$;
grant execute on function public.job_client_email_matches(text,text) to authenticated;
`;
}
