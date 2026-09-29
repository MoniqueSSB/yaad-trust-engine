// Behaviour test for 20260929100000 (each stage is paid before it starts),
// in PGlite with stand-ins, layered on 20260928235000 whose
// raise_job_client_invoice it restates. Run like addons_run.mjs:
//   node stages_run.mjs <add-on migration> <this migration>
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const db = new PGlite();
await db.exec(STUB());
await db.exec(fs.readFileSync(process.argv[2], "utf8"));
await db.exec(fs.readFileSync(process.argv[3], "utf8"));
await db.exec(`create trigger invoices_starts_job_default before insert on public.invoices for each row execute function public.invoice_starts_job_default();
create trigger sync_job_status before insert or update on public.jobs for each row execute function public.sync_job_status();
create trigger trg_evidence_on_the_working_stage before insert on public.evidence for each row execute function public.evidence_on_the_working_stage();
insert into admins values ('admin@yaadly.test');`);
const results = [];
const ok = (n, c, x = "") => results.push(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  [" + x + "]" : ""}`);
async function as(email, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(email ? { email, role: "authenticated" } : {})}', false); set role authenticated;`);
  try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { err: e.message }; } finally { await db.exec("reset role;"); }
}
const sys = (q) => db.query(q);
const C = "client@x.test", W = "worker@x.test", A = "admin@yaadly.test";
await db.exec(`
insert into stage_count values ('S1', 3), ('F1', 1);
insert into jobs (id, title, client_email, client_name, worker_email, worker_name, stage) values
  ('S1','Verandah','${C}','Client','${W}','Worker',0), ('F1','Tap','${C}','Client','${W}','Worker',0);
insert into job_quotes (job_id, worker_email, worker_name, labour_jmd, materials_jmd, status, billing_mode) values
  ('S1','${W}','Worker',100000,20000,'accepted','by_stage'), ('F1','${W}','Worker',10000,0,'accepted','in_full');
insert into quote_pack_drafts (id, job_id, status, docs, approved_at) values
  ('Q1','S1','approved','{"payment_stages":[{"stage":"Frame","proportion_percent":30},{"stage":"Deck","proportion_percent":50},{"stage":"Finish","proportion_percent":20}]}', now());
`);
let r = await as(A, `select * from public.raise_job_client_invoice('S1')`);
ok("by stage: the start bill is raised", !r.err, r.err);
const START = r.rows?.[0]?.invoice_id;
ok("start bill is the 15% on all the labour plus materials", r.rows?.[0]?.total_jmd === 15000 + 20000, String(r.rows?.[0]?.total_jmd));
let inv = (await sys(`select * from invoices where id='${START}'`)).rows[0];
ok("the start bill starts the job", inv.starts_job === true);
const lines = (await sys(`select description, line_total_pence from invoice_lines where invoice_id='${START}' order by sort`)).rows;
ok("no labour on the start bill, the 15% never split", lines.length === 2 && lines[0].line_total_pence === 15000, JSON.stringify(lines));
let s1 = (await sys(`select * from invoices where job_id='S1' and stage=1`)).rows[0];
ok("stage 1 bill drafted with it, 30% of the labour", s1 && s1.status === "draft" && s1.total_pence === 30000 && s1.starts_job === false, s1 && String(s1.total_pence));
r = await as(A, `select * from public.raise_job_client_invoice('S1')`);
ok("cannot raise the start bill twice", !!r.err);

// Pay the start bill: the job starts, but stage 1 is not paid yet
await db.exec(`update invoices set status='sent' where id='${START}'; update invoices set status='paid' where id='${START}'; update jobs set stage = 1 where id='S1';`);
r = await as(W, `insert into evidence (job_id, stage, kind) values ('S1', 1, 'work')`);
ok("no work evidence on stage 1 until its bill is paid", !!r.err && /starts once its bill is paid/.test(r.err), r.err);
r = await as(W, `insert into evidence (job_id, stage, kind) values ('S1', 1, 'materials')`);
ok("materials evidence is let through", !r.err, r.err);
await db.exec(`update invoices set status='sent' where id='${s1.id}'; update invoices set status='paid' where id='${s1.id}';`);
r = await as(W, `insert into evidence (job_id, stage, kind) values ('S1', 1, 'work')`);
ok("stage 1 is worked once paid", !r.err, r.err);

// Approving stage 1 drafts stage 2; stage 2 stays closed until paid
await db.exec(`insert into stage_approvals (job_id, stage) values ('S1', 1); update jobs set stage = 2 where id='S1';`);
let s2 = (await sys(`select * from invoices where job_id='S1' and stage=2`)).rows[0];
ok("approving stage 1 drafts the stage 2 bill, 50%", s2 && s2.status === "draft" && s2.total_pence === 50000, s2 && String(s2.total_pence));
r = await as(W, `insert into evidence (job_id, stage, kind) values ('S1', 2, 'work')`);
ok("stage 2 cannot move on until paid", !!r.err && /Stage 2 starts once its bill is paid/.test(r.err), r.err);
await db.exec(`update invoices set status='sent' where id='${s2.id}'; update invoices set status='paid' where id='${s2.id}';`);
r = await as(W, `insert into evidence (job_id, stage, kind) values ('S1', 2, 'work')`);
ok("stage 2 moves on once paid", !r.err, r.err);
await db.exec(`insert into stage_approvals (job_id, stage) values ('S1', 2); update jobs set stage = 3 where id='S1';`);
let s3 = (await sys(`select * from invoices where job_id='S1' and stage=3`)).rows[0];
ok("stage 3 drafted at 20%", s3 && s3.total_pence === 20000);
await db.exec(`insert into stage_approvals (job_id, stage) values ('S1', 3);`);
ok("no bill beyond the last stage", (await sys(`select count(*)::int n from invoices where job_id='S1' and stage=4`)).rows[0].n === 0);
const sum = (await sys(`select sum(total_pence)::int s from invoices where job_id='S1' and stage between 1 and 3`)).rows[0].s;
ok("the stage bills add up to the whole labour", sum === 100000, String(sum));

// Paid in full is unchanged
r = await as(A, `select * from public.raise_job_client_invoice('F1')`);
ok("in full: one bill, labour + 15%", !r.err && r.rows[0].total_jmd === 11500, r.err || String(r.rows[0].total_jmd));
ok("in full: no stage bills", (await sys(`select count(*)::int n from invoices where job_id='F1' and stage is not null`)).rows[0].n === 0);
await db.exec(`update invoices set status='sent' where job_id='F1'; update invoices set status='paid' where job_id='F1'; update jobs set stage=1 where id='F1';`);
r = await as(W, `insert into evidence (job_id, stage, kind) values ('F1', 1, 'work')`);
ok("in full: work goes ahead once the bill is paid", !r.err, r.err);

// No schedule: by stage refuses rather than guessing
await db.exec(`insert into jobs (id, title, client_email, client_name, worker_email, worker_name, stage) values ('S2','X','${C}','C','${W}','W',0);
insert into job_quotes (job_id, worker_email, labour_jmd, materials_jmd, status, billing_mode) values ('S2','${W}',50000,0,'accepted','by_stage');`);
r = await as(A, `select * from public.raise_job_client_invoice('S2')`);
ok("by stage with no schedule is refused, not guessed", !!r.err && /no approved payment schedule/.test(r.err), r.err);

console.log(results.join("\n"));
const fails = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`\n${results.length - fails} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

function STUB() {
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

create schema net;
create table public.sent (kind text, meta jsonb, at timestamptz default clock_timestamp());
create function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int) returns bigint language sql as $$ insert into public.sent (kind, meta) values (body->>'kind', body->'meta') returning 1::bigint $$;
create function public.notify_trigger_secret() returns text language sql as $$ select 'x' $$;
create function public.same_phone(a text, b text) returns boolean language sql as $$ select right(regexp_replace(coalesce(a,''),'\\D','','g'),10) = right(regexp_replace(coalesce(b,''),'\\D','','g'),10) and length(regexp_replace(coalesce(a,''),'\\D','','g')) >= 9 $$;
create table public.admins (email text);
create function public.is_admin() returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from admins where lower(email) = lower(auth.jwt() ->> 'email')) $$;
grant execute on function public.is_admin() to authenticated, service_role;

create table public.jobs (id text primary key, title text, status text, open boolean default false, stage int default 0,
  client_email text, client_name text, client_phone text, worker_email text, worker_name text, updated_at timestamptz default now());
create table public.job_quotes (id uuid primary key default gen_random_uuid(), job_id text, worker_email text, worker_name text,
  labour_jmd numeric, materials_jmd numeric, status text, billing_mode text);
create table public.kickoff_packs (id text, job_id text, status text, docs jsonb, updated_at timestamptz default now());
create table public.quote_pack_drafts (id text, job_id text, status text, docs jsonb, approved_at timestamptz, created_at timestamptz default now());
create table public.evidence (id uuid primary key default gen_random_uuid(), job_id text, stage int, storage_path text, kind text default 'work');
grant insert, select on public.evidence to authenticated;
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
