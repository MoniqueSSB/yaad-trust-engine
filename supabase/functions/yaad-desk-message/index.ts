/* ── yaad-desk-message ─────────────────────────────────────────────────────
 *
 * Monique's own message to the client or the tradesperson on a job, sent from
 * the Yaadly WhatsApp number or the Yaadly jobs address. Asked for on 10
 * September 2026: "allow me to send emails and a text to clients and worker
 * during a live job."
 *
 * WHY NOT yaad-desk-reply. That function answers a conversation that already
 * exists: it is keyed on an intake thread's channel and number, and a worker
 * on a live job, or a client who booked through the website form, has no
 * thread. This one is keyed on the JOB, and it can email.
 *
 * WHAT IT IS NOT. There is no model call anywhere in this file, the same rule
 * yaad-desk-reply keeps and for the same reason: the text is typed by a
 * signed-in admin, word for word, and sent as typed. The banned-language
 * screen exists to stop AI output making promises no human approved; this is
 * a named human speaking for herself. Do not add a model call here. A drafted
 * message belongs in the desk as text she edits, never in this path.
 *
 * THE ADDRESS COMES FROM THE JOB, NEVER FROM THE PAGE. The caller names a job
 * and a side, client or worker. This function reads that job under the
 * caller's own token and sends to the number or address on it. A page that
 * could supply its own address would be a way to send from the Yaadly number
 * to anybody at all.
 *
 * AUTH. Platform verify_jwt stays ON for this function: deploy WITHOUT
 * --no-verify-jwt. Inside, is_admin() is checked through the caller's token,
 * and every database call goes out under that token, so RLS does the access
 * control and this function holds no service-role key.
 *
 * THE RECORD. A send is written to the action ledger under her name by
 * record_desk_message(), a SECURITY DEFINER function that checks is_admin()
 * itself (migration 20260911090000). If that function is not there yet the
 * message still goes and the reply says it was not recorded, because a
 * message that was really sent must never be reported as not sent.
 *
 * THE 24 HOUR WINDOW. WhatsApp only carries a typed business message within
 * 24 hours of the person's last message to the Yaadly number. Outside that
 * Twilio refuses with 63016 and this function says so, in words, and points
 * at the two ways that do work: email, or her own WhatsApp from the desk's
 * "Open in my own app" button. Nothing is queued, because unlike a reply to
 * a waiting client there is no conversation for a queued message to rejoin.
 */

import { httpAttrs, SpanKind, Trace } from "./otel.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("YAAD_FROM_EMAIL") ?? "jobs@in.yaadly.co.uk";
const REPLY_TO = Deno.env.get("YAAD_REPLY_TO") ?? "monique@yaadly.co.uk";
const MAX_TEXT = 1500;

function bearer(req: Request): string {
  return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
}

// Every database call goes out under the CALLER's token, so RLS is doing the
// access control. Same pattern as yaad-desk-reply and yaad-invoice.
async function db(req: Request, path: string, init: RequestInit = {}) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  return await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: anon,
      Authorization: `Bearer ${bearer(req)}`,
      ...(init.headers || {}),
    },
  });
}

async function isAdmin(req: Request): Promise<boolean> {
  try {
    const r = await db(req, "rpc/is_admin", { method: "POST", body: "{}" });
    return r.ok && (await r.json()) === true;
  } catch (_) {
    return false;
  }
}

type Sent = { sent: boolean; reason?: string; code?: number; sid?: string };

/* Twilio WhatsApp, free text only. A copy rather than a shared module, for
   the reason recorded in yaad-desk-reply and yaad-portal-code. */
async function sendWhatsApp(to: string, body: string, trace: Trace): Promise<Sent> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const tok = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  const from = Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "";
  if (!sid || !tok) return { sent: false, reason: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set." };
  if (!from) return { sent: false, reason: "TWILIO_WHATSAPP_FROM not set." };
  const digits = to.replace(/\D/g, "");
  if (digits.length < 7) return { sent: false, reason: "The number on this job is not usable." };

  return await trace.span("twilio.send.whatsapp", SpanKind.CLIENT, {
    "server.address": "api.twilio.com", "messaging.system": "twilio",
  }, async (s) => {
    try {
      const params = new URLSearchParams({ To: `whatsapp:+${digits}`, From: from, Body: body });
      const statusUrl = Deno.env.get("TWILIO_STATUS_CALLBACK_URL") ?? "";
      if (statusUrl) params.set("StatusCallback", statusUrl);
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + btoa(`${sid}:${tok}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
        signal: AbortSignal.timeout(15000),
      });
      s.setAttributes({ "http.response.status_code": r.status });
      if (r.ok) {
        const accepted = await r.json().catch(() => null) as { sid?: string } | null;
        return { sent: true, sid: accepted?.sid };
      }
      const d = await r.json().catch(() => null) as { code?: number; message?: string } | null;
      const reason = d?.code === 63016
        ? "WhatsApp will not carry this: it is more than 24 hours since they last messaged the Yaadly number. Send it by email instead, or use Open in my own app to send it from your own WhatsApp."
        : `Twilio refused it: ${r.status}${d?.code ? ` (code ${d.code})` : ""}${d?.message ? `, ${d.message}` : ""}`;
      s.recordError(reason);
      return { sent: false, reason, code: d?.code };
    } catch (e) {
      const reason = String(e).slice(0, 160);
      s.recordError(reason);
      return { sent: false, reason };
    }
  });
}

/* Resend, plain text only, so nothing she types can be read as markup. */
async function sendEmail(to: string, subject: string, body: string, trace: Trace): Promise<Sent> {
  if (!RESEND_KEY) return { sent: false, reason: "RESEND_API_KEY not set." };
  if (!/@/.test(to)) return { sent: false, reason: "The address on this job is not usable." };
  return await trace.span("resend.send", SpanKind.CLIENT, {
    "server.address": "api.resend.com", "messaging.system": "resend",
  }, async (s) => {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `Monique at Yaadly <${FROM_EMAIL}>`, to: [to], reply_to: REPLY_TO,
          subject, text: `${body}\n\nMonique\nYaadly`,
        }),
        signal: AbortSignal.timeout(15000),
      });
      s.setAttributes({ "http.response.status_code": r.status });
      if (r.ok) {
        const accepted = await r.json().catch(() => null) as { id?: string } | null;
        return { sent: true, sid: accepted?.id ? `resend:${accepted.id}` : undefined };
      }
      const reason = `The email service refused it: ${r.status}. ${(await r.text()).slice(0, 160)}`;
      s.recordError(reason);
      return { sent: false, reason };
    } catch (e) {
      const reason = String(e).slice(0, 160);
      s.recordError(reason);
      return { sent: false, reason };
    }
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-desk-message", req);
  const root = trace.startSpan(`${req.method} /yaad-desk-message`, SpanKind.SERVER, httpAttrs(req));
  const json = (b: unknown, status = 200) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end();
    trace.flush();
    return new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  };

  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  try {
    if (!(await isAdmin(req))) {
      return json({ error: "Only a signed-in admin can send from Yaadly." }, 403);
    }

    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    const jobId = String(b.job_id ?? "").trim();
    const to = String(b.to ?? "");
    const channel = String(b.channel ?? "");
    const text = String(b.text ?? "").trim();
    const subject = (String(b.subject ?? "").trim() || `About your job ${jobId}`).slice(0, 120);

    if (!jobId) return json({ error: "Which job is this about?" }, 400);
    if (to !== "client" && to !== "worker") return json({ error: "A message goes to the client or the worker." }, 400);
    if (channel !== "whatsapp" && channel !== "email") return json({ error: "A message goes by WhatsApp or email." }, 400);
    if (!text) return json({ error: "Nothing to send." }, 400);
    if (text.length > MAX_TEXT) return json({ error: `That is ${text.length} characters. Keep it under ${MAX_TEXT}, or send it as two.` }, 400);

    // The address, read off the job under her own token. Never from the page.
    const jr = await db(req, `jobs?id=eq.${encodeURIComponent(jobId)}&select=id,client_name,client_phone,client_email,worker_name,worker_phone,worker_email`);
    if (!jr.ok) return json({ error: `Could not read the job: rest ${jr.status}.` }, 502);
    const job = ((await jr.json()) as Record<string, string | null>[])[0];
    if (!job) return json({ error: `No job ${jobId}.` }, 404);

    const who = to === "client" ? (job.client_name || "the client") : (job.worker_name || "the tradesperson");
    const addr = channel === "whatsapp"
      ? String((to === "client" ? job.client_phone : job.worker_phone) ?? "").trim()
      : String((to === "client" ? job.client_email : job.worker_email) ?? "").trim();
    if (!addr) {
      return json({ error: `There is no ${channel === "whatsapp" ? "number" : "email address"} for ${who} on this job.` }, 400);
    }

    root.setAttributes({ "yaadly.job.id": jobId, "yaadly.desk_message.to": to, "yaadly.desk_message.channel": channel });
    const sent = channel === "whatsapp"
      ? await sendWhatsApp(addr, text, trace)
      : await sendEmail(addr, subject, text, trace);
    if (!sent.sent) return json({ error: sent.reason || "It did not send." }, sent.code === 63016 ? 409 : 502);

    // The ledger, under her name. Best effort: the message has already gone.
    const rec = await db(req, "rpc/record_desk_message", {
      method: "POST",
      body: JSON.stringify({
        p_job: jobId, p_to: to, p_channel: channel, p_sid: sent.sid ?? "",
        p_to_addr: addr, p_body: text,
      }),
    }).catch(() => null);
    const recorded = !!rec && rec.ok;
    if (!recorded) root.recordError(`sent but not recorded: ${rec ? "rest " + rec.status : "no response"}`);

    const how = channel === "whatsapp" ? "on WhatsApp from the Yaadly number" : "by email from the Yaadly jobs address, with replies coming to you";
    return json({
      ok: true,
      recorded,
      note: recorded
        ? `Sent to ${who} ${how}, and recorded on ${jobId} under your name.`
        : `Sent to ${who} ${how}, but it could not be written to the job's record. Note it on the job so the record stays complete.`,
    });
  } catch (e) {
    root.recordError(e);
    return json({ error: String(e).slice(0, 200) }, 500);
  }
});
