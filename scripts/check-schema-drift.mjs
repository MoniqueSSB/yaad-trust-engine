#!/usr/bin/env node
/* Does the code write to a column that production does not have?
 *
 * Why this exists. On 25 October 2026 a screen recording of a worker's phone
 * showed every application failing at Send. yaad-vetting-upload had been
 * writing showcase_consent, showcase_consent_at and showcase_consent_version
 * to public.applications since 5 September, the day it was deployed from a
 * branch whose migration (20260905b) never reached production. Seven weeks,
 * eighteen applicants, nothing noticed. scripts/check-deploy-drift.sh
 * compares deployed function code with the repository and says nothing about
 * schema, so the function was "in step with main" the whole time. RUNBOOK 73
 * and the DECISIONS entry of 25 October 2026 tell the story.
 *
 * What it does. Reads the live column list, the live function list and the
 * live bucket list (READ ONLY, plain selects against information_schema,
 * pg_proc and storage.buckets, never DDL), then reads every Edge Function,
 * the app and the admin desk for
 *
 *   .from("table").insert({ ... })  .update({ ... })  .upsert({ ... })
 *   .from("table").select("a, b").eq("col", ...)  and the other filters
 *   .rpc("function_name")
 *   storage.from("bucket")
 *
 * and prints every table, column, function or bucket the code names that
 * production does not have.
 *
 * It is DELIBERATELY CONSERVATIVE, in the direction that matters. A write
 * whose argument is a variable rather than an object literal cannot be read
 * by a regular expression, so it is listed under "could not read" rather
 * than silently passed. A false positive costs a minute. A silent miss cost
 * seven weeks of applications.
 *
 * Known gaps, kept in scripts/schema-drift-known.json with a reason and a
 * date, are printed but do not fail the run. Today that is the worker
 * showcase table, view and bucket from 20260905b, which the desk and
 * web/app/workers/[slug] read and fail soft on. A known entry that has come
 * live is reported too, so the list cannot go stale and read as cover.
 *
 * Modes.
 *   node scripts/check-schema-drift.mjs
 *       Live. Needs the Supabase CLI linked (supabase link, or copy
 *       supabase/.temp/ from a linked checkout). Writes what it read to
 *       scripts/schema-snapshot.json so CI can compare without a secret.
 *   node scripts/check-schema-drift.mjs --snapshot
 *       Compares against scripts/schema-snapshot.json instead of the
 *       database. This is what CI runs: it holds no database credential.
 *       A stale snapshot errs towards false positives (a column added since
 *       the snapshot shows as missing), never towards a silent miss, unless
 *       a column was dropped, which is a migration nobody has written.
 *
 * Exit code 1 when something unknown is missing, 0 otherwise. It changes
 * nothing in the database and nothing in the repository except the snapshot.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const SNAPSHOT = join(ROOT, "scripts", "schema-snapshot.json");
const KNOWN = join(ROOT, "scripts", "schema-drift-known.json");
const PROJECT_REF = process.env.YAAD_PROJECT_REF || "leffyisvfvjwzilydlwf";

const args = new Set(process.argv.slice(2));
const useSnapshot = args.has("--snapshot");
const verbose = args.has("--verbose");

// ---------------------------------------------------------------------------
// 1. What production has
// ---------------------------------------------------------------------------

function cliQuery(sql) {
  // The CLI prints "Initialising login role..." and an upgrade nag around the
  // JSON, so take the outermost braces and nothing else. Rows come back as
  // {"rows":[...]} with a boundary warning we do not need.
  const r = spawnSync("npx", ["--yes", "supabase", "db", "query", "--linked", sql], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = (r.stdout || "") + "\n" + (r.stderr || "");
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  let doc = null;
  if (start >= 0 && end > start) {
    try { doc = JSON.parse(out.slice(start, end + 1)); } catch { doc = null; }
  }
  if (!doc || !Array.isArray(doc.rows)) {
    console.error("Could not read the live schema. The Supabase CLI said:");
    console.error(out.trim().split("\n").slice(0, 20).map((l) => "  " + l).join("\n"));
    console.error("");
    console.error("If that reads like a link or login problem, the fix is one of:");
    console.error("  npx supabase login");
    console.error("  npx supabase link --project-ref " + PROJECT_REF);
    console.error("  cp -R <a linked checkout>/supabase/.temp supabase/.temp   (worktrees are not linked)");
    console.error("Or run with --snapshot to compare against scripts/schema-snapshot.json.");
    process.exit(2);
  }
  return doc.rows;
}

function readLive() {
  const cols = cliQuery(
    "select table_name, column_name from information_schema.columns " +
    "where table_schema = 'public' order by 1, 2",
  );
  const fns = cliQuery(
    "select distinct p.proname as name from pg_proc p " +
    "join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1",
  );
  const buckets = cliQuery("select name from storage.buckets order by 1");
  const tables = {};
  for (const r of cols) (tables[r.table_name] ||= []).push(r.column_name);
  return {
    read_at: new Date().toISOString(),
    project_ref: PROJECT_REF,
    tables,
    functions: fns.map((r) => r.name),
    buckets: buckets.map((r) => r.name),
  };
}

function readSnapshot() {
  if (!existsSync(SNAPSHOT)) {
    console.error("No scripts/schema-snapshot.json. Run the script without --snapshot once, from a linked checkout, and commit the file.");
    process.exit(2);
  }
  return JSON.parse(readFileSync(SNAPSHOT, "utf8"));
}

// ---------------------------------------------------------------------------
// 2. What the code names
// ---------------------------------------------------------------------------

// Files that talk to Postgres through supabase-js. Tests are left out: they
// stub the client and name columns that are deliberately made up.
function sourceFiles() {
  const files = [];
  const walk = (dir, keep) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (name === "node_modules" || name === ".next" || name === ".open-next" || name === "tests") continue;
        walk(p, keep);
      } else if (keep(p)) files.push(p);
    }
  };
  const isTs = (p) => /\.(ts|tsx|mjs|js)$/.test(p) && !/\.test\.(ts|mjs|js)$/.test(p);
  walk(join(ROOT, "supabase", "functions"), isTs);
  for (const d of ["app", "lib", "components"]) {
    const p = join(ROOT, "web", d);
    if (existsSync(p)) walk(p, isTs);
  }
  const desk = join(ROOT, "concierge", "concierge.html");
  if (existsSync(desk)) files.push(desk);
  return files;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Things that have a .from() that is not a table: JavaScript built-ins and
// the storage client. The preceding identifier decides.
const NOT_A_TABLE = new Set(["Array", "Buffer", "Set", "Map", "Object", "Uint8Array", "Promise", "storage"]);

// Walks forward from `pos` (just after an opening bracket) to its matching
// close, stepping over strings, template literals and comments. Returns the
// index of the closing bracket, or -1.
function matchBracket(src, pos, open, close) {
  let depth = 1;
  let i = pos;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) return -1; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i); if (i < 0) return -1; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < src.length && src[i] !== c) { if (src[i] === "\\") i++; i++; }
      i++;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

// Top-level keys of an object literal `{ a: 1, "b": 2, c, ...rest }`.
// Returns null when the text is not an object literal.
export function objectKeys(text) {
  const t = text.trim();
  if (!t.startsWith("{")) return null;
  const end = matchBracket(t, 1, "{", "}");
  if (end < 0) return null;
  const body = t.slice(1, end);
  const keys = [];
  let i = 0;
  const skipValue = () => {
    // Advance to the next top-level comma or the end.
    let depth = 0;
    while (i < body.length) {
      const c = body[i];
      if (c === '"' || c === "'" || c === "`") {
        i++;
        while (i < body.length && body[i] !== c) { if (body[i] === "\\") i++; i++; }
        i++;
        continue;
      }
      if (c === "/" && body[i + 1] === "/") { i = body.indexOf("\n", i); if (i < 0) i = body.length; continue; }
      if (c === "/" && body[i + 1] === "*") { i = body.indexOf("*/", i); if (i < 0) i = body.length; else i += 2; continue; }
      if ("{[(".includes(c)) depth++;
      else if ("}])".includes(c)) depth--;
      else if (c === "," && depth === 0) { i++; return; }
      i++;
    }
  };
  while (i < body.length) {
    while (i < body.length && /[\s,]/.test(body[i])) i++;
    if (i >= body.length) break;
    if (body.startsWith("//", i)) { i = body.indexOf("\n", i); if (i < 0) break; continue; }
    if (body.startsWith("/*", i)) { i = body.indexOf("*/", i); if (i < 0) break; i += 2; continue; }
    if (body.startsWith("...", i)) { i += 3; skipValue(); continue; }
    if (body[i] === "[") { // computed key: cannot know it
      const e = matchBracket(body, i + 1, "[", "]");
      if (e < 0) break;
      i = e + 1; skipValue(); continue;
    }
    let key = "";
    if (body[i] === '"' || body[i] === "'") {
      const q = body[i]; const e = body.indexOf(q, i + 1);
      if (e < 0) break;
      key = body.slice(i + 1, e); i = e + 1;
    } else {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(body.slice(i));
      if (!m) { skipValue(); continue; }
      key = m[0]; i += key.length;
    }
    while (i < body.length && /\s/.test(body[i])) i++;
    if (body[i] === "(") { // method shorthand, not a column
      skipValue(); continue;
    }
    if (IDENT.test(key)) keys.push(key);
    if (body[i] === ":") { i++; skipValue(); }
    // shorthand `{ job_id, sent_on }`: the loop's leading skip eats the comma
  }
  return keys;
}

// Keys written by insert/update/upsert: an object, or an array of objects.
// Returns { keys, resolved } where resolved=false means a variable was passed.
export function writtenKeys(argText) {
  const t = argText.trim();
  if (t.startsWith("{")) return { keys: objectKeys(t) || [], resolved: true };
  if (t.startsWith("[")) {
    const end = matchBracket(t, 1, "[", "]");
    if (end < 0) return { keys: [], resolved: false };
    const inner = t.slice(1, end);
    const keys = new Set();
    let i = 0;
    let any = false;
    while (i < inner.length) {
      const j = inner.indexOf("{", i);
      if (j < 0) break;
      const e = matchBracket(inner, j + 1, "{", "}");
      if (e < 0) break;
      for (const k of objectKeys(inner.slice(j, e + 1)) || []) keys.add(k);
      any = true;
      i = e + 1;
    }
    return { keys: [...keys], resolved: any };
  }
  return { keys: [], resolved: false };
}

// Column names in a .select("...") string. Conservative: plain identifiers
// and `alias:col`; joins `rel(...)`, `*`, json paths and casts are skipped.
export function selectColumns(argText) {
  const m = /^\s*["'`]([^"'`]*)["'`]/.exec(argText);
  if (!m) return [];
  const cols = [];
  let depth = 0; let cur = "";
  const flush = () => {
    let s = cur.trim(); cur = "";
    if (!s || s === "*" ) return;
    if (/[()!>:\-]/.test(s.replace(/^[A-Za-z_][A-Za-z0-9_]*:/, ""))) {
      // join, json path, cast or hint: skip, but a bare alias:col is fine
      const a = /^[A-Za-z_][A-Za-z0-9_]*:([A-Za-z_][A-Za-z0-9_]*)$/.exec(s);
      if (a) cols.push(a[1]);
      return;
    }
    s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*:/, "");
    if (IDENT.test(s)) cols.push(s);
  };
  for (const c of m[1]) {
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (c === "," && depth === 0) { flush(); continue; }
    cur += c;
  }
  flush();
  return cols;
}

const FILTERS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "contains", "containedBy", "order", "not", "filter", "textSearch"]);
const WRITES = new Set(["insert", "update", "upsert"]);

function firstStringArg(argText) {
  const m = /^\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/.exec(argText);
  return m ? m[1] : null;
}

function lineOf(src, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (src[i] === "\n") n++;
  return n;
}

// One file in, a list of references out.
export function scanSource(src, rel) {
  const refs = [];       // { kind: table|column|function|bucket, table?, name, where }
  const unresolved = []; // { table, method, where }

  const fromRe = /\.from\(\s*["']([A-Za-z_][A-Za-z0-9_-]*)["']\s*\)/g;
  let m;
  while ((m = fromRe.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 40), m.index);
    const prev = /([A-Za-z_$][A-Za-z0-9_$]*)\s*$/.exec(before);
    const prevIdent = prev ? prev[1] : "";
    const where = `${rel}:${lineOf(src, m.index)}`;
    if (prevIdent === "storage" || /\.storage\s*$/.test(before)) {
      refs.push({ kind: "bucket", name: m[1], where });
      continue;
    }
    if (NOT_A_TABLE.has(prevIdent)) continue;
    const table = m[1];
    refs.push({ kind: "table", name: table, where });

    // Walk the chain: .method(args).method(args)...
    let pos = m.index + m[0].length;
    while (true) {
      const rest = src.slice(pos);
      const cm = /^\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(rest);
      if (!cm) break;
      const argStart = pos + cm[0].length;
      const argEnd = matchBracket(src, argStart, "(", ")");
      if (argEnd < 0) break;
      const method = cm[1];
      const argText = src.slice(argStart, argEnd);
      const mwhere = `${rel}:${lineOf(src, argStart)}`;
      if (WRITES.has(method)) {
        const { keys, resolved } = writtenKeys(argText);
        if (!resolved) unresolved.push({ table, method, where: mwhere });
        for (const k of keys) refs.push({ kind: "column", table, name: k, where: mwhere, write: true });
      } else if (method === "select") {
        for (const k of selectColumns(argText)) refs.push({ kind: "column", table, name: k, where: mwhere });
      } else if (FILTERS.has(method)) {
        const k = firstStringArg(argText);
        if (k) refs.push({ kind: "column", table, name: k, where: mwhere });
      } else if (method === "match") {
        for (const k of objectKeys(argText) || []) refs.push({ kind: "column", table, name: k, where: mwhere });
      }
      pos = argEnd + 1;
    }
  }

  const rpcRe = /\.rpc\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g;
  while ((m = rpcRe.exec(src))) {
    refs.push({ kind: "function", name: m[1], where: `${rel}:${lineOf(src, m.index)}` });
  }
  return { refs, unresolved };
}

function scan(file) {
  return scanSource(readFileSync(file, "utf8"), relative(ROOT, file));
}

// ---------------------------------------------------------------------------
// 3. Compare
// ---------------------------------------------------------------------------

function main() {
const live = useSnapshot ? readSnapshot() : readLive();
if (!useSnapshot) {
  writeFileSync(SNAPSHOT, JSON.stringify(live, null, 2) + "\n");
}

const known = existsSync(KNOWN) ? JSON.parse(readFileSync(KNOWN, "utf8")) : [];
const knownByRef = new Map(known.map((k) => [k.ref, k]));

const allRefs = [];
const allUnresolved = [];
for (const f of sourceFiles()) {
  const { refs, unresolved } = scan(f);
  allRefs.push(...refs);
  allUnresolved.push(...unresolved);
}

const liveTables = new Set(Object.keys(live.tables));
const liveFns = new Set(live.functions);
const liveBuckets = new Set(live.buckets);

// missing: ref string -> { label, where: [] }
const missing = new Map();
const add = (ref, label, where) => {
  const e = missing.get(ref) || { label, where: new Set() };
  e.where.add(where);
  missing.set(ref, e);
};
for (const r of allRefs) {
  if (r.kind === "table") {
    if (!liveTables.has(r.name)) add(`table:${r.name}`, `table or view ${r.name}`, r.where);
  } else if (r.kind === "column") {
    if (!liveTables.has(r.name) && liveTables.has(r.table) && !live.tables[r.table].includes(r.name)) {
      add(`column:${r.table}.${r.name}`, `${r.table}.${r.name}${r.write ? "  (WRITTEN)" : ""}`, r.where);
    }
    // a column on a missing table is reported once, as the table
  } else if (r.kind === "function") {
    if (!liveFns.has(r.name)) add(`function:${r.name}`, `function ${r.name}()`, r.where);
  } else if (r.kind === "bucket") {
    if (!liveBuckets.has(r.name)) add(`bucket:${r.name}`, `bucket ${r.name}`, r.where);
  }
}

const unknown = [...missing].filter(([ref]) => !knownByRef.has(ref));
const knownHit = [...missing].filter(([ref]) => knownByRef.has(ref));
const knownStale = known.filter((k) => !missing.has(k.ref));

const src = useSnapshot ? `snapshot ${SNAPSHOT.replace(ROOT + "/", "")} read ${live.read_at}` : `live, project ${live.project_ref}`;
console.log(`Schema: ${src}`);
console.log(`Code:   ${allRefs.length} references across functions, app and desk`);
console.log("");

console.log("== Named in code, NOT in production (unknown, fix or add to schema-drift-known.json) ==");
if (unknown.length === 0) console.log("  none");
for (const [, e] of unknown) {
  console.log(`  ${e.label}`);
  for (const w of [...e.where].sort()) console.log(`      ${w}`);
}
console.log("");

console.log("== Known gaps (listed in scripts/schema-drift-known.json) ==");
if (knownHit.length === 0) console.log("  none");
for (const [ref, e] of knownHit) {
  const k = knownByRef.get(ref);
  console.log(`  ${e.label}   since ${k.since}: ${k.why}`);
  if (verbose) for (const w of [...e.where].sort()) console.log(`      ${w}`);
}
console.log("");

if (knownStale.length) {
  console.log("== Known entries that are now live: remove them from schema-drift-known.json ==");
  for (const k of knownStale) console.log(`  ${k.ref}`);
  console.log("");
}

console.log("== Writes this script could NOT read (a variable, not an object literal) ==");
console.log("   Not failures. Check these by eye when the table they write to has a new column.");
if (allUnresolved.length === 0) console.log("  none");
for (const u of allUnresolved) console.log(`  ${u.table}.${u.method}()   ${u.where}`);
console.log("");

if (unknown.length) {
  console.log(`${unknown.length} unknown gap(s). A function or page deployed now would fail on these. Nothing has been changed.`);
  process.exit(1);
} else {
  console.log("Clean. Everything the code names is in production, apart from the known gaps above.");
}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
