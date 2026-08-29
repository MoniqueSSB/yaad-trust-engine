import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

// The contact form at the bottom of yaadly.co.uk posts here.
//
// It used to insert into the enquiries table directly on the publishable key.
// That worked and told the person nothing: they got a green tick on a page
// they were about to close, and after that, silence. Somebody who has just
// described a problem with a house 4,000 miles away and hears nothing for a
// day cannot tell "she is asleep in London" from "that form is broken", and on
// a business they have never dealt with, the second reading wins. So the write
// moved here, where a receipt can go out in the same breath.
//
// verify_jwt is off. The visitor filling in a contact form has no session and
// never will. What stands in for authentication is the same thing that stands
// in for it on yaad-website-intake: field validation, a service-role write the
// browser cannot make itself, and a throttle.
//
// The throttle is not optional here the way it was on a plain insert. This
// endpoint sends mail to an address the caller types in, which is an open
// relay aimed at whoever they name unless something counts. Three counters:
// per caller, per recipient, and a global ceiling. The per-recipient one is
// the one that matters, because rotating source addresses is easy and being
// able to make us mail a stranger 500 times is the actual harm.
//
// Nothing here fails the enquiry because the email failed. The row is the
// thing that must survive: Monique can always reply by hand from the desk.
// The receipt is a courtesy, and its outcome is recorded on the row so she can
// see who has heard from us and who has not.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_KEY   = Deno.env.get("RESEND_API_KEY") ?? "";
// in.yaadly.co.uk, not send.yaadly.co.uk. Resend still lists the latter as
// verified but its DKIM and SPF records are gone from DNS, so mail from it
// fails authentication and lands in spam. Same reasoning as yaad-inbound and
// yaad-portal-signup, and the same address as those, on purpose: a receipt
// arriving from a fourth sending domain is a receipt that looks like a phish.
const FROM_EMAIL   = Deno.env.get("YAAD_FROM_EMAIL") ?? "jobs@in.yaadly.co.uk";
// Where a reply to the receipt should land. The receipt says "just reply to
// this", and that promise is only true if replies reach a person.
const REPLY_TO     = Deno.env.get("YAAD_REPLY_TO") ?? "monique@yaadly.co.uk";

// Per caller, per hour. Generous: a genuine person who writes twice because
// they forgot something must never meet a wall.
const PER_CALLER_PER_HOUR = 6;
// Per recipient, per day. This is the anti-amplification limit. Three receipts
// in a day to one address is already more than anyone needs.
const PER_RECIPIENT_PER_DAY = 3;
// Whole-endpoint ceiling on mail sent per hour, whoever is behind it.
const EMAILS_PER_HOUR = 60;

// Error text here never names WhatsApp or the email address. The page appends
// both, as working links, after anything this returns. Saying it in both
// places reads as a stutter and only half of it is clickable.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Deliberately loose. This decides "did they give us an address or a phone
// number", not "is this address deliverable", and only Resend can answer the
// second one. A stricter pattern here only ever means silently not sending to
// somebody whose address was fine.
const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(v);

// A throttle key, not a visitor log. Hashed, truncated, never stored raw, and
// nothing joins to it.
async function callerKey(req: Request): Promise<string> {
  const raw = req.headers.get("cf-connecting-ip")
           ?? (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim()
           ?? "";
  const bytes = new TextEncoder().encode("yaadly-enquiry:" + raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

const esc = (t: string) =>
  t.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-enquiry", req);
  const root = trace.startSpan(`${req.method} /yaad-enquiry`, SpanKind.SERVER, httpAttrs(req));
  const json = (b: unknown, status = 200) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end();
    trace.flush();
    return new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  };

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { /* falls into validation */ }

  const s = (v: unknown, cap: number) => String(v ?? "").trim().slice(0, cap);
  // The caps match the check constraint on the table. Cut here rather than let
  // Postgres reject the row: somebody who wrote a very long message should get
  // their enquiry through with the tail trimmed, not a failure.
  const name    = s(body.name, 120);
  const contact = s(body.contact, 200);
  const topic   = s(body.topic, 120);
  const message = s(body.message, 4000);

  if (!name || !contact || !message) {
    root.setAttributes({ "yaadly.enquiry.outcome": "validation_failed" });
    return json({ error: "We need your name, a way to reach you, and what you want to ask." }, 400);
  }

  const email = looksLikeEmail(contact) ? contact.toLowerCase() : "";
  root.setAttributes({ "yaadly.enquiry.has_email": Boolean(email) });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── throttle, counted before anything is written or sent ────────────────
  const key = await callerKey(req);
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const dayAgo  = new Date(Date.now() - 86400_000).toISOString();

  const { count: mine } = await admin.from("enquiry_attempts")
    .select("id", { count: "exact", head: true })
    .eq("caller_key", key).gt("created_at", hourAgo);
  if ((mine ?? 0) >= PER_CALLER_PER_HOUR) {
    root.setAttributes({ "yaadly.enquiry.throttled": "caller" });
    return json({ error: "That is a lot of messages in one hour. Give it a little while." }, 429);
  }

  // Anti-amplification. Counted against the enquiries table rather than the
  // attempts table on purpose: attempts get swept after two hours and this
  // limit has to hold for a day.
  let recipientBudgetLeft = true;
  if (email) {
    const { count: theirs } = await admin.from("enquiries")
      .select("id", { count: "exact", head: true })
      .eq("contact", email).gt("created_at", dayAgo);
    recipientBudgetLeft = (theirs ?? 0) < PER_RECIPIENT_PER_DAY;
  }

  const { count: sentThisHour } = await admin.from("enquiry_attempts")
    .select("id", { count: "exact", head: true })
    .eq("emailed", true).gt("created_at", hourAgo);
  const globalBudgetLeft = (sentThisHour ?? 0) < EMAILS_PER_HOUR;

  // Whether we will try to send at all. The enquiry is written either way: a
  // throttle protects the mail path, it does not get to lose somebody's
  // question.
  const willEmail = Boolean(email) && recipientBudgetLeft && globalBudgetLeft;
  const receipt = !email ? "no_email" : willEmail ? "sent" : "throttled";

  // ── write the enquiry ───────────────────────────────────────────────────
  const { data: row, error: insertErr } = await trace.span("db.insert enquiries", SpanKind.CLIENT, {
    "db.system.name": "postgresql",
    "db.operation.name": "INSERT",
    "db.collection.name": "enquiries",
  }, async (sp) => {
    const r = await admin.from("enquiries").insert({
      name,
      contact: email || contact,
      topic: topic || null,
      message,
      // Optimistic, and corrected below if the send fails. Written now so an
      // enquiry is never sitting on the desk with an empty receipt column
      // purely because the function died between the insert and the send.
      receipt,
      receipt_at: willEmail ? new Date().toISOString() : null,
    }).select("id").single();
    if (r.error) sp.recordError(r.error.message);
    return { data: r.data, error: r.error };
  });

  if (insertErr) {
    root.setAttributes({ "yaadly.enquiry.outcome": "insert_failed" });
    return json({ error: "That did not send. Nothing is lost on your side." }, 500);
  }

  root.setAttributes({ "yaadly.enquiry.outcome": "recorded" });

  // ── the receipt ─────────────────────────────────────────────────────────
  let emailed = false;
  if (willEmail && !RESEND_KEY) {
    root.recordError("RESEND_API_KEY is not set on this project, enquiry receipt not sent");
  } else if (willEmail) {
    const when = new Date().toUTCString();
    const text =
`Thank you, ${name}. Your message reached Yaadly.

You asked about: ${topic || "not said"}
Sent: ${when}

What you wrote
--------------
${message}

Monique reads these herself and comes back within 24 hours, usually sooner.
Nothing is charged and nothing is booked by sending this.

If it is urgent, WhatsApp is faster: https://wa.me/447878877567

You can reply straight to this email and it reaches her.

Yaadly Ltd, England and Wales, no. 17358077
You are getting this because somebody used the contact form on yaadly.co.uk
with this address. If that was not you, ignore it. Nothing else happens.`;

    const html =
`<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#0b1a16;max-width:600px">
<p style="margin:0 0 18px">Thank you, ${esc(name)}. <b>Your message reached us.</b></p>
<p style="margin:0 0 18px">Monique reads these herself and comes back within 24 hours, usually sooner. Nothing is charged and nothing is booked by sending it.</p>
<div style="margin:0 0 20px;padding:14px 16px;border-radius:12px;background:#f2f7f5;border:1px solid #dbe7e3">
  <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#67807a">What you sent us</p>
  <p style="margin:0 0 10px;font-size:13.5px;color:#67807a">About: ${esc(topic || "not said")}<br>Sent: ${esc(when)}</p>
  <p style="margin:0;white-space:pre-wrap">${esc(message)}</p>
</div>
<p style="margin:0 0 18px">If it is urgent, <a href="https://wa.me/447878877567" style="color:#0d8c7f">WhatsApp is faster</a>. Otherwise just reply to this email and it reaches her.</p>
<p style="margin:0;font-size:12.5px;color:#67807a">Yaadly Ltd, England and Wales, no. 17358077.<br>You are getting this because somebody used the contact form on yaadly.co.uk with this address. If that was not you, ignore it. Nothing else happens.</p>
</div>`;

    await trace.span("resend.send enquiry receipt", SpanKind.CLIENT, {
      "server.address": "api.resend.com",
      "messaging.system": "resend",
      "messaging.operation.name": "send",
    }, async (sp) => {
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: `Yaadly <${FROM_EMAIL}>`,
            to: [email],
            reply_to: REPLY_TO,
            subject: "We have your message, and here is what you sent",
            text,
            html,
          }),
          signal: AbortSignal.timeout(15000),
        });
        sp.setAttributes({ "http.response.status_code": r.status });
        emailed = r.ok;
        if (!r.ok) sp.recordError(`resend send ${r.status}: ${(await r.text()).slice(0, 160)}`);
      } catch (e) {
        sp.recordError(String(e).slice(0, 200));
      }
    });

    // Correct the optimistic row. An enquiry marked sent that never sent is
    // worse than one marked failed: it is the difference between Monique
    // knowing to chase and Monique thinking it is handled.
    if (!emailed && row?.id) {
      await admin.from("enquiries").update({ receipt: "failed", receipt_at: null }).eq("id", row.id);
    }
  }

  // What actually happened, as opposed to what we hoped would. The page words
  // its confirmation off this and not off `emailed` alone: "no email" and
  // "held back by the rate limit" are both "no receipt sent" and telling
  // somebody who typed an address that we only have their phone number is a
  // plain lie to their face.
  const outcome = !email ? "no_email" : emailed ? "sent" : willEmail ? "failed" : "throttled";

  root.setAttributes({ "yaadly.enquiry.receipt_emailed": emailed, "yaadly.enquiry.receipt": outcome });

  // ── count it, tell Monique, both after the fact ─────────────────────────
  const after = (async () => {
    try {
      await admin.from("enquiry_attempts").insert({ caller_key: key, emailed });
      // Housekeeping on a fraction of requests, same as the post-job sweep.
      if (Math.random() < 0.05) {
        try { await admin.rpc("enquiry_attempts_sweep"); } catch (_) { /* housekeeping only */ }
      }
      // The site promises a reply within 24 hours, so something has to say an
      // enquiry landed. No name, no address, no number leaves for the relay:
      // only the topic, which is a menu choice, and whether they can be
      // emailed back.
      const { data: st } = await admin.from("app_settings").select("value").eq("key", "ntfy_topic").single();
      if (!st?.value) return;
      await fetch(`https://ntfy.sh/${st.value}`, {
        method: "POST",
        headers: { Title: "New Yaadly enquiry", Priority: "default", Tags: "envelope" },
        body: `${topic || "A question"}. ${email ? "Receipt sent, reply by email." : "No email given, reply on WhatsApp."} Promised within 24 hours.`,
        signal: AbortSignal.timeout(4000),
      });
    } catch (_) { /* never let telemetry or notification break an enquiry */ }
  })();
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(after);

  return json({ ok: true, emailed, receipt: outcome, email: emailed ? email : null });
});
