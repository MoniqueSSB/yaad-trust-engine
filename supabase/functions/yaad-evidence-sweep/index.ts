import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

// The staging prefix in the evidence bucket had no way out.
//
// yaad-inbound stages an inbound WhatsApp photo or video at
// evidence/_pending/<uuid>.<ext> the moment it arrives, before it is known
// which job it belongs to. finalizeEvidenceItem MOVES it to
// <job_id>/<uuid>.<ext> once the worker has answered the job code and the
// "what does this show" question. A move is a rename, so a finalised item
// leaves no copy behind: anything still sitting under
// _pending/ is, by definition, evidence nobody ever answered for.
//
// Nothing removed those. No database row points at them, the bucket is
// private, and so this is storage cost and clutter rather than a data
// protection problem. It is still a leak, and it only ever grows.
//
// WHAT THIS DELETES, AND WHAT IT WILL NOT TOUCH
//
// An object goes only when all of these hold:
//   - it is older than 72 hours (yaad-inbound treats an evidence session as
//     stale at 48, so 72 can never race a live conversation);
//   - no wa_intake_sessions row updated in the last 72 hours still names it
//     in answers.pending, whatever the object's own age says;
//   - no public.evidence row carries it as storage_path.
//
// The third check should never match, because finalising renames the object
// out of _pending/. It is here as a belt against a future writer that files a
// staged path directly instead of moving it, which would otherwise turn this
// function into a deleter of live evidence.
//
// It also drops the abandoned session row itself. That is not tidying, it is
// the thing that makes the sweep coherent: see the comment on
// staleEvidenceSessions() below.
//
// Nothing here rules on anything. It deletes working state that was already
// meant to be discarded, and it touches no job, no evidence row, no money and
// no Yaad Score.
//
// Idempotent, and safe to run by hand. Pass {"dry_run": true} to be told what
// it would delete without deleting any of it.
//
// Auth and scheduling follow yaad-vetting-purge and 20260827f exactly: the
// pg_cron job inside this database cannot read this function's environment, so
// it presents its own secret and this checks it against a SHA-256 hash in
// app_settings. See 20260906013700_the_staging_prefix_gets_a_sweep.sql.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET  = Deno.env.get("YAAD_CRON_SECRET") ?? "";

const BUCKET = "evidence";
const PREFIX = "_pending";
const MIN_AGE_MS = 72 * 3600_000;

// One night's listing. Bounded so a runaway prefix cannot turn a housekeeping
// job into a twenty minute one; whatever is left over goes on the next run.
const PAGE = 1000;
const MAX_PAGES = 20;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SessionRow = { wa_id: string; answers: Record<string, unknown>; updated_at: string };

const pendingPaths = (row: SessionRow): string[] => {
  const items = (row.answers as { pending?: unknown })?.pending;
  if (!Array.isArray(items)) return [];
  return items.map((i) => String((i as { path?: unknown })?.path ?? "")).filter(Boolean);
};

// Why the abandoned session row goes too.
//
// yaad-inbound intends to drop a stale evidence session at 48 hours, but that
// branch sits after the evidence branch and returns before reaching it, so for
// an evidence session it never runs. Nothing else deletes the row either.
//
// That matters here rather than being somebody else's bug: if this function
// deleted the staged files and left the row, a worker coming back on day five
// would be asked "what does this show", answer it, and be told "Confirmed, but
// nothing saved properly" because the files they are describing are gone.
// Deleting the row with them means that worker is simply read fresh, which is
// what the 48 hour rule was written to do in the first place.
//
// Only the evidence lane. The other lanes hold no staged files and are not
// this function's business.
const staleEvidenceSessions = (rows: SessionRow[], cutoff: number): SessionRow[] =>
  rows.filter((r) =>
    String((r.answers as { _lane?: unknown })?._lane ?? "") === "evidence" &&
    new Date(r.updated_at).getTime() < cutoff);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-evidence-sweep", req);
  const root = trace.startSpan(`${req.method} /yaad-evidence-sweep`, SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush(); return res;
  };
  const json = (b: unknown, status = 200) =>
    done(new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } }), status);

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Not configured." }, 500);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const dryRun = body.dry_run === true;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Either the scheduler's shared secret, or a signed-in admin. Same two
    // doors as yaad-vetting-purge, and the same reason the stored value is a
    // hash: the only copy of the plaintext lives inside the cron job command,
    // and the cron schema is not exposed through PostgREST.
    const presented = String(body.secret ?? "");
    let allowed = Boolean(CRON_SECRET) && presented === CRON_SECRET;

    if (!allowed && presented) {
      const { data: st } = await admin
        .from("app_settings").select("value")
        .eq("key", "evidence_sweep_cron_secret_sha256").maybeSingle();
      const expected = String(st?.value ?? "").toLowerCase();
      if (expected) {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(presented));
        const got = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
        // Constant time. A byte-at-a-time timing difference is a slow way to
        // guess a secret, but it is still a way.
        if (got.length === expected.length) {
          let diff = 0;
          for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
          allowed = diff === 0;
        }
      }
    }

    if (!allowed) {
      const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (jwt) {
        const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${jwt}` },
          body: "{}",
        });
        allowed = r.ok && (await r.json()) === true;
      }
    }
    if (!allowed) {
      root.setAttributes({ "yaadly.sweep.outcome": "denied" });
      return json({ error: "Admin only." }, 403);
    }

    const cutoff = Date.now() - MIN_AGE_MS;

    // ── what a live conversation is still holding ─────────────────────────
    //
    // This table is working state and is nearly always empty, so it is read
    // whole rather than filtered. Age is applied here, not in the query: a row
    // touched in the last 72 hours protects every path it names regardless of
    // how old the object itself is, which is what makes the sweep safe by
    // construction rather than safe by the margin between 48 and 72.
    const { data: sessRows, error: sessErr } = await admin
      .from("wa_intake_sessions").select("wa_id, answers, updated_at");
    if (sessErr) {
      root.recordError(sessErr.message);
      return json({ error: sessErr.message }, 500);
    }
    const sessions = (sessRows ?? []) as SessionRow[];
    const held = new Set<string>();
    for (const r of sessions) {
      if (new Date(r.updated_at).getTime() >= cutoff) for (const p of pendingPaths(r)) held.add(p);
    }

    // ── everything sitting in the staging prefix ──────────────────────────
    const staged: { path: string; created: number }[] = [];
    let truncated = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data: objs, error: lsErr } = await admin.storage.from(BUCKET)
        .list(PREFIX, { limit: PAGE, offset: page * PAGE, sortBy: { column: "created_at", order: "asc" } });
      if (lsErr) {
        root.recordError(lsErr.message);
        return json({ error: lsErr.message }, 500);
      }
      const batch = objs ?? [];
      for (const o of batch) {
        // A folder placeholder is not an object. Storage returns those with a
        // null id, and the one Supabase creates itself is dot-prefixed.
        if (!o.id || o.name.startsWith(".")) continue;
        staged.push({ path: `${PREFIX}/${o.name}`, created: new Date(o.created_at ?? o.updated_at ?? 0).getTime() });
      }
      if (batch.length < PAGE) break;
      if (page === MAX_PAGES - 1) truncated = true;
    }

    const old = staged.filter((s) => s.created > 0 && s.created < cutoff && !held.has(s.path));

    // ── the belt: is any of this actually filed evidence? ─────────────────
    //
    // It should never be, because finalising renames the object out of this
    // prefix. If it ever is, the object is live and this function has no
    // business near it.
    const filed = new Set<string>();
    for (let i = 0; i < old.length; i += 100) {
      const chunk = old.slice(i, i + 100).map((s) => s.path);
      const { data: rows, error: evErr } = await admin
        .from("evidence").select("storage_path").in("storage_path", chunk);
      if (evErr) {
        root.recordError(evErr.message);
        return json({ error: evErr.message }, 500);
      }
      for (const r of rows ?? []) filed.add(String(r.storage_path));
    }

    const doomed = old.filter((s) => !filed.has(s.path)).map((s) => s.path);
    const stale = staleEvidenceSessions(sessions, cutoff);

    if (dryRun) {
      root.setAttributes({
        "yaadly.sweep.dry_run": true,
        "yaadly.sweep.staged": staged.length,
        "yaadly.sweep.would_delete": doomed.length,
      });
      return json({
        ok: true, dry_run: true, truncated,
        staged: staged.length, held_by_live_session: held.size, filed_elsewhere: filed.size,
        would_delete: doomed.length, would_drop_sessions: stale.length,
        sample: doomed.slice(0, 10),
      });
    }

    let deleted = 0;
    for (let i = 0; i < doomed.length; i += 100) {
      const chunk = doomed.slice(i, i + 100);
      const { error: rmErr } = await admin.storage.from(BUCKET).remove(chunk);
      // A file that has already gone still counts. The point is that it is not
      // there any more, not that this run is the one that removed it.
      if (rmErr && !/not found/i.test(rmErr.message)) {
        root.recordError(`${chunk.length} objects: ${rmErr.message}`);
        continue;
      }
      deleted += chunk.length;
    }

    // Sessions last, so a failed delete above never orphans a row from the
    // files it names.
    let droppedSessions = 0;
    for (const s of stale) {
      const { error: delErr } = await admin.from("wa_intake_sessions").delete().eq("wa_id", s.wa_id);
      if (delErr) { root.recordError(`${s.wa_id}: ${delErr.message}`); continue; }
      droppedSessions++;
    }

    root.setAttributes({
      "yaadly.sweep.staged": staged.length,
      "yaadly.sweep.deleted": deleted,
      "yaadly.sweep.sessions_dropped": droppedSessions,
      "yaadly.sweep.truncated": truncated,
    });
    return json({
      ok: true, truncated,
      staged: staged.length, held_by_live_session: held.size, filed_elsewhere: filed.size,
      deleted, sessions_dropped: droppedSessions,
    });
  } catch (e) {
    root.recordError(e);
    return json({ error: "Sweep failed." }, 500);
  }
});
