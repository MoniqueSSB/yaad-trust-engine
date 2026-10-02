// Behaviour test for 20261002102157 (a new Stripe recipient, or a new bank
// account inside Stripe, clears the call-back), run in PGlite, an in-memory Postgres, with stand-ins for what
// predates the migrations. The guard itself is NOT a stand-in: the real
// migration files are applied in the order given, so this proves the new
// trigger against the guard as written, and, when the MoneyGram file is
// passed too, against that restatement of it. It does NOT prove anything
// against production's real tables.
//
// Run, from any scratch folder (nothing is installed into the repository):
//   npm i @electric-sql/pglite@0.2
//   cp <repo>/supabase/tests/pglite/stripe_callback_run.mjs .
//   M=<repo>/supabase/migrations
//   node stripe_callback_run.mjs $M/20260914240000_a_worker_gives_bank_details_straight_to_wise.sql $M/20261002102157_a_new_stripe_recipient_clears_the_call_back.sql
// and once more with the MoneyGram restatement of the guard in the middle:
//   node stripe_callback_run.mjs $M/20260914240000_a_worker_gives_bank_details_straight_to_wise.sql $M/20261001194258_a_worker_without_a_bank_account_collects_by_moneygram.sql $M/20261002102157_a_new_stripe_recipient_clears_the_call_back.sql
// Every line should read PASS.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const db = new PGlite();
await db.exec(stub());
for (const f of process.argv.slice(2)) await db.exec(fs.readFileSync(f, "utf8"));

const results = [];
const ok = (n, c, x = "") => results.push(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  [" + x + "]" : ""}`);
async function as(who, sql) {
  const claims = who ? { email: who.email, sub: who.sub, role: "authenticated" } : {};
  await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(claims)}', false); set role authenticated;`);
  try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { err: e.message }; } finally { await db.exec("reset role;"); }
}
// What yaad-payout-setup does: the service role, nobody signed in.
async function svc(sql) {
  await db.exec(`reset role; select set_config('request.jwt.claims', '{"role":"service_role"}', false);`);
  try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { err: e.message }; }
}
const row = async (email) => (await db.query(`select * from worker_profiles where worker_email = '${email}'`)).rows[0];
const checked = async (email) => (await db.query(`select public.worker_bank_checked('${email}') as c`)).rows[0].c;
const A = { email: "admin@yaadly.test" };
const W = { email: "worker@x.test", sub: "00000000-0000-0000-0000-00000000000a" };

await db.exec(`
insert into admins values ('admin@yaadly.test');
insert into worker_profiles (worker_email, worker_user, name) values
  ('worker@x.test', '${W.sub}', 'Worker'), ('other@x.test', null, 'Other');
insert into invoices (id, status, payable_to, worker_email, total_pence, currency) values
  ('P1','sent','worker','worker@x.test',30000,'JMD'),
  ('P2','sent','worker','worker@x.test',30000,'JMD');
`);

// The worker's Wise details were checked by phone.
await svc(`update worker_profiles set wise_recipient_id = 'wise-1' where worker_email = 'worker@x.test'`);
let r = await as(A, `select public.confirm_bank_callback('worker@x.test')`);
ok("an admin records the call-back", !r.err, r.err);
r = await as(A, `select public.confirm_bank_callback('other@x.test')`);
ok("and the other worker's", !r.err, r.err);
ok("the worker counts as checked", (await checked("worker@x.test")) === true);

// The worker sets up Stripe for the first time. This is the gap.
r = await svc(`update worker_profiles set stripe_recipient_id = 'acct_1', stripe_recipient_status = 'started', stripe_recipient_checked_at = now() where worker_email ilike 'worker@x.test'`);
ok("yaad-payout-setup records a new recipient", !r.err, r.err);
let wp = await row("worker@x.test");
ok("a first Stripe recipient clears the call-back", wp.bank_callback_at === null && wp.bank_callback_by === "", JSON.stringify([wp.bank_callback_at, wp.bank_callback_by]));
ok("the worker no longer counts as checked", (await checked("worker@x.test")) === false);
ok("the other worker's call-back is untouched", (await row("other@x.test")).bank_callback_at !== null);

r = await as(A, `select public.mark_worker_paid('P1','bank_transfer','FT-1')`);
ok("nobody can be marked paid until the call-back is done again", !!r.err && /Call-back done/.test(r.err), r.err);

r = await as(A, `select public.confirm_bank_callback('worker@x.test')`);
ok("an admin calls back again", !r.err, r.err);
wp = await row("worker@x.test");
ok("the call-back is stamped with who did it", wp.bank_callback_at !== null && wp.bank_callback_by === "admin@yaadly.test", wp.bank_callback_by);

// What yaad-payout-setup writes every time it reads Stripe: not new details.
r = await svc(`update worker_profiles set stripe_recipient_status = 'ready', stripe_recipient_checked_at = now() where worker_email ilike 'worker@x.test'`);
ok("a status read is recorded", !r.err, r.err);
ok("a status read does not clear the call-back", (await checked("worker@x.test")) === true);
r = await svc(`update worker_profiles set stripe_recipient_id = 'acct_1', stripe_recipient_status = 'ready' where worker_email ilike 'worker@x.test'`);
ok("writing the same recipient again does not clear it", (await checked("worker@x.test")) === true, r.err);

// A different recipient, by anybody.
r = await as(A, `update worker_profiles set stripe_recipient_id = 'acct_2' where worker_email = 'worker@x.test' returning 1`);
ok("an admin replaces the recipient", !r.err && r.rows.length === 1, r.err);
ok("a replaced recipient clears the call-back", (await checked("worker@x.test")) === false);

// Changing the recipient and recording a call-back in one statement.
await as(A, `select public.confirm_bank_callback('worker@x.test')`);
r = await as(A, `update worker_profiles set stripe_recipient_id = 'acct_3', bank_callback_at = now() where worker_email = 'worker@x.test' returning 1`);
wp = await row("worker@x.test");
ok("a call-back written in the same update as a new recipient does not stick", wp.bank_callback_at === null && wp.bank_callback_by === "", r.err ?? JSON.stringify(wp.bank_callback_at));

// Removing the recipient.
await as(A, `select public.confirm_bank_callback('worker@x.test')`);
await svc(`update worker_profiles set stripe_recipient_id = null where worker_email = 'worker@x.test'`);
ok("removing the recipient clears the call-back too", (await checked("worker@x.test")) === false);

// A new bank account inside Stripe, same recipient (gap 2). yaad-payout-setup
// records Stripe's default on the worker's return; yaad-payout-send records
// a different one it finds before refusing.
await as(A, `select public.confirm_bank_callback('worker@x.test')`);
await svc(`update worker_profiles set stripe_recipient_id = 'acct_4' where worker_email = 'worker@x.test'`);
await as(A, `select public.confirm_bank_callback('worker@x.test')`);
r = await svc(`update worker_profiles set stripe_recipient_status = 'ready', stripe_payout_method_id = 'jmba_1' where worker_email ilike 'worker@x.test'`);
ok("the first bank account Stripe names clears the call-back", !r.err && (await checked("worker@x.test")) === false, r.err);
await as(A, `select public.confirm_bank_callback('worker@x.test')`);
await svc(`update worker_profiles set stripe_recipient_status = 'ready', stripe_payout_method_id = 'jmba_1' where worker_email ilike 'worker@x.test'`);
ok("reading back the same bank account does not clear it", (await checked("worker@x.test")) === true);
await svc(`update worker_profiles set stripe_payout_method_id = 'jmba_2' where worker_email ilike 'worker@x.test'`);
wp = await row("worker@x.test");
ok("a different bank account in Stripe clears the call-back", wp.bank_callback_at === null && wp.bank_callback_by === "" && wp.stripe_recipient_id === "acct_4");
r = await as(A, `select public.mark_worker_paid('P1','bank_transfer','FT-1')`);
ok("and nobody can be marked paid until the call-back is done again", !!r.err && /Call-back done/.test(r.err), r.err);
await as(A, `select public.confirm_bank_callback('worker@x.test')`);
await as(A, `update worker_profiles set stripe_payout_method_id = 'jmba_3', bank_callback_at = now() where worker_email = 'worker@x.test'`);
ok("a call-back written with a new bank account does not stick", (await checked("worker@x.test")) === false);
r = await as(W, `update worker_profiles set stripe_payout_method_id = 'jmba_mine' where worker_email = 'worker@x.test' returning 1`);
ok("a worker cannot write the bank account id directly", !!r.err || (r.rows ?? []).length === 0, r.err);

// The rules that were already there still hold.
await as(A, `select public.confirm_bank_callback('worker@x.test')`);
await svc(`update worker_profiles set wise_recipient_id = 'wise-2' where worker_email = 'worker@x.test'`);
ok("new Wise details still clear the call-back", (await checked("worker@x.test")) === false);
r = await svc(`update worker_profiles set bank_callback_at = now() where worker_email = 'worker@x.test'`);
ok("nobody signed in still cannot record a call-back", !!r.err && /named person/.test(r.err), r.err);
r = await as(W, `update worker_profiles set stripe_recipient_id = 'acct_mine' where worker_email = 'worker@x.test' returning 1`);
ok("a worker still cannot write the recipient directly", !!r.err || (r.rows ?? []).length === 0, r.err);

// And the end of the line: checked, then paid.
await as(A, `select public.confirm_bank_callback('worker@x.test')`);
r = await as(A, `select public.mark_worker_paid('P2','bank_transfer','FT-2')`);
ok("after a fresh call-back the worker can be paid", !r.err, r.err);

console.log(results.join("\n"));
const fails = results.filter(x => x.startsWith("FAIL")).length;
console.log(`\n${results.length - fails} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

function stub() {
  return `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create table public.admins (email text);
create function public.is_admin() returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from admins where lower(email) = lower(auth.jwt() ->> 'email')) $$;
grant execute on function public.is_admin() to authenticated, service_role;

create table public.app_settings (key text primary key, value text);

-- worker_profiles as before 20260914240000, plus the Stripe columns of 20260914200000.
create table public.worker_profiles (id serial primary key, worker_email text, worker_user uuid, name text,
  stripe_recipient_id text, stripe_recipient_status text not null default 'none', stripe_recipient_checked_at timestamptz);
alter table public.worker_profiles enable row level security;
create policy wp_select on public.worker_profiles for select using (worker_user = auth.uid() or is_admin());
create policy wp_admin_update on public.worker_profiles for update using (is_admin()) with check (is_admin());
grant select, update on public.worker_profiles to authenticated;

create table public.jobs (id text primary key, worker_email text);
create table public.materials_releases (id uuid primary key, job_id text, released_at timestamptz, sent_at timestamptz, sent_by text, sent_method text, sent_ref text);
create table public.stripe_payouts (invoice_id text, outbound_payment_id text, status text);
create function public.worker_pay_client_unpaid(p_invoice text) returns text language sql stable as $$ select null::text $$;

create table public.invoices (id text primary key, status text, payable_to text, worker_email text, total_pence integer, currency text,
  paid_at timestamptz, paid_by text, paid_method text, paid_reference text, updated_at timestamptz,
  constraint invoices_paid_method_check check (paid_method is null or paid_method in ('bank_transfer', 'stripe')));
alter table public.invoices enable row level security;
create policy inv_admin on public.invoices for all using (is_admin()) with check (is_admin());
grant select, update on public.invoices to authenticated;

-- invoice_status_guard, as live, the parts marking a worker paid touches.
create function public.invoice_status_guard() returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare v_who text := nullif(btrim(lower(coalesce(auth.jwt() ->> 'email', ''))), '');
begin
  if new.status = old.status then return new; end if;
  if old.status = 'sent' and new.status = 'paid' then
    if not public.is_admin() then raise exception 'only a signed-in Yaadly admin may mark an invoice paid'; end if;
    new.paid_at := now();
    new.paid_by := coalesce(v_who, '');
  else
    raise exception 'invoice % cannot go from % to %', new.id, old.status, new.status;
  end if;
  return new;
end $f$;
create trigger invoices_status_guard before update on public.invoices for each row execute function public.invoice_status_guard();
`;
}
