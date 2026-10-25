/* ── yaad-portal-code ──────────────────────────────────────────────────────
 *
 * Sends a six digit sign in code, so nobody has to invent and remember a
 * password to look at their own job.
 *
 * WHY. The audience is diaspora clients, often older, often on a phone in
 * another country, who have already explained the whole job once. "Choose a
 * password, at least 8 characters" is where those people stop. It also buys
 * nothing here: the job code was always the real gate, and a password is a
 * second secret to lose on top of it.
 *
 * HOW, and the reason this is not Supabase's own magic link. generateLink
 * returns BOTH a link and a six digit email_otp for the same token. We take
 * the code and deliver it ourselves, which means:
 *   - the client types six digits rather than opening a link, and a link
 *     opened in a different browser than the one they started in is the
 *     classic way magic links strand somebody
 *   - it can go over WhatsApp or SMS as easily as email, through Twilio,
 *     for the client who has an email on file but does not read it
 *
 * That second line used to say this "matters when half this audience gave a
 * phone number and no email." It was wrong, and wrong in the direction that
 * made the phone channel look load bearing. This function REQUIRES a valid
 * email address and returns 400 without one (see the check below), because
 * the code comes from generateLink and generateLink is keyed on an email.
 * There is no such thing as a portal user without one. Email is the rail;
 * WhatsApp is a second copy of the same code for somebody who will see it
 * sooner. Corrected 4 Sep 2026.
 *   - GoTrue's own email templates are left alone
 *
 * Verifying happens in the browser against Supabase, not here. This function
 * never sees the code come back, never mints a session, and holds no logic
 * about who is signed in. It issues and delivers, and that is all.
 *
 * THE GATE IS UNCHANGED. A client still has to present a job code, and it is
 * still pend_portal_code in Postgres that rules on it, rate limited on both
 * the email and the code. This is a different way to prove a mailbox, not a
 * different way to get in.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { httpAttrs, SpanKind, Trace } from "./otel.ts";
import { e164Digits } from "./e164.ts";
import { recordAccepted, type SendMeta, withStatusCallback } from "./twilio-status.ts";
import { LIMITS, phoneCode, phoneCodeLine, phoneDigits, PHONE_SAME_ANSWER, PHONE_WRONG_CODE, pickEmail } from "./phone-sign-in.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("YAAD_FROM_EMAIL") ?? "jobs@in.yaadly.co.uk";
const REPLY_TO = Deno.env.get("YAAD_REPLY_TO") ?? "monique@yaadly.co.uk";
// Public by design. Used only to check a code the person typed, exactly as
// the browser would, so the session that comes back is theirs, not ours.
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

/** A throttle key, not a log. Hashed, truncated, never stored raw, and
 *  nothing joins to it. Same recipe as yaad-apply-link. */
async function hashKey(prefix: string, raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(prefix + raw));
  return Array.from(new Uint8Array(digest)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ── signing in by WhatsApp, 25 Oct 2026 ────────────────────────────────
 *
 * Founder: "make it so people can sign in through whatsapp or email",
 * "workers and clients". The person types a phone number instead of an
 * email. Two steps, both through this function:
 *
 *   {phone}        find the ONE account that number belongs to (a live
 *                  worker profile, or a client job whose email already has
 *                  an account), make that account's code, and send it to the
 *                  number on WhatsApp and to the email. The browser is told
 *                  the same sentence whatever happened, and the lookup runs
 *                  after the answer has gone.
 *   {phone, code}  find the same account, check the code with Supabase the
 *                  way the browser would, and return the session only if
 *                  Supabase accepted it.
 *
 * Why the check happens here and not in the browser: a code is checked
 * against an email, and the person who typed a phone number must not be
 * told which email it belongs to before they have proved they hold the
 * WhatsApp number. So this function, which knows the email, asks Supabase,
 * and hands back nothing but the session Supabase issued. It still never
 * mints a session itself: Supabase does, on a correct code.
 *
 * What does not move: a phone number never opens a new client account (the
 * job code gate on /portal/join is untouched), and a number behind more than
 * one account is refused rather than guessed. */
// deno-lint-ignore no-explicit-any
async function emailForPhone(admin: any, digits: string): Promise<{ email: string; source: "worker" | "client" } | null> {
  const { data: rows } = await admin.rpc("sign_in_candidates_for_phone", { p_tail: digits.slice(-9) });
  const candidates = (rows ?? []) as { email: string | null; phone: string | null; source: string | null }[];
  const accounts = new Map<string, boolean>();
  for (const c of candidates) {
    const e = String(c.email ?? "").trim().toLowerCase();
    if (c.source === "client" && e && !accounts.has(e)) {
      const { data: has } = await admin.rpc("email_has_account", { p_email: e });
      accounts.set(e, has === true);
    }
  }
  return pickEmail(digits, candidates, (e) => accounts.get(e) === true);
}

// deno-lint-ignore no-explicit-any
async function sendPhoneCode(admin: any, digits: string, req: Request): Promise<void> {
  const trace = new Trace("yaad-portal-code", req);
  const s = trace.startSpan("phone_code.send", SpanKind.INTERNAL, {});
  try {
    const who = await emailForPhone(admin, digits);
    if (!who) {
      s.setAttributes({ "yaadly.phone_code.outcome": "no_single_account" });
      return;
    }
    // A worker with a live profile may not have opened their account yet.
    // The email path opens it the same way (admin create, no password).
    const { data: has } = await admin.rpc("email_has_account", { p_email: who.email });
    if (has !== true && who.source === "worker") {
      const { error: createErr } = await admin.auth.admin.createUser({ email: who.email, email_confirm: false });
      if (createErr && !/already|registered|exists/i.test(String(createErr.message))) {
        s.recordError(createErr.message);
        return;
      }
    }
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: who.email });
    if (linkErr || !link?.properties?.email_otp) {
      s.recordError(linkErr?.message ?? "no email_otp returned");
      return;
    }
    const otp = String(link.properties.email_otp);
    const line = phoneCodeLine(otp);
    // WhatsApp first, on the number they typed (which is the number on file).
    let wa = await sendVerify(digits, otp, "whatsapp", trace);
    if (!wa.sent) wa = await sendTwilio(digits, line, "whatsapp", trace);
    if (!wa.sent) {
      const sms = await sendTwilio(digits, line, "sms", trace);
      if (sms.sent) wa = sms;
    }
    // And the email, which reaches them outside WhatsApp's 24 hour window.
    let emailed = false;
    if (RESEND_KEY) {
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: `Yaadly <${FROM_EMAIL}>`, to: [who.email], reply_to: REPLY_TO, subject: `${otp} is your Yaadly sign in code`, text: line }),
          signal: AbortSignal.timeout(15000),
        });
        emailed = r.ok;
      } catch (_) { emailed = false; }
    }
    s.setAttributes({ "yaadly.phone_code.outcome": wa.sent || emailed ? "sent" : "nowhere", "yaadly.phone_code.whatsapp": wa.sent, "yaadly.phone_code.emailed": emailed, "yaadly.phone_code.source": who.source });
    if (!wa.sent && !emailed) console.error("yaad-portal-code: phone code reached nobody", wa.reason ?? "");
  } catch (e) {
    s.recordError(e);
  } finally {
    s.end();
    trace.flush();
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/* Twilio Verify, the supported rail for a one time code.
 *
 * WHY THIS EXISTS AT ALL. A sign in code is an AUTHENTICATION message in
 * WhatsApp's own categories. Free text carries it fine inside the 24 hour
 * customer service window and not at all outside it, and the tempting fix,
 * pushing an OTP through one of our own UTILITY templates, is the thing
 * that gets a sender flagged. A flagged sender takes every other message
 * this business sends down with it. Verify uses Meta's own pre-defined
 * authentication templates instead, so there is no template here for
 * anybody to write, submit, or get wrong.
 *
 * WHAT IT DOES NOT CHANGE, which is the important half. Supabase still
 * mints the code (generateLink's email_otp) and the browser still verifies
 * it against Supabase. Verify is used purely as a DELIVERY rail, by handing
 * it our own code as CustomCode, so nothing about who owns the session
 * moves. We deliberately never call Verify's own VerificationCheck: this
 * function issues and delivers and holds no logic about who is signed in,
 * exactly as its header says, and routing the check through Twilio would
 * quietly make that untrue.
 *
 * Unset TWILIO_VERIFY_SERVICE_SID means every line below is skipped and the
 * free text path behaves exactly as it did before this was added. */
async function sendVerify(
  to: string, code: string, channel: "whatsapp" | "sms", trace: Trace,
) {
  const service = Deno.env.get("TWILIO_VERIFY_SERVICE_SID") ?? "";
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const tok = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  if (!service) return { sent: false, reason: "TWILIO_VERIFY_SERVICE_SID not set" };
  if (!sid || !tok) return { sent: false, reason: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set" };
  // Verify wants E.164 and nothing else. The free text path is more
  // forgiving because Twilio's Messages API is; this one is not.
  const digits = e164Digits(to);
  if (digits.length < 7) return { sent: false, reason: "number not usable" };
  return await trace.span("twilio.verify.start", SpanKind.CLIENT, {
    "server.address": "verify.twilio.com", "messaging.system": "twilio",
    "yaadly.verify.channel": channel,
  }, async (s) => {
    try {
      const r = await fetch(`https://verify.twilio.com/v2/Services/${service}/Verifications`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + btoa(`${sid}:${tok}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        // CustomCode is what makes this a delivery rail rather than a second
        // source of truth: Twilio sends OUR code, the one Supabase will
        // actually accept back. Four to ten characters; a Supabase email_otp
        // is six digits and fits.
        body: new URLSearchParams({ To: `+${digits}`, Channel: channel, CustomCode: code }),
        signal: AbortSignal.timeout(15000),
      });
      s.setAttributes({ "http.response.status_code": r.status });
      if (r.ok) return { sent: true, via: `twilio verify ${channel}` };
      // Named, never swallowed, same reason as the Resend failure below: a
      // sign in code that went nowhere is somebody locked out of their own
      // job, and the desk needs the real reason to answer them.
      const reason = `verify ${r.status}: ${(await r.text()).slice(0, 140)}`;
      s.recordError(reason);
      return { sent: false, reason };
    } catch (e) {
      const reason = String(e).slice(0, 160);
      s.recordError(reason);
      return { sent: false, reason };
    }
  });
}

/* Twilio, same shape as yaad-quote-landed. Two copies rather than a shared
   module because sync-shared.sh copies one file into every function and a
   third caller is the point at which that earns its keep. */
async function sendTwilio(
  to: string, body: string, channel: "whatsapp" | "sms", trace: Trace,
) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const tok = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  const from = channel === "whatsapp"
    ? (Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "")
    : (Deno.env.get("TWILIO_SMS_FROM") ?? "");
  if (!sid || !tok) return { sent: false, reason: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set" };
  if (!from) return { sent: false, reason: `TWILIO_${channel === "whatsapp" ? "WHATSAPP" : "SMS"}_FROM not set` };

  const digits = e164Digits(to);
  if (digits.length < 7) return { sent: false, reason: "number not usable" };
  const dest = channel === "whatsapp" ? `whatsapp:+${digits}` : `+${digits}`;

  return await trace.span(`twilio.send.${channel}`, SpanKind.CLIENT, {
    "server.address": "api.twilio.com", "messaging.system": "twilio",
  }, async (s) => {
    try {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + btoa(`${sid}:${tok}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: withStatusCallback(new URLSearchParams({ To: dest, From: from, Body: body })),
        signal: AbortSignal.timeout(15000),
      });
      s.setAttributes({ "http.response.status_code": r.status });
      await recordAccepted(r, digits, channel, { kind: "sign-in code" });
      if (r.ok) return { sent: true, via: `twilio ${channel}` };
      const d = await r.json().catch(() => null) as { code?: number; message?: string } | null;
      const reason = d?.code === 63016
        ? "outside WhatsApp's 24 hour window, needed an approved template"
        : `twilio ${r.status}${d?.code ? ` (${d.code})` : ""}`;
      s.recordError(reason);
      return { sent: false, reason };
    } catch (e) {
      s.recordError(String(e).slice(0, 200));
      return { sent: false, reason: String(e).slice(0, 160) };
    }
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-portal-code", req);
  const root = trace.startSpan(`${req.method} /yaad-portal-code`, SpanKind.SERVER, httpAttrs(req));
  const json = (b: unknown, status = 200) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end();
    trace.flush();
    return new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  };

  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  try {
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;

    // ── sign in by WhatsApp: a phone number and no email ──────────────────
    if (String(b.phone ?? "").trim() && !String(b.email ?? "").trim()) {
      const digits = phoneDigits(b.phone);
      if (!digits) {
        return json({ error: "That does not look like a full phone number. Put the country code in front: +1 876 for Jamaica, +44 for the UK." }, 400);
      }
      const code = String(b.code ?? "").trim() ? phoneCode(b.code) : null;
      if (String(b.code ?? "").trim() && !code) return json({ error: "A sign in code is six digits." }, 400);
      const kind: "send" | "verify" = code ? "verify" : "send";
      const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

      const ip = req.headers.get("cf-connecting-ip") ?? (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
      const phoneKey = await hashKey("yaadly-phone-sign-in:", digits);
      const callerKey = await hashKey("yaadly-phone-caller:", ip);
      const hourAgo = new Date(Date.now() - 3600_000).toISOString();
      const [{ count: byPhone }, { count: byCaller }] = await Promise.all([
        admin.from("phone_sign_in_attempts").select("id", { count: "exact", head: true }).eq("phone_key", phoneKey).eq("kind", kind).gt("created_at", hourAgo),
        admin.from("phone_sign_in_attempts").select("id", { count: "exact", head: true }).eq("caller_key", callerKey).eq("kind", kind).gt("created_at", hourAgo),
      ]);
      if ((byPhone ?? 0) >= LIMITS[kind].phone || (byCaller ?? 0) >= LIMITS[kind].caller) {
        root.setAttributes({ "yaadly.phone_code.throttled": kind });
        return json({ error: "That is too many tries in an hour. Wait a while, then try again, or sign in with your email." }, 429);
      }
      await admin.from("phone_sign_in_attempts").insert({ phone_key: phoneKey, caller_key: callerKey, kind });

      if (kind === "send") {
        const after = (async () => {
          await sendPhoneCode(admin, digits, req);
          try { await admin.rpc("phone_sign_in_attempts_sweep"); } catch (_) { /* housekeeping only */ }
        })();
        const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
        if (rt?.waitUntil) rt.waitUntil(after); else await after;
        root.setAttributes({ "yaadly.code.outcome": "phone_send_queued" });
        return json({ ok: true, message: PHONE_SAME_ANSWER });
      }

      // Checking a code. Supabase decides; this only asks on their behalf.
      const who = await emailForPhone(admin, digits);
      if (!who || !ANON_KEY) {
        root.setAttributes({ "yaadly.code.outcome": "phone_verify_refused" });
        return json({ error: PHONE_WRONG_CODE }, 400);
      }
      const asker = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
      for (const type of ["email", "magiclink"] as const) {
        const { data, error } = await asker.auth.verifyOtp({ email: who.email, token: code!, type });
        if (!error && data?.session) {
          root.setAttributes({ "yaadly.code.outcome": "phone_verified", "yaadly.phone_code.source": who.source });
          return json({ ok: true, session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } });
        }
      }
      root.setAttributes({ "yaadly.code.outcome": "phone_code_rejected" });
      return json({ error: PHONE_WRONG_CODE }, 400);
    }

    const email = String(b.email ?? "").trim().toLowerCase();
    const code = String(b.code ?? "").trim().toUpperCase();
    const role = String(b.role ?? "client") === "worker" ? "worker" : "client";

    if (!/^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(email)) {
      return json({ error: "That does not look like an email address." }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: existing } = await admin.rpc("email_has_account", { p_email: email });
    const isNew = existing !== true;

    /* A NEW account still has to present a job code, and pend_portal_code is
       still what rules on it. Somebody who already has an account is asking
       to sign in, and asking a returning client for a job code they were
       given months ago would lock them out of their own history. */
    if (isNew) {
      if (role === "client") {
        if (!code) return json({ error: "Your job code is needed. It is on the message Yaadly sent you." }, 400);
        const { data: ok, error } = await admin.rpc("pend_portal_code", { p_email: email, p_code: code });
        if (error) {
          root.recordError(error.message);
          return json({ error: "Could not check that code. Try again shortly." }, 502);
        }
        if (ok !== true) {
          root.setAttributes({ "yaadly.code.outcome": "code_rejected" });
          // One message for every way this fails. Naming which would tell a
          // guesser which half they got right.
          return json({ error: "That job code will not open an account. Check it against the message Yaadly sent you. If you have been here before, leave the code blank and we will send you a sign in code instead." }, 403);
        }
      } else {
        const { data: profile } = await admin.from("worker_profiles")
          .select("worker_email").eq("active", true).ilike("worker_email", email).maybeSingle();
        if (!profile) {
          root.setAttributes({ "yaadly.code.outcome": "not_vetted" });
          return json({ error: "Worker accounts open once Yaadly has vetted you. Apply first, and we will be in touch." }, 403);
        }
      }

      // Admin create, because this project has disable_signup on and an admin
      // call is the intended way around it. No password is set at all: there
      // is nothing to choose, forget, or have guessed.
      const { error: createErr } = await admin.auth.admin.createUser({ email, email_confirm: false });
      if (createErr && !/already|registered|exists/i.test(String(createErr.message))) {
        root.recordError(createErr.message);
        return json({ error: "Could not start that account. Try again, or message Yaadly." }, 502);
      }
    }

    // The code itself. generateLink hands back a link and a six digit
    // email_otp for the same token; we want the digits.
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink", email,
    });
    if (linkErr || !link?.properties?.email_otp) {
      root.recordError(linkErr?.message ?? "no email_otp returned");
      return json({ error: "Could not make a sign in code just now. Try again shortly." }, 502);
    }
    const otp = String(link.properties.email_otp);

    /* A code asked for WITH a job code came off /portal/join, and only that
       page attaches the job to the account once the code is typed. Found on
       28 Sep 2026: the founder took a code from this email to the ordinary
       sign in page, was signed in, and found no job, because nothing here
       said where the code belonged. Said only on this path; a plain sign in
       has nothing to attach and the extra sentence would mislead. */
    const where = role === "client" && code
      ? `Type it on the Yaadly page where you asked for it, the one headed "Finish your job". ` +
        `That is the step that attaches your job to your account. ` +
        `If that page is closed, open the link Yaadly sent you again and ask for a fresh code there. `
      : "";

    const line =
      `Your Yaadly sign in code is ${otp}. ${where}It lasts about an hour and it is single use. ` +
      `If you did not ask for it, ignore this and nothing happens.`;

    let emailed = false;
    let emailReason = RESEND_KEY ? "" : "RESEND_API_KEY not set";
    if (RESEND_KEY) {
      await trace.span("resend.send", SpanKind.CLIENT, {
        "server.address": "api.resend.com", "messaging.system": "resend",
      }, async (s) => {
        try {
          const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: `Yaadly <${FROM_EMAIL}>`,
              to: [email],
              reply_to: REPLY_TO,
              subject: `${otp} is your Yaadly sign in code`,
              text: line,
              html:
                `<p>Your Yaadly sign in code is:</p>` +
                `<p style="font-size:28px;font-weight:700;letter-spacing:4px">${otp}</p>` +
                (where ? `<p>${where.trim()}</p>` : "") +
                `<p>It lasts about an hour and it is single use. If you did not ask for it, ignore this and nothing happens.</p>`,
            }),
            signal: AbortSignal.timeout(15000),
          });
          s.setAttributes({ "http.response.status_code": r.status });
          emailed = r.ok;
          if (!r.ok) {
            // Named rather than swallowed. A sign in code that silently went
            // nowhere is somebody locked out of their own job with no idea
            // why, and the desk needs the actual reason to answer them.
            emailReason = `resend ${r.status}: ${(await r.text()).slice(0, 140)}`;
            s.recordError(emailReason);
          }
        } catch (e) {
          emailReason = String(e).slice(0, 160);
          s.recordError(emailReason);
        }
      });
    }

    /* The same code over WhatsApp, when this email belongs to a job that
       carries a phone number. Half this audience gave a number and reads
       WhatsApp long before they read email. */
    let phoneResult: { sent: boolean; reason?: string; via?: string } = { sent: false, reason: "no phone on file" };
    const { data: job } = await admin.from("jobs")
      .select("client_phone").ilike("client_email", email)
      .not("client_phone", "is", null).neq("client_phone", "")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();

    /* A worker signing in has no client job, so the code only ever went by
       email, although WhatsApp is where a worker actually is. 30 Sep 2026,
       review of every worker message: the phone on their worker profile is
       used the same way, through the same authentication path below. */
    let onFile = job?.client_phone ? String(job.client_phone) : "";
    if (!onFile) {
      const { data: wp } = await admin.from("worker_profiles")
        .select("phone").ilike("worker_email", email)
        .not("phone", "is", null).neq("phone", "")
        .limit(1).maybeSingle();
      if (wp?.phone) onFile = String(wp.phone);
    }

    /* Still deliberately NOT one of our own content templates. A sign in
       code is an AUTHENTICATION message in WhatsApp's own categories, and
       pushing an OTP through an ordinary UTILITY template is the thing that
       gets a sender flagged, which would take every other message this
       business sends down with it.

       What changed, 4 Sep 2026: Twilio Verify is now tried FIRST when
       TWILIO_VERIFY_SERVICE_SID is set. Verify uses Meta's own pre-defined
       authentication templates, so it reaches a client who has been quiet
       more than 24 hours, which free text simply cannot. It carries OUR
       code, not one of Twilio's, so nothing else in the sign in flow moves.

       Free text stays underneath it, in the order it always had. Inside the
       24 hour window free text is perfectly legitimate and costs less than a
       verification, so it is the right thing to fall back to rather than
       reporting failure. With the secret unset, this block behaves exactly
       as it did before Verify existed. Email is the reliable path for a sign
       in code either way and always will be. */
    if (onFile) {
      const phone = onFile;
      phoneResult = await sendVerify(phone, otp, "whatsapp", trace);
      if (!phoneResult.sent) {
        // SMS through Verify depends on the Verify service having an SMS
        // sender of its own; it reports honestly when it does not, the same
        // as every other leg here.
        const verifySms = await sendVerify(phone, otp, "sms", trace);
        if (verifySms.sent) phoneResult = verifySms;
      }
      if (!phoneResult.sent) {
        const wa = await sendTwilio(phone, line, "whatsapp", trace);
        if (wa.sent) phoneResult = wa;
      }
      if (!phoneResult.sent) {
        const sms = await sendTwilio(phone, line, "sms", trace);
        if (sms.sent) phoneResult = sms;
      }
    }

    const delivered = emailed || phoneResult.sent;
    root.setAttributes({
      "yaadly.code.emailed": emailed,
      "yaadly.code.phone": phoneResult.sent,
      "yaadly.code.outcome": delivered ? "sent" : "nowhere_to_send",
      "yaadly.code.new_account": isNew,
    });

    // The code itself is never returned. It goes to the mailbox or the phone
    // and nowhere else, which is the only reason holding it proves anything.
    return json({ ok: true, delivered, emailed, emailReason: emailed ? "" : emailReason, phone: phoneResult, isNew });
  } catch (e) {
    root.recordError(e);
    return json({ error: String(e).slice(0, 200) }, 500);
  }
});
