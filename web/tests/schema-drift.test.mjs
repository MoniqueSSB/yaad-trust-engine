// The schema drift extractor must never miss the shape that cost seven weeks
// of worker applications (RUNBOOK 73). These tests pin the shapes it reads
// and, just as important, the shapes it admits it cannot read. A write it
// cannot read is listed, never passed. If one of these fails, the extractor
// has grown a blind spot: fix the extractor, not the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanSource, objectKeys, writtenKeys, selectColumns } from "../../scripts/check-schema-drift.mjs";

const columns = (r, table, write) =>
  [...new Set(r.refs.filter((x) => x.kind === "column" && x.table === table && (write === undefined || !!x.write === write)).map((x) => x.name))].sort();

test("the showcase shape: a chained update with a multi-line object literal", () => {
  const src = `
      const { error } = await admin.from("applications").update({
        status: "received",
        submitted_at: new Date().toISOString(),
        showcase_consent: showcaseConsent,
        showcase_consent_at: new Date().toISOString(),
        showcase_consent_version: s(b.showcaseConsentVersion).slice(0, 40) || "showcase-v1",
      }).eq("id", appId);
  `;
  const r = scanSource(src, "f.ts");
  assert.deepEqual(columns(r, "applications", true), [
    "showcase_consent", "showcase_consent_at", "showcase_consent_version", "status", "submitted_at",
  ]);
  assert.deepEqual(columns(r, "applications", false), ["id"]);
  assert.equal(r.unresolved.length, 0);
});

test("a write whose argument is a variable is listed as unresolved, not passed", () => {
  const src = `await supabase.from("applications").insert(applicationRow(a, msg.from, reference));`;
  const r = scanSource(src, "f.ts");
  assert.deepEqual(columns(r, "applications"), []);
  assert.deepEqual(r.unresolved.map((u) => [u.table, u.method]), [["applications", "insert"]]);
});

test("an array of literals is read; shorthand keys and spreads are handled", () => {
  const src = `await admin.from("job_alerts").upsert([{ job_id, worker_email: w, ...extra }, { job_id, channel: "wa" }], { onConflict: "job_id" });`;
  const r = scanSource(src, "f.ts");
  assert.deepEqual(columns(r, "job_alerts", true), ["channel", "job_id", "worker_email"]);
  assert.equal(r.unresolved.length, 0);
});

test("the chain can break across lines and carry select, filters and order", () => {
  const src = `
    const { data } = await sb
      .from("jobs")
      .select("id, title, worker:worker_profiles(name), total_pence::text, alias:parish")
      .eq("status", "open")
      .in("parish", ["Kingston"])
      .order("created_at", { ascending: false });
  `;
  const r = scanSource(src, "f.ts");
  assert.deepEqual(columns(r, "jobs"), ["created_at", "id", "parish", "status", "title"]);
  assert.deepEqual(r.refs.filter((x) => x.kind === "table").map((x) => x.name), ["jobs"]);
});

test("storage.from is a bucket, and JavaScript's own .from is nothing", () => {
  const src = `
    const a = Array.from(new Set(x));
    const b = Buffer.from("abc");
    await sb.storage.from("vetting").upload(path, file);
    const { data } = await supabase.storage
      .from("evidence").createSignedUrl(p, 60);
  `;
  const r = scanSource(src, "f.ts");
  assert.deepEqual(r.refs.filter((x) => x.kind === "bucket").map((x) => x.name).sort(), ["evidence", "vetting"]);
  assert.deepEqual(r.refs.filter((x) => x.kind === "table"), []);
});

test("rpc names are collected wherever they appear", () => {
  const src = `await sb.rpc("mark_worker_paid", { p_id: id }); const q = supabase.rpc('is_admin');`;
  const r = scanSource(src, "f.ts");
  assert.deepEqual(r.refs.filter((x) => x.kind === "function").map((x) => x.name).sort(), ["is_admin", "mark_worker_paid"]);
});

test("object keys: quoted keys, computed keys skipped, strings with braces inside values", () => {
  assert.deepEqual(objectKeys(`{ "quoted_key": 1, plain: "a } b", [computed]: 2, fn() { return 1 }, last }`), ["quoted_key", "plain", "last"]);
  assert.equal(objectKeys(`rows`), null);
  assert.deepEqual(writtenKeys(`rows`), { keys: [], resolved: false });
});

test("select parsing skips what it cannot be sure of", () => {
  assert.deepEqual(selectColumns(`"*"`), []);
  assert.deepEqual(selectColumns(`"a, b, rel!inner(c), answers->>x, d::int"`), ["a", "b"]);
});
