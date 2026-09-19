import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { recordAccepted, withStatusCallback } from "./twilio-status.ts";
import { SECTION_MENU_APPROVAL, SECTION_MENU_NAME, sectionMenuContent, WORKER_UPDATE_APPROVAL, WORKER_UPDATE_NAME, workerUpdateContent } from "./content.ts";

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

  // Read back what Twilio actually holds for the section menu, 19 Sep 2026.
  //
  // The menu has never once been accepted. yaad-inbound logged "Twilio
  // refused the template: Invalid Parameter" and fell back to the typed
  // B / D / A question, which is the fallback doing its job, and is also why
  // nobody noticed for four days: a template that never sends looks exactly
  // like a template that does. Answering "why" needs Twilio's own copy of the
  // template next to the one content.ts says it created, so here it is.
  //
  // Reads only. Creates nothing, sends nothing, writes no setting. Safe to
  // run on a live account at any time.
  // The recorded ContentSid, or the template of that name if nothing is
  // recorded. One definition, so the read-back, the submission and the test
  // send can never end up talking about different templates.
  const sectionMenuSid = async (): Promise<string> => {
    const { data: st } = await admin.from("app_settings").select("value").eq("key", "twilio_content_sid_phase").maybeSingle();
    let recorded = "";
    try { recorded = String(JSON.parse(String(st?.value ?? '""'))); } catch (_) { recorded = String(st?.value ?? ""); }
    const sid = recorded || (await listAll()).find((c) => c.friendly_name === SECTION_MENU_NAME)?.sid || "";
    return /^HX[0-9a-f]{32}$/i.test(sid) ? sid : "";
  };

  if (action === "describe-section-menu") {
    const { data: st } = await admin.from("app_settings").select("value").eq("key", "twilio_content_sid_phase").maybeSingle();
    let recorded = "";
    try { recorded = String(JSON.parse(String(st?.value ?? '""'))); } catch (_) { recorded = String(st?.value ?? ""); }
    const named = (await listAll()).find((c) => c.friendly_name === SECTION_MENU_NAME) ?? null;
    const sid = recorded || named?.sid || "";
    if (!/^HX[0-9a-f]{32}$/i.test(sid)) {
      return json({ error: "No section menu template is recorded or findable by name.", recorded, foundByName: named }, 404);
    }
    const live = await call(`/Content/${sid}`);
    const approval = await call(`/Content/${sid}/ApprovalRequests`);
    return json({
      sid,
      recordedInAppSettings: recorded || null,
      // A mismatch here means yaad-inbound is sending a template id that is
      // not the one this file's content.ts describes, which on its own would
      // explain a refusal.
      sameAsTemplateNamed: named ? named.sid === sid : null,
      twilioHolds: { status: live.status, body: live.body },
      approval: { status: approval.status, body: approval.body },
      codeWouldCreate: sectionMenuContent(),
    });
  }

  // What Messaging Services the account has, and which senders are in them.
  // 19 Sep 2026: "A Messaging Service is a prerequisite for using Content
  // Templates" (Twilio's own docs), and Yaadly's menu send passes a From
  // number and no MessagingServiceSid, which is what Twilio has been
  // refusing with 20422 since 15 September. Read only: lists, never creates.
  if (action === "list-messaging-services") {
    const r = await fetch(`https://messaging.twilio.com/v1/Services?PageSize=50`, {
      headers: { Authorization: "Basic " + btoa(`${SID}:${TOK}`) },
      signal: AbortSignal.timeout(20000),
    });
    const listed = await r.json().catch(() => null) as { services?: { sid: string; friendly_name: string }[] } | null;
    const services = listed?.services ?? [];
    const withSenders = [];
    for (const svc of services) {
      const sr = await fetch(`https://messaging.twilio.com/v1/Services/${svc.sid}/PhoneNumbers?PageSize=50`, {
        headers: { Authorization: "Basic " + btoa(`${SID}:${TOK}`) },
        signal: AbortSignal.timeout(20000),
      });
      const nums = await sr.json().catch(() => null) as { phone_numbers?: { phone_number: string }[] } | null;
      withSenders.push({
        sid: svc.sid,
        friendly_name: svc.friendly_name,
        numbers: (nums?.phone_numbers ?? []).map((n) => n.phone_number),
      });
    }
    return json({ status: r.status, count: services.length, services: withSenders, whatsappFrom: Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "" });
  }

  // Record which Messaging Service the menu send names, 19 Sep 2026.
  // Checked against Twilio before it is written, so a typo cannot quietly
  // turn the menu off. Blanking the row on the desk turns the menu off and
  // the typed letters come back, the same switch the template id already is.
  if (action === "use-messaging-service") {
    const wanted = String(body.messagingServiceSid ?? "").trim();
    if (!/^MG[0-9a-f]{32}$/i.test(wanted)) return json({ error: "Give a messagingServiceSid that looks like MG followed by 32 hex characters." }, 400);
    const r = await fetch(`https://messaging.twilio.com/v1/Services/${wanted}`, {
      headers: { Authorization: "Basic " + btoa(`${SID}:${TOK}`) },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return json({ error: "Twilio does not know that Messaging Service.", status: r.status }, 404);
    const svc = await r.json().catch(() => null) as { friendly_name?: string } | null;
    const { error } = await admin.from("app_settings").upsert(
      { key: "twilio_messaging_service_sid", value: JSON.stringify(wanted) },
      { onConflict: "key" },
    );
    if (error) return json({ error: `app_settings would not take it: ${error.message}` }, 500);
    return json({ ok: true, messagingServiceSid: wanted, friendly_name: svc?.friendly_name ?? null, setting: "twilio_messaging_service_sid" });
  }

  // Submit the section menu to Meta for WhatsApp approval, 19 Sep 2026.
  //
  // Founder's instruction, after the read-back above showed the template is
  // correct in every respect except that it has never been submitted, while
  // Twilio refuses every send of it. Unlike the worker update template,
  // nothing here waits on approval: yaad-inbound already holds the ContentSid
  // and already tries the menu on every send, so if approval is what was
  // missing the menu starts working on its own the moment Meta says yes, and
  // if approval was not the problem this changes nothing and costs nothing.
  if (action === "submit-section-menu") {
    const sid = await sectionMenuSid();
    if (!sid) return json({ error: "No section menu template to submit. Run create-section-menu first." }, 404);
    const submitted = await call(`/Content/${sid}/ApprovalRequests/whatsapp`, {
      method: "POST", body: JSON.stringify(SECTION_MENU_APPROVAL),
    });
    const now = await call(`/Content/${sid}/ApprovalRequests`);
    return json({
      sid,
      submitted: { status: submitted.status, body: submitted.body },
      approvalNow: { status: now.status, body: now.body },
      askedFor: SECTION_MENU_APPROVAL,
    });
  }

  // Send the section menu, once, to a number given in this request, and hand
  // back whatever Twilio says, 19 Sep 2026.
  //
  // THIS SENDS A REAL WHATSAPP MESSAGE. It exists because the refusal that
  // matters ("Invalid Parameter") only happens on a live send, and waiting
  // for a worker to file a photo to read an error code is not a diagnosis,
  // it is a hope. The number is never defaulted and never looked up: it is
  // typed into the request by whoever runs this, so nobody is messaged by
  // accident. Twilio's whole error body comes back, code and all, which is
  // the point. Nothing is filed, no job is touched, no setting is written.
  if (action === "test-send-section-menu") {
    const to = String(body.to ?? "").replace(/\D/g, "");
    if (to.length < 7) return json({ error: "Give a full number in 'to', with the country code." }, 400);
    const from = Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "";
    if (!from) return json({ error: "TWILIO_WHATSAPP_FROM is not set on this project." }, 500);
    const sid = await sectionMenuSid();
    if (!sid) return json({ error: "No section menu template to send." }, 404);
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(`${SID}:${TOK}`), "Content-Type": "application/x-www-form-urlencoded" },
      body: withStatusCallback(new URLSearchParams({
        To: `whatsapp:+${to}`, From: from, ContentSid: sid,
        ContentVariables: JSON.stringify({ "1": "Test of the section menu, nothing is filed by this." }),
      })),
      signal: AbortSignal.timeout(20000),
    });
    // A real message went to a real phone, so it goes on the desk's "Did it
    // arrive" page like every other send. A test send nobody can see the fate
    // of is the same blind spot this whole session is about.
    await recordAccepted(r.clone(), to, "whatsapp", { kind: "section menu test" });
    const text = await r.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch (_) { /* keep raw */ }
    return json({ sid, sentTo: `+${to}`, ok: r.ok, status: r.status, twilio: parsed });
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
