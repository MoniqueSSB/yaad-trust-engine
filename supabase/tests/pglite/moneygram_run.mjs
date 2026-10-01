// Behaviour test for MoneyGram cash pick-up (20261001194258), run in PGlite,
// an in-memory Postgres, with stand-ins for what predates the migration. It
// proves the migration's own logic: the switch, who may set pick-up details,
// that new details clear the call-back, that mark_worker_paid takes MoneyGram
// only with a name, a transaction number and a fee, and that the fee is
// written once. It does NOT prove the migration against production's real
// tables.
//
// Run, from any scratch folder (nothing is installed into the repository):
//   npm i @electric-sql/pglite@0.2
//   cp <repo>/supabase/tests/pglite/moneygram_run.mjs . && node moneygram_run.mjs <repo>/supabase/migrations/20261001194258_a_worker_without_a_bank_account_collects_by_moneygram.sql
// Every line should read PASS.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const db = new PGlite();
await db.exec(stub());
await db.exec(fs.readFileSync(process.argv[2], "utf8"));
await db.exec(`
create trigger trg_worker_bank_callback_guard before insert or update on public.worker_profiles
  for each row execute function public.worker_bank_callback_guard();
`);

const results = [];
const ok = (n, c, x = "") => results.push(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  [" + x + "]" : ""}`);
async function as(who, sql) {
  const claims = who ? { email: who.email, sub: who.sub, role: "authenticated" } : {};
  await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(claims)}', false); set role authenticated;`);
  try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { err: e.message }; } finally { await db.exec("reset role;"); }
}
const sys = (q) => db.query(q);
const A = { email: "admin@yaadly.test" };
const W = { email: "worker@x.test", sub: "00000000-0000-0000-0000-00000000000a" };
const O = { email: "other@x.test", sub: "00000000-0000-0000-0000-00000000000b" };

await db.exec(`
insert into admins values ('admin@yaadly.test');
insert into worker_profiles (worker_email, worker_user, name) values
  ('worker@x.test', '${W.sub}', 'Worker'), ('other@x.test', '${O.sub}', 'Other');
insert into invoices (id, status, payable_to, worker_email, total_pence, currency) values
  ('P1','sent','worker','worker@x.test',30000,'JMD'),
  ('P2','sent','worker','worker@x.test',30000,'JMD'),
  ('P3','sent','worker','worker@x.test',30000,'JMD'),
  ('C1','sent','yaadly','',30000,'JMD');
`);

// The switch starts off.
let r = await as(W, `select public.moneygram_payouts_on() as on`);
ok("the switch starts off", r.rows?.[0]?.on === false, r.err);
r = await as(W, `select public.set_cash_pickup('Andre Brown', 'St Catherine')`);
ok("a worker cannot choose pick-up while it is off", !!r.err && /not open yet/.test(r.err), r.err);

// Admin marks a pay invoice paid by MoneyGram while off: refused.
r = await as(A, `select public.confirm_bank_callback('worker@x.test')`);
ok("call-back recorded by an admin", !r.err, r.err);
r = await as(A, `select public.mark_worker_paid('P1','moneygram','MG-1',500)`);
ok("MoneyGram refused while switched off", !!r.err && /switched off/.test(r.err), r.err);

// Switch on.
await db.exec(`update app_settings set value = 'on' where key = 'moneygram_payouts'`);

r = await as(null, `select public.set_cash_pickup('Andre Brown', 'St Catherine')`);
ok("nobody signed in cannot set pick-up", !!r.err && /Not signed in/.test(r.err), r.err);
r = await as(W, `select public.set_cash_pickup('A', 'St Catherine')`);
ok("a one letter name is refused", !!r.err && /exactly as it shows/.test(r.err), r.err);
r = await as(W, `select public.set_cash_pickup('Andre Brown', 'Atlantis')`);
ok("a made-up parish is refused", !!r.err && /parish/.test(r.err), r.err);

r = await as(A, `select public.mark_worker_paid('P1','moneygram','MG-1',500)`);
ok("MoneyGram refused for a worker with no pick-up name", !!r.err && /has not given a name/.test(r.err), r.err);

r = await as(W, `select public.set_cash_pickup('  Andre   Brown ', 'St Catherine')`);
ok("the worker sets their own pick-up details", !r.err, r.err);
let wp = (await sys(`select * from worker_profiles where worker_email='worker@x.test'`)).rows[0];
ok("name tidied and stored, set time stamped", wp.cash_pickup_name === "Andre Brown" && wp.cash_pickup_parish === "St Catherine" && wp.cash_pickup_set_at, JSON.stringify(wp.cash_pickup_name));
ok("new pick-up details clear the call-back", wp.bank_callback_at === null && wp.bank_callback_by === "");
let other = (await sys(`select * from worker_profiles where worker_email='other@x.test'`)).rows[0];
ok("it touched only the signed-in worker's row", other.cash_pickup_name === null);

r = await as(W, `update worker_profiles set cash_pickup_name = 'Someone Else' where worker_email = 'worker@x.test' returning 1`);
ok("a worker cannot write the column directly", !!r.err || (r.rows ?? []).length === 0, r.err);

r = await as(A, `select public.mark_worker_paid('P1','moneygram','MG-1',500)`);
ok("not paid until the call-back is done again", !!r.err && /Call-back done/.test(r.err), r.err);
r = await as(A, `select public.confirm_bank_callback('worker@x.test')`);

r = await as(A, `select public.mark_worker_paid('P1','moneygram','',500)`);
ok("MoneyGram needs the transaction number", !!r.err && /transaction number/.test(r.err), r.err);
r = await as(A, `select public.mark_worker_paid('P1','moneygram','MG-1',null)`);
ok("MoneyGram needs the fee", !!r.err && /fee/.test(r.err), r.err);
r = await as(A, `select public.mark_worker_paid('P1','moneygram','MG-1',30000)`);
ok("the fee cannot be the whole pay", !!r.err && /less than the pay/.test(r.err), r.err);
r = await as(A, `select public.mark_worker_paid('P1','bank_transfer','FT-1',500)`);
ok("a bank transfer carries no fee", !!r.err && /Only a MoneyGram/.test(r.err), r.err);
r = await as(W, `select public.mark_worker_paid('P1','moneygram','MG-1',500)`);
ok("a worker cannot mark themselves paid", !!r.err && /Admin only/.test(r.err), r.err);

r = await as(A, `select public.mark_worker_paid('P1','moneygram','MG-1',500)`);
ok("an admin marks a pick-up paid with number and fee", !r.err, r.err);
let inv = (await sys(`select * from invoices where id='P1'`)).rows[0];
ok("recorded: paid, moneygram, reference, fee, who", inv.status === "paid" && inv.paid_method === "moneygram" && inv.paid_reference === "MG-1" && inv.paid_fee_pence === 500 && inv.paid_by === "admin@yaadly.test", JSON.stringify(inv));

r = await as(A, `update invoices set paid_fee_pence = 0 where id = 'P1' returning 1`);
ok("the fee is written once", !!r.err && /recorded once/.test(r.err), r.err);
r = await as(A, `update invoices set paid_fee_pence = 100 where id = 'P2' returning 1`);
ok("no fee on an unpaid invoice", !!r.err, r.err);

r = await as(A, `select public.mark_worker_paid('P2','bank_transfer','FT-2')`);
ok("three named arguments still work for a bank transfer", !r.err, r.err);
inv = (await sys(`select * from invoices where id='P2'`)).rows[0];
ok("a bank transfer records no fee", inv.paid_method === "bank_transfer" && inv.paid_fee_pence === null);

r = await as(A, `select public.mark_worker_paid('C1','moneygram','MG-9',100)`);
ok("a client's bill is never paid out by MoneyGram", !!r.err && /client''s bill|client's bill/.test(r.err), r.err);
r = await as(A, `update invoices set status='paid', paid_method='moneygram', paid_fee_pence=1 where id='C1' returning 1`);
ok("the table refuses MoneyGram on a client bill", !!r.err, r.err);

r = await as(W, `select public.set_cash_pickup('', '')`);
ok("a worker can remove pick-up", !r.err, r.err);
wp = (await sys(`select * from worker_profiles where worker_email='worker@x.test'`)).rows[0];
ok("removed: name, parish and time cleared", wp.cash_pickup_name === null && wp.cash_pickup_parish === null && wp.cash_pickup_set_at === null);

await db.exec(`update app_settings set value = 'off' where key = 'moneygram_payouts'`);
r = await as(W, `select public.set_cash_pickup('', '')`);
ok("removing works even while switched off", !r.err, r.err);

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

create table public.worker_profiles (id serial primary key, worker_email text, worker_user uuid, name text,
  wise_recipient_id text, wise_recipient_set_at timestamptz, bank_callback_at timestamptz, bank_callback_by text not null default '');
alter table public.worker_profiles enable row level security;
create policy wp_select on public.worker_profiles for select using (worker_user = auth.uid() or is_admin());
create policy wp_admin_update on public.worker_profiles for update using (is_admin()) with check (is_admin());
grant select, update on public.worker_profiles to authenticated;

-- 20260914240000, as live.
create function public.worker_bank_callback_guard() returns trigger language plpgsql as $$ begin return new; end $$;
create function public.confirm_bank_callback(p_worker_email text) returns timestamptz language plpgsql security definer set search_path to 'public' as $f$
declare v_email text := nullif(btrim(lower(coalesce(p_worker_email, ''))), ''); v_n int;
begin
  if not public.is_admin() then raise exception 'Admin only.' using errcode = '28000'; end if;
  update worker_profiles set bank_callback_at = now() where lower(coalesce(worker_email, '')) = v_email;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'No worker profile has that email.'; end if;
  return now();
end $f$;
grant execute on function public.confirm_bank_callback(text) to authenticated;
create function public.worker_bank_checked(p_worker_email text) returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.worker_profiles where lower(coalesce(worker_email, '')) = lower(btrim(coalesce(p_worker_email, ''))) and bank_callback_at is not null) $$;
create function public.worker_pay_client_unpaid(p_invoice text) returns text language sql stable as $$ select null::text $$;

create table public.stripe_payouts (invoice_id text, outbound_payment_id text, status text);

create table public.invoices (id text primary key, status text, payable_to text, worker_email text, total_pence integer, currency text,
  paid_at timestamptz, paid_by text, paid_method text, paid_reference text, updated_at timestamptz,
  constraint invoices_paid_method_check check (paid_method is null or paid_method in ('bank_transfer', 'stripe')));
alter table public.invoices enable row level security;
create policy inv_admin on public.invoices for all using (is_admin()) with check (is_admin());
grant select, update on public.invoices to authenticated;

-- invoice_status_guard, as live on 1 Oct 2026, the parts this touches.
create function public.invoice_status_guard() returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare v_who text := nullif(btrim(lower(coalesce(auth.jwt() ->> 'email', ''))), '');
begin
  if old.status = 'paid' then
    if new.paid_at is distinct from old.paid_at or new.paid_by is distinct from old.paid_by
       or new.paid_method is distinct from old.paid_method or new.paid_reference is distinct from old.paid_reference then
      raise exception 'Invoice % was marked paid. That record is not changed.', old.id;
    end if;
  end if;
  if new.status = old.status then
    if new.status <> 'paid' and (new.paid_method is distinct from old.paid_method or new.paid_by is distinct from old.paid_by) then
      raise exception 'How an invoice was paid is recorded when it is marked paid, not before.';
    end if;
    return new;
  end if;
  if old.status = 'sent' and new.status = 'paid' then
    if not public.is_admin() then raise exception 'only a signed-in Yaadly admin may mark an invoice paid'; end if;
    if new.payable_to = 'worker' and new.paid_method is null then raise exception 'Pay workers view.'; end if;
    new.paid_at := now();
    new.paid_by := coalesce(v_who, '');
  else
    raise exception 'invoice % cannot go from % to %', new.id, old.status, new.status;
  end if;
  new.updated_at := now();
  return new;
end $f$;
create trigger invoices_status_guard before update on public.invoices for each row execute function public.invoice_status_guard();

-- The 3 argument mark_worker_paid the migration replaces.
create function public.mark_worker_paid(p_invoice text, p_method text, p_ref text default '') returns timestamptz language sql as $$ select now() $$;
`;
}
