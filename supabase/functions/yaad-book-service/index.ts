import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

// The book-a-service form on yaadly.co.uk/services posts here (2 Sep 2026,
// founder's own change: "should also be able to book directly on the web").
//
// What this creates is a HELD booking, nothing else: the same state a
// converted enquiry lands in. No card is charged, no price is committed to
// the client, and nothing starts until a named admin clicks "Confirm the
// work" in the desk. The founder's bandwidth worry about a public door is
// answered by that held state, not by keeping the door shut.
//
// The price on the row comes from service_catalogue, never from the page
// and never from the caller: a browser can only ever say WHICH service, by
// key. The founding-rate figures printed on the marketing page are not in
// the catalogue; the label the visitor clicked is recorded in notes so the
// admin sees exactly what they were shown before raising any invoice.
//
// No email is sent from here. The insert itself fires
// trg_notify_service_change -> yaad-notify-client (kind service_booked),
// which already sends the WhatsApp-first receipt with the portal code and
// the join link. One message path, not two.
//
// verify_jwt is off, same reasoning as yaad-enquiry: a visitor has no
// session. What stands in: field validation, a service-role write the
// browser cannot make itself, and a throttle (booking_attempts, hashed
// caller key, swept here).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Page key -> catalogue id. An allowlist, not a passthrough: the page can
// only name services the catalogue actually sells. Full Project Management
// has no catalogue row yet, so it is not bookable here on purpose.
const BOOKABLE: Record<string, string> = {
  deposit: "deposit-check",
  visual: "eyes-on-it",
  condition: "condition-report",
  signoff: "technical-signoff",
  retainer: "retainer",
  "retainer-ground": "retainer-ground",
  care: "care-standard",
  "care-large": "care-large",
  "care-villa": "care-villa",
};

const PER_CALLER_PER_DAY = 3;
const BOOKINGS_PER_DAY = 20;

const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(v);

async function callerKey(req: Request): Promise<string> {
  const raw = req.headers.get("cf-connecting-ip")
           ?? (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim()
           ?? "";
  const bytes = new TextEncoder().encode("yaadly-booking:" + raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-book-service", req);
  const root = trace.startSpan(`${req.method} /yaad-book-service`, SpanKind.SERVER, httpAttrs(req));
  const json = (b: unknown, status = 200) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end();
    trace.flush();
    return new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  };

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Not configured." }, 500);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { /* falls into validation */ }

  const s = (v: unknown, cap: number) => String(v ?? "").trim().slice(0, cap);
  const serviceKey = s(body.service, 40);
  const label = s(body.label, 120);
  const name = s(body.name, 120);
  const email = s(body.email, 200).toLowerCase();
  const phone = s(body.phone, 40);
  const parish = s(body.parish, 80);
  const message = s(body.message, 2000);

  const catalogueId = BOOKABLE[serviceKey];
  if (!catalogueId) {
    return json({ error: "Pick one of the services on this page." }, 400);
  }
  if (!name || (!email && !phone)) {
    return json({ error: "We need your name and an email or WhatsApp number to hold the booking against." }, 400);
  }
  if (email && !looksLikeEmail(email)) {
    return json({ error: "That email address does not look sendable. Check it, or give a WhatsApp number instead." }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── throttle, counted before anything is written ────────────────────────
  const key = await callerKey(req);
  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  const { count: mine } = await admin.from("booking_attempts")
    .select("*", { count: "exact", head: true })
    .eq("caller_key", key).gt("created_at", dayAgo);
  if ((mine ?? 0) >= PER_CALLER_PER_DAY) {
    root.setAttributes({ "yaadly.booking.outcome": "throttled_caller" });
    return json({ error: "That is a few bookings from one place in a day. If they are all real, message us instead and a person will set them up." }, 429);
  }
  const { count: today } = await admin.from("booking_attempts")
    .select("*", { count: "exact", head: true })
    .gt("created_at", dayAgo);
  if ((today ?? 0) >= BOOKINGS_PER_DAY) {
    root.setAttributes({ "yaadly.booking.outcome": "throttled_global" });
    return json({ error: "Bookings are paused for a moment. Message us on WhatsApp and a person will hold one for you." }, 429);
  }

  // The price rule that holds everywhere else holds here: read from the
  // catalogue, never typed and never taken from the page.
  const { data: cat } = await admin.from("service_catalogue")
    .select("id,name,full_pence").eq("id", catalogueId).eq("active", true).maybeSingle();
  if (!cat) {
    root.setAttributes({ "yaadly.booking.outcome": "no_catalogue_row" });
    return json({ error: "That service is not bookable right now. Message us and a person will sort it." }, 400);
  }

  // Same id shape convert_enquiry_to_service uses.
  let ref = "";
  for (let i = 0; i < 5; i++) {
    const candidate = "SVC-" + Array.from(crypto.getRandomValues(new Uint8Array(3)))
      .map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    const { data: clash } = await admin.from("services").select("id").eq("id", candidate).maybeSingle();
    if (!clash) { ref = candidate; break; }
  }
  if (!ref) return json({ error: "Could not register the booking. Try again." }, 500);

  const notes = [
    `Booked on the web${label ? `: ${label}` : ""}.`,
    message ? `Client wrote: ${message}` : "",
  ].filter(Boolean).join(" ");

  // status 'held' is what makes this safe to expose publicly: the insert
  // fires the service_booked receipt, and nothing else moves until a named
  // admin confirms the work in the desk.
  const { error: insErr } = await admin.from("services").insert({
    id: ref,
    type: cat.name,
    catalogue_id: cat.id,
    client_name: name,
    client_email: email || null,
    client_phone: phone || null,
    parish: parish || null,
    price: "£" + Math.round(cat.full_pence / 100),
    stage: 0,
    status: "held",
    notes,
  });
  if (insErr) {
    console.error("yaad-book-service: insert failed:", insErr.message);
    root.setAttributes({ "yaadly.booking.outcome": "insert_failed" });
    return json({ error: "Could not register the booking. Nothing is lost on your side; message us instead." }, 500);
  }

  await admin.from("booking_attempts").insert({ caller_key: key });
  // Housekeeping: the attempts table only ever needs a day of history.
  try { await admin.from("booking_attempts").delete().lt("created_at", new Date(Date.now() - 2 * 86400_000).toISOString()); } catch (_) { /* housekeeping only */ }

  // The anonymous nudge to the founder's phone, same shape as yaad-enquiry:
  // that a booking arrived, never who or where.
  try {
    const { data: st } = await admin.from("app_settings").select("value").eq("key", "ntfy_topic").maybeSingle();
    const topic = String(st?.value ?? "").replace(/^"|"$/g, "");
    if (topic) {
      await fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        headers: { Title: "New service booking", Priority: "high" },
        body: `A ${cat.name} booking is held and waiting for your confirm.`,
      });
    }
  } catch (_) { /* the booking already exists; a missed push changes nothing */ }

  root.setAttributes({ "yaadly.booking.outcome": "held", "yaadly.booking.catalogue_id": cat.id });
  return json({ ok: true, ref, service: cat.name, emailGiven: Boolean(email), phoneGiven: Boolean(phone) });
});
