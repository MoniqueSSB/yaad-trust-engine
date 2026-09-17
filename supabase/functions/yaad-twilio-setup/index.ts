import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SECTION_MENU_NAME, sectionMenuContent, WORKER_UPDATE_APPROVAL, WORKER_UPDATE_NAME, workerUpdateContent } from "./content.ts";

// A one-shot helper for creating Yaadly's WhatsApp content templates in
// Twilio, 15 September 2026.
//
// It exists for the same reason yaad-resend-setup does: the Twilio key lives
// here, on the server, and should stay here. The founder asked for the
// section menu to be switched on and the account credentials are function
// secrets nobody can read back, so rather than anyone typing six rows into a
// console, this creates the template from content.ts (reviewed, tested) and
// records its ContentSid in app_settings, where yaad-inbound reads it when
// the TWILIO_CONTENT_SID_PHASE secret is not set. Idempotent: an existing
// template of the same name is reused, never duplicated.
//
// Creates content only. It sends nothing to anybody and touches no job. The
// template is used in-session (inside the 24 hour window a worker's own photo
// opened), which needs no Meta approval. The worker update template is the one
// exception, submitted for approval on the founder's instruction of 17 Sep 2026
// ("fix this"); what else goes out under the business's WhatsApp identity to
// people who have NOT written in first is still the founder's call.
//
// Gated like the scheduled functions: the cron secret (env, or its SHA-256 as
// held in app_settings for any of the cron jobs), or a signed-in admin.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("YAAD_CRON_SECRET") ?? "";
const SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TOK = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SECRET_KEYS = [
  "daily_checkin_cron_secret_sha256", "job_health_cron_secret_sha256", "followup_cron_secret_sha256",
  "kickoff_check_cron_secret_sha256", "evidence_landed_check_cron_secret_sha256",
  "evidence_sweep_cron_secret_sha256", "quote_pack_check_cron_secret_sha256", "purge_cron_secret_sha256",
];

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length || !a.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Not configured." }, 500);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  // ── who is asking ──
  const presented = String(body.secret ?? "");
  let allowed = Boolean(CRON_SECRET) && presented === CRON_SECRET;
  if (!allowed && presented) {
    const { data: rows } = await admin.from("app_settings").select("key,value").in("key", SECRET_KEYS);
    const got = await sha256Hex(presented);
    for (const r of rows ?? []) {
      const expected = String(r.value ?? "").replace(/^"(.*)"$/, "$1").toLowerCase();
      if (sameHex(got, expected)) { allowed = true; break; }
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
      allowed = r.ok && (await r.json().catch(() => false)) === true;
    }
  }
  if (!allowed) return json({ error: "Admin only." }, 403);

  const action = String(body.action ?? "list");

  // Shape only, never the value: enough to tell "unset" from "wrong".
  if (action === "shape") {
    return json({
      accountSid: { length: SID.length, startsWith: SID.slice(0, 2), looksRight: /^AC[0-9a-f]{32}$/i.test(SID) },
      authToken: { length: TOK.length, hasWhitespace: /\s/.test(TOK) },
    });
  }

  if (!SID || !TOK) return json({ error: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not set on this project." }, 500);

  const call = async (path: string, init?: RequestInit) => {
    const r = await fetch(`https://content.twilio.com/v1${path}`, {
      ...init,
      headers: { Authorization: "Basic " + btoa(`${SID}:${TOK}`), "Content-Type": "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(20000),
    });
    const text = await r.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch (_) { /* keep raw */ }
    return { status: r.status, ok: r.ok, body: parsed };
  };

  type Content = { sid: string; friendly_name: string; language: string; date_created: string; types?: Record<string, unknown> };
  const listAll = async (): Promise<Content[]> => {
    const r = await call("/Content?PageSize=100");
    const contents = (r.body as { contents?: Content[] })?.contents ?? [];
    return contents.map((c) => ({ sid: c.sid, friendly_name: c.friendly_name, language: c.language, date_created: c.date_created, types: c.types }));
  };

  if (action === "list") {
    const contents = await listAll();
    return json({ count: contents.length, contents: contents.map(({ types: _t, ...c }) => c) });
  }

  // Create the section menu, or find the one already there, and record it.
  if (action === "create-section-menu") {
    const existing = (await listAll()).find((c) => c.friendly_name === SECTION_MENU_NAME);
    let sid = existing?.sid ?? "";
    let created: unknown = null;
    if (!sid) {
      const r = await call("/Content", { method: "POST", body: JSON.stringify(sectionMenuContent()) });
      created = r;
      if (!r.ok) return json({ error: "Twilio refused the template.", twilio: r }, 502);
      sid = String((r.body as { sid?: string })?.sid ?? "");
    }
    if (!/^HX[0-9a-f]{32}$/i.test(sid)) return json({ error: "No ContentSid came back.", created }, 502);
    // Where yaad-inbound reads it when the secret is unset. Quoted like the
    // other text settings so the desk shows and edits it the same way.
    const { error } = await admin.from("app_settings").upsert(
      { key: "twilio_content_sid_phase", value: JSON.stringify(sid) },
      { onConflict: "key" },
    );
    if (error) return json({ error: `Template exists (${sid}) but app_settings would not take it: ${error.message}` }, 500);
    return json({ ok: true, sid, reused: Boolean(existing), setting: "twilio_content_sid_phase" });
  }

  // The worker update template (17 Sep 2026, founder: "fix this"). Creates it,
  // or finds it, and submits it to Meta for WhatsApp approval. Records the
  // ContentSid as PENDING only: yaad-notify-client reads the live setting,
  // which "worker-update-status" writes once Meta has approved, so nothing
  // is sent with a template WhatsApp would refuse.
  if (action === "create-worker-update") {
    const existing = (await listAll()).find((c) => c.friendly_name === WORKER_UPDATE_NAME);
    let sid = existing?.sid ?? "";
    if (!sid) {
      const r = await call("/Content", { method: "POST", body: JSON.stringify(workerUpdateContent()) });
      if (!r.ok) return json({ error: "Twilio refused the template.", twilio: r }, 502);
      sid = String((r.body as { sid?: string })?.sid ?? "");
    }
    if (!/^HX[0-9a-f]{32}$/i.test(sid)) return json({ error: "No ContentSid came back." }, 502);
    const approval = await call(`/Content/${sid}/ApprovalRequests/whatsapp`, {
      method: "POST", body: JSON.stringify(WORKER_UPDATE_APPROVAL),
    });
    const { error } = await admin.from("app_settings").upsert(
      { key: "twilio_content_sid_worker_update_pending", value: JSON.stringify(sid) },
      { onConflict: "key" },
    );
    if (error) return json({ error: `Template ${sid} exists but app_settings would not take it: ${error.message}` }, 500);
    return json({ ok: true, sid, reused: Boolean(existing), approval: { status: approval.status, body: approval.body } });
  }

  // Asks Twilio where Meta's approval stands. Switches the template on, by
  // writing the setting yaad-notify-client reads, only when it is approved.
  if (action === "worker-update-status") {
    const { data: st } = await admin.from("app_settings").select("value").eq("key", "twilio_content_sid_worker_update_pending").maybeSingle();
    let sid = "";
    try { sid = String(JSON.parse(String(st?.value ?? '""'))); } catch (_) { sid = String(st?.value ?? ""); }
    if (!/^HX[0-9a-f]{32}$/i.test(sid)) return json({ error: "Nothing pending. Run create-worker-update first." }, 400);
    const r = await call(`/Content/${sid}/ApprovalRequests`);
    const wa = (r.body as { whatsapp?: { status?: string; rejection_reason?: string } })?.whatsapp ?? {};
    const status = String(wa.status ?? "unknown").toLowerCase();
    let switchedOn = false;
    if (status === "approved") {
      const { error } = await admin.from("app_settings").upsert(
        { key: "twilio_content_sid_worker_update", value: JSON.stringify(sid) },
        { onConflict: "key" },
      );
      if (error) return json({ error: `Approved, but app_settings would not take it: ${error.message}` }, 500);
      switchedOn = true;
    }
    return json({ sid, status, rejection_reason: wa.rejection_reason ?? null, switchedOn });
  }

  return json({ error: "Unknown action." }, 400);
});
