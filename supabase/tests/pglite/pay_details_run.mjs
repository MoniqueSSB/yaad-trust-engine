// Behaviour test for 20261002111939 (a worker confirms their own payment
// details), run in PGlite, an in-memory Postgres, with stand-ins for the
// tables that predate the migrations. The migrations themselves are the real
// files, applied in the order given; the LAST one is applied after a worker
// has been called back the old way, so the carry over is tested too. It does
// NOT prove anything against production's real tables.
//
// Run, from any scratch folder (nothing is installed into the repository):
//   npm i @electric-sql/pglite@0.2
//   cp <repo>/supabase/tests/pglite/pay_details_run.mjs .
//   M=<repo>/supabase/migrations
//   node pay_details_run.mjs $M/20260914240000_a_worker_gives_bank_details_straight_to_wise.sql $M/20261001194258_a_worker_without_a_bank_account_collects_by_moneygram.sql $M/20261002102157_a_new_stripe_recipient_clears_the_call_back.sql $M/20261002111939_a_worker_confirms_their_own_payment_details.sql
// Every line should read PASS.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const files = process.argv.slice(2);
const db = new PGlite();
await db.exec(stub());
for (const f of files.slice(0, -1)) await db.exec(fs.readFileSync(f, "utf8"));

const results = [];
const ok = (n, c, x = "") => results.push(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  [" + x + "]" : ""}`);
const now = () => Math.floor(Date.now() / 1000);
// code: "fresh" (signed in by code a minute ago), "stale" (two hours ago), or none.
async function as(who, sql, code = "fresh") {
  const claims = who ? { email: who.email, sub: who.sub, role: "authenticated" } : {};
  if (who && code === "fresh") claims.amr = [{ method: "otp", timestamp: now() - 60 }];
  if (who && code === "stale") claims.amr = [{ method: "otp", timestamp: now() - 7200 }];
  await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(claims)}', false); set role authenticated;`);
  try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { err: e.message }; } finally { await db.exec("reset role;"); }
}
// What the Edge Functions do: the service role, nobody signed in.
async function svc(sql) {
  await db.exec(`reset role; select set_config('request.jwt.claims', '{"role":"service_role"}', false);`);
  try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { err: e.message }; }
}
const row = async (email) => (await db.query(`select * from worker_profiles where worker_email = '${email}'`)).rows[0];
const problem = async (email) => (await db.query(`select public.worker_pay_details_problem('${email}') as p`)).rows[0].p;
const V = "pay-details-v1";
const A = { email: "admin@yaadly.test" };
const OLD = { email: "old@x.test", sub: "00000000-0000-0000-0000-00000000000c" };
const W = { email: "worker@x.test", sub: "00000000-0000-0000-0000-00000000000a" };
const O = { email: "other@x.test", sub: "00000000-0000-0000-0000-00000000000b" };

await db.exec(`
insert into admins values ('admin@yaadly.test');
insert into worker_profiles (worker_email, worker_user, name) values
  ('old@x.test', '${OLD.sub}', 'Old'), ('worker@x.test', '${W.sub}', 'Worker'), ('other@x.test', '${O.sub}', 'Other');
insert into invoices (id, status, payable_to, worker_email, total_pence, currency) values
  ('OLD1','sent','worker','old@x.test',30000,'JMD'),
  ('P1','sent','worker','worker@x.test',30000,'JMD'),
  ('P2','sent','worker','worker@x.test',30000,'JMD'),
  ('P3','sent','worker','worker@x.test',30000,'JMD'),
  ('P4','sent','worker','worker@x.test',30000,'JMD');
insert into jobs values ('J1','worker@x.test');
insert into materials_releases (id, job_id, released_at) values ('00000000-0000-0000-0000-0000000000f1','J1',now());
`);
// Before: the old worker was called back the old way.
await as(A, `select public.confirm_bank_callback('old@x.test')`);

// ------------------------------------------------------------ apply
let r;
try { await db.exec(fs.readFileSync(files.at(-1), "utf8")); r = {}; } catch (e) { r = { err: e.message }; }
ok("the migration applies", !r.err, r.err);

let wp = await row("old@x.test");
ok("a worker already called back carries over as confirmed", wp.pay_details_confirmed_at !== null && wp.pay_details_confirmed_version === "call-back-carried-over");
r = await as(A, `select public.mark_worker_paid('OLD1','bank_transfer','FT-OLD')`);
ok("and can still be paid", !r.err, r.err);

// ------------------------------------------------------------ first details, the tick
ok("a worker with nothing confirmed cannot be paid", /has not confirmed/.test(await problem("worker@x.test") ?? ""));
await svc(`update worker_profiles set wise_recipient_id = 'wise-1' where worker_email = 'worker@x.test'`);
wp = await row("worker@x.test");
ok("first details are stamped and not held", wp.pay_details_changed_at !== null && wp.pay_details_hold_until === null);
r = await as(A, `select public.mark_worker_paid('P1','bank_transfer','FT-1')`);
ok("not paid before the worker ticks", !!r.err && /has not confirmed/.test(r.err), r.err);

r = await as(W, `select public.confirm_my_payment_details('${V}')`, "none");
ok("the tick needs a code: none", !!r.err && /code Yaadly emailed/.test(r.err), r.err);
r = await as(W, `select public.confirm_my_payment_details('${V}')`, "stale");
ok("the tick needs a code: two hours old is too old", !!r.err && /code Yaadly emailed/.test(r.err), r.err);
r = await as(W, `select public.confirm_my_payment_details('old-wording')`);
ok("the tick needs the current wording", !!r.err && /out of date/.test(r.err), r.err);
r = await as(null, `select public.confirm_my_payment_details('${V}')`);
ok("nobody signed in cannot tick", !!r.err && /Not signed in/.test(r.err), r.err);
r = await as(W, `select public.confirm_my_payment_details('${V}')`);
ok("a fresh code and the tick", !r.err, r.err);
wp = await row("worker@x.test");
ok("the tick is recorded with its wording", wp.pay_details_confirmed_at !== null && wp.pay_details_confirmed_version === V);
ok("it touched only that worker", (await row("other@x.test")).pay_details_confirmed_at === null);
r = await as(A, `select public.mark_worker_paid('P1','bank_transfer','FT-1')`);
ok("first details, ticked: paid at once", !r.err, r.err);

// ------------------------------------------------------------ changed details
await svc(`update worker_profiles set wise_recipient_id = 'wise-2' where worker_email = 'worker@x.test'`);
wp = await row("worker@x.test");
ok("changed details clear the tick", wp.pay_details_confirmed_at === null);
const hold = new Date(wp.pay_details_hold_until).getTime();
ok("changed details are held for 48 hours", Math.abs(hold - Date.now() - 48 * 3600e3) < 120e3, String(wp.pay_details_hold_until));
await as(W, `select public.confirm_my_payment_details('${V}')`);
r = await as(A, `select public.mark_worker_paid('P2','bank_transfer','FT-2')`);
ok("ticked but on hold: not paid, and it says until when", !!r.err && /48 hours after the change/.test(r.err), r.err);
ok("worker_bank_checked agrees", (await db.query(`select public.worker_bank_checked('worker@x.test') c`)).rows[0].c === false);

await svc(`update worker_profiles set wise_recipient_id = null where worker_email = 'worker@x.test'`);
await svc(`update worker_profiles set wise_recipient_id = 'wise-3' where worker_email = 'worker@x.test'`);
wp = await row("worker@x.test");
ok("taking details off and on again does not shorten the hold", new Date(wp.pay_details_hold_until).getTime() >= hold);

// Time passes (test only: the superuser moves the hold into the past).
await db.exec(`select set_config('yaadly.pay_details_writer','on',false); update worker_profiles set pay_details_hold_until = now() - interval '1 minute' where worker_email = 'worker@x.test'; select set_config('yaadly.pay_details_writer','off',false);`);
r = await as(A, `select public.mark_worker_paid('P2','bank_transfer','FT-2')`);
ok("after the hold, not paid until ticked again", !!r.err && /has not confirmed/.test(r.err), r.err);
await as(W, `select public.confirm_my_payment_details('${V}')`);
r = await as(A, `select public.mark_worker_paid('P2','bank_transfer','FT-2')`);
ok("after the hold and a tick: paid", !r.err, r.err);

// ------------------------------------------------------------ nobody writes these directly
r = await as(A, `update worker_profiles set pay_details_confirmed_at = now() where worker_email = 'other@x.test' returning 1`);
ok("an admin cannot tick for a worker", !!r.err && /not written directly/.test(r.err), r.err);
r = await svc(`update worker_profiles set pay_details_hold_until = null where worker_email = 'worker@x.test'`);
ok("the service role cannot lift a hold", !!r.err && /not written directly/.test(r.err), r.err);
r = await as(W, `update worker_profiles set pay_details_confirmed_at = now() where worker_email = 'worker@x.test' returning 1`);
ok("a worker cannot write the columns directly", !!r.err || (r.rows ?? []).length === 0, r.err);
r = await svc(`insert into worker_profiles (worker_email, name, pay_details_confirmed_at) values ('new@x.test','New',now())`);
ok("a profile cannot be created already ticked", !!r.err && /confirms their own/.test(r.err), r.err);

// ------------------------------------------------------------ not me
r = await as(O, `select public.pay_details_not_me('worker@x.test')`);
ok("another worker cannot say not me for someone else", !!r.err && /Not allowed/.test(r.err), r.err);
r = await as(W, `select public.pay_details_not_me('worker@x.test')`, "none");
ok("a worker says a change was not them", !r.err, r.err);
r = await as(A, `select public.mark_worker_paid('P3','bank_transfer','FT-3')`);
ok("then nothing is paid, and it says why", !!r.err && /was not them/.test(r.err), r.err);
r = await as(A, `select public.mark_materials_sent('00000000-0000-0000-0000-0000000000f1','bank_transfer','FT-M')`);
ok("materials money is held the same way", !!r.err && /was not them/.test(r.err), r.err);
r = await as(W, `select public.confirm_my_payment_details('${V}')`);
ok("and the worker cannot tick past it", !!r.err && /payments are paused/.test(r.err), r.err);
r = await as(W, `select public.clear_pay_details_dispute('worker@x.test')`);
ok("a worker cannot clear it", !!r.err && /Admin only/.test(r.err), r.err);
r = await as(A, `select public.clear_pay_details_dispute('worker@x.test')`);
ok("an admin clears it", !r.err, r.err);
wp = await row("worker@x.test");
ok("cleared, and the worker must tick again", wp.pay_details_disputed_at === null && wp.pay_details_confirmed_at === null);
await as(W, `select public.confirm_my_payment_details('${V}')`);
r = await as(A, `select public.mark_worker_paid('P3','bank_transfer','FT-3')`);
ok("ticked again: paid", !r.err, r.err);
r = await svc(`select public.pay_details_not_me('worker@x.test')`);
ok("the not me link (service role) works too", !r.err, r.err);
await as(A, `select public.clear_pay_details_dispute('worker@x.test')`);

// ------------------------------------------------------------ Stripe
r = await svc(`update worker_profiles set stripe_recipient_id = 'acct_1' where worker_email = 'other@x.test'`);
wp = await row("other@x.test");
ok("a first Stripe recipient is not held", !r.err && wp.pay_details_hold_until === null, r.err);
await svc(`update worker_profiles set stripe_payout_method_id = 'jmba_1' where worker_email = 'other@x.test'`);
wp = await row("other@x.test");
ok("the first Stripe bank account is not held either", wp.pay_details_hold_until === null && wp.pay_details_changed_at !== null);
await as(O, `select public.confirm_my_payment_details('${V}')`);
ok("ticked: payable", (await problem("other@x.test")) === null);
await svc(`update worker_profiles set stripe_payout_method_id = 'jmba_2' where worker_email = 'other@x.test'`);
wp = await row("other@x.test");
ok("a different bank account inside Stripe is held and unticked", wp.pay_details_hold_until !== null && wp.pay_details_confirmed_at === null);

// ------------------------------------------------------------ cash pick-up
await db.exec(`update app_settings set value = 'on' where key = 'moneygram_payouts'`);
r = await as(W, `select public.set_cash_pickup('Andre Brown', 'St Catherine')`, "stale");
ok("pick-up details need a fresh code", !!r.err && /code Yaadly emailed/.test(r.err), r.err);
r = await as(W, `select public.set_cash_pickup('Andre Brown', 'St Catherine')`);
wp = await row("worker@x.test");
ok("with a fresh code they are taken, and held as a change", !r.err && wp.cash_pickup_name === "Andre Brown" && wp.pay_details_hold_until !== null, r.err);

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
create table public.stripe_payouts (invoice_id text, materials_release_id uuid, outbound_payment_id text, status text);
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
