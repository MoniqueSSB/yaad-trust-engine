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
//
// Two things go out, not one. The receipt goes to the person who wrote in, and
// a copy of what they wrote goes to the desk address in app_settings. The push
// notification alone was not enough: it is deliberately anonymous, so it says
// a question arrived and nothing about who asked or what they need, and the
// enquiry itself then lived only in a table nobody opens at eight in the
// evening. The site promises an answer within 24 hours. A promise that depends
// on somebody remembering to go and look is not a promise.

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

// The WhatsApp receipt, for somebody who left a phone number rather than an
// email. Dark until the template exists, exactly like yaad-daily-checkin, and
// for the same reason: a business-initiated WhatsApp message needs a Meta
// approved Content Template, and submitting one is a Twilio console action
// that no migration can perform. Until the secret is set nothing is sent and
// the row says wa_invited, which is true, rather than pretending.
//
// The template's body should carry one variable, the person's name, and read
// as a receipt and not as marketing, or Meta will refuse the category:
//   "Thanks {{1}}, your enquiry reached Yaadly. Monique replies within one
//    working day. You can reply here any time."
const WA_RECEIPT_SID = Deno.env.get("TWILIO_CONTENT_SID_ENQUIRY_RECEIPT") ?? "";
const TWILIO_SID     = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_TOKEN   = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM    = Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "";

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
  // "no_email" was the honest name for a hole and a bad name for a state: it
  // read on the desk as a failure, when what it actually means is "they left a
  // phone number, so no receipt could be emailed and none was". Two better
  // outcomes now exist for that case.
  //
  //   wa_receipt  a Meta approved template went out from the Yaadly number.
  //               Only possible where TWILIO_CONTENT_SID_ENQUIRY_RECEIPT is
  //               set: free text to somebody who has never written to us is
  //               refused, which is the same wall the daily check-in hit.
  //   wa_invited  no template exists, so nothing was sent, and the page
  //               instead offered them one tap into WhatsApp. If they take it
  //               they open the 24 hour window themselves and a person can
  //               answer freely from then on, with no template and no cost.
  //               That is the route that works today.
  const phone = !email ? contact.replace(/\D/g, "") : "";
  const canTemplate = Boolean(WA_RECEIPT_SID && TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM && phone.length >= 7);
  const receipt = email
    ? (willEmail ? "sent" : "throttled")
    : canTemplate ? "wa_receipt"
    : phone.length >= 7 ? "wa_invited"
    : "no_contact";

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

  // ── the WhatsApp receipt, where they left a phone ───────────────────────
  //
  // Runs only when a Meta approved template exists. Same anti-amplification
  // reasoning as the email receipt above and the throttle it lives behind:
  // this form is open to the internet, so anything it can send to a stranger's
  // number is something a stranger can make it send. The throttle is what
  // makes this safe, not the template.
  //
  // Failure is swallowed on purpose. The enquiry is already recorded and
  // already on the desk. A receipt that does not arrive is a courtesy missed,
  // not a message lost, and it must never turn into an error for the person
  // who just wrote in.
  if (canTemplate) {
    try {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: `whatsapp:+${phone}`,
          From: TWILIO_FROM,
          ContentSid: WA_RECEIPT_SID,
          ContentVariables: JSON.stringify({ "1": name }),
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) console.error("enquiry whatsapp receipt", r.status, (await r.text()).slice(0, 200));
    } catch (e) {
      console.error("enquiry whatsapp receipt threw", String(e).slice(0, 200));
    }
  }

  // ── the receipt ─────────────────────────────────────────────────────────
  let emailed = false;
  const when = new Date().toUTCString();
  if (willEmail && !RESEND_KEY) {
    root.recordError("RESEND_API_KEY is not set on this project, enquiry receipt not sent");
  } else if (willEmail) {
    const text =
`Thank you, ${name}. Your message reached Yaadly.

You asked about: ${topic || "not said"}
Sent: ${when}

What you wrote
--------------
${message}

Every one of these is read by a person at Yaadly, and answered within 24 hours, usually sooner.
Nothing is charged and nothing is booked by sending this.

If it is urgent, WhatsApp is faster: https://wa.me/447878877567

You can reply straight to this email and it reaches her.

Yaadly Ltd, England and Wales, no. 17358077
You are getting this because somebody used the contact form on yaadly.co.uk
with this address. If that was not you, ignore it. Nothing else happens.`;

    const html =
`<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#0b1a16;max-width:600px">
<p style="margin:0 0 18px">Thank you, ${esc(name)}. <b>Your message reached us.</b></p>
<p style="margin:0 0 18px">Every one of these is read by a person at Yaadly, and answered within 24 hours, usually sooner. Nothing is charged and nothing is booked by sending it.</p>
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
    } catch (_) { /* a missed counter must never break an enquiry */ }

    // Read once, use twice. The push and the desk copy are independent of each
    // other on purpose: before this, the push was fetched first and returned
    // early when no topic was configured, which would have taken the email
    // with it.
    let cfg: Record<string, string> = {};
    try {
      const { data: rows } = await admin.from("app_settings")
        .select("key,value").in("key", ["ntfy_topic", "admin_email"]);
      // Some values in this table were written as JSON and carry their quotes
      // (desk_url is one). Strip a single surrounding pair rather than trust
      // every writer to have been consistent.
      cfg = Object.fromEntries((rows ?? []).map((r) =>
        [r.key, String(r.value ?? "").trim().replace(/^"(.*)"$/, "$1")]));
    } catch (_) { /* both notifications degrade to nothing, the row still stands */ }

    // The push: a nudge on a phone, not the enquiry. No name, no address, no
    // number leaves for the relay: only the topic, which is a menu choice, and
    // whether they can be emailed back.
    if (cfg.ntfy_topic) {
      try {
        await fetch(`https://ntfy.sh/${cfg.ntfy_topic}`, {
          method: "POST",
          headers: { Title: "New Yaadly enquiry", Priority: "default", Tags: "envelope" },
          body: `${topic || "A question"}. ${email ? "Receipt sent, reply by email." : "No email given, reply on WhatsApp."} Promised within 24 hours.`,
          signal: AbortSignal.timeout(4000),
        });
      } catch (_) { /* a nudge that did not arrive is not worth a failed request */ }
    }

    // The desk copy: everything, to the address she actually reads. Unlike the
    // job summaries out of yaad-inbound, this one does carry Reply-To, because
    // an enquiry has no thread in the desk to be pulled out of. The receipt
    // told the person "just reply to this email", so replying is the channel,
    // and hitting reply here has to land on them rather than on the relay.
    if (cfg.admin_email && RESEND_KEY) {
      const heard = !email
        ? "No email address given, so they have heard nothing. Reply on WhatsApp."
        : emailed
        ? "A receipt has gone to them, so they know it arrived."
        : "The receipt did not send. As far as they know, nothing arrived.";

      const text =
`${name} sent an enquiry through yaadly.co.uk.

Reach them: ${contact}
About: ${topic || "not said"}
Sent: ${when}

${message}

--
${heard}
Answer within 24 hours, that is what the page promises.`;

      // HOW TO ANSWER THIS ONE, in the email itself.
      //
      // Where they left an address, Reply-To is set and the mail app already
      // does the right thing. Where they left a PHONE, this email used to
      // arrive with no Reply-To at all: it landed in the inbox and could not
      // be answered from the inbox, and there is no automatic receipt to them
      // either, so they had heard nothing from anybody. Found live on 4 Sep
      // 2026 with a real person waiting on an urgent roof.
      //
      // A wa.me link is not automation and is not pretending to be. It is one
      // tap from the phone she reads mail on, and it opens WhatsApp with the
      // message already written. Deliberately NOT a send from the Yaadly
      // number: that is business-initiated, so it needs a Meta approved
      // template that does not exist, and SMS needs a TWILIO_SMS_FROM that is
      // not set. Both are decisions with a cost attached. This needs neither
      // and works today.
      const digits = email ? "" : contact.replace(/\D/g, "");
      const waText = encodeURIComponent(
        `Hello ${name}, this is Yaadly. Thank you for your enquiry, we are picking it up now.`,
      );
      const answerBlock = email
        ? `<p style="margin:0 0 18px;font-size:13px;color:#67807a">Reply to this email and it goes straight to them.</p>`
        : digits.length >= 7
          ? `<p style="margin:0 0 18px"><a href="https://wa.me/${digits}?text=${waText}" style="background:#14b8a6;color:#04211d;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:100px;display:inline-block">Answer on WhatsApp</a><br><span style="font-size:12.5px;color:#67807a">They left a phone number, not an email, so replying to this message reaches nobody and no automatic receipt could be sent to them. They have heard nothing at all. This opens WhatsApp with a first line ready.</span></p>`
          : `<p style="margin:0 0 18px;font-size:13px;color:#b3261e">They left no usable way to reach them. Nothing can be sent, and nothing was.</p>`;

      const html =
`<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#0b1a16;max-width:600px">
<p style="margin:0 0 14px"><b>${esc(name)}</b> sent an enquiry through yaadly.co.uk.</p>
<table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">
<tr><td style="padding:4px 14px 4px 0;color:#67807a;white-space:nowrap">Reach them</td><td style="padding:4px 0">${esc(contact)}</td></tr>
<tr><td style="padding:4px 14px 4px 0;color:#67807a;white-space:nowrap">About</td><td style="padding:4px 0">${esc(topic || "not said")}</td></tr>
<tr><td style="padding:4px 14px 4px 0;color:#67807a;white-space:nowrap">Sent</td><td style="padding:4px 0">${esc(when)}</td></tr>
</table>
<div style="margin:0 0 18px;padding:14px 16px;border-radius:12px;background:#f2f7f5;border:1px solid #dbe7e3;white-space:pre-wrap">${esc(message)}</div>
${answerBlock}
<p style="margin:0;font-size:12.5px;color:#67807a">${esc(heard)}<br>Answer within 24 hours, that is what the page promises.</p>
</div>`;

      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: `Yaadly <${FROM_EMAIL}>`,
            to: [cfg.admin_email],
            // Only when they gave an address. Reply-To pointing at a phone
            // number is a bounce waiting to happen.
            ...(email ? { reply_to: email } : {}),
            subject: `New enquiry from ${name}, ${topic || "no topic given"}`,
            text,
            html,
          }),
          signal: AbortSignal.timeout(15000),
        });
        // console, not the trace. Everything in here runs after the response
        // has gone and the trace has already been flushed, so a span recorded
        // now is a span nobody ever sees. Worth saying loudly somewhere: if
        // these stop arriving, the 24 hour promise is being missed and nothing
        // else in the system says so.
        if (!r.ok) console.error("enquiry desk copy", r.status, (await r.text()).slice(0, 200));
      } catch (e) {
        console.error("enquiry desk copy failed:", String(e).slice(0, 200));
      }
    } else if (!cfg.admin_email) {
      console.error("app_settings.admin_email is not set, enquiry desk copy not sent");
    } else {
      console.error("RESEND_API_KEY is not set, enquiry desk copy not sent");
    }
  })();
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(after);

  return json({ ok: true, emailed, receipt: outcome, email: emailed ? email : null });
});
