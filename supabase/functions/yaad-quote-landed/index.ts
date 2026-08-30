/* ── yaad-quote-landed ─────────────────────────────────────────────────────
 *
 * Tells a client that a price has arrived on their job.
 *
 * Until this existed, nothing did. A worker quoted, the quote sat on a page
 * that was honest when empty, and the client had to think to come back and
 * look. A quote nobody is told about is a quote that does not convert, and
 * for a client four thousand miles away it reads as silence.
 *
 * WHY THIS IS A FUNCTION AND NOT A LINE IN THE SERVER ACTION. The client's
 * email and phone number are on the job, and a worker must never be able to
 * read them: that is the whole point of "hidden from workers until you start
 * a chat". So the worker's session cannot do this lookup, and the send has to
 * happen somewhere holding the service key with the worker never seeing what
 * it read.
 *
 * WHO MAY CALL IT. The caller must present the JWT of the worker whose quote
 * this is. Anybody else, including another vetted worker, is refused. It
 * takes a quote id and nothing else: no address, no message body, nothing the
 * caller could use to make this send something of their choosing to somebody
 * of their choosing.
 *
 * WHAT IT SENDS ON. Whichever channel the client actually gave. Email through
 * Resend, WhatsApp through the Meta send API when its credentials are set.
 * Neither is required and the absence of both is reported rather than
 * swallowed, because "we told them" is exactly the kind of thing that must
 * not be assumed.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { httpAttrs, SpanKind, Trace } from "./otel.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("YAAD_FROM_EMAIL") ?? "jobs@in.yaadly.co.uk";
const REPLY_TO = Deno.env.get("YAAD_REPLY_TO") ?? "monique@yaadly.co.uk";
const APP_URL = Deno.env.get("YAAD_APP_URL") ?? "https://app.yaadly.co.uk";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const money = (n: number | null) =>
  n == null ? "" : "J$" + Number(n).toLocaleString("en-JM");

async function sendWhatsApp(to: string, body: string, trace: Trace) {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) {
    return { sent: false, reason: "WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set" };
  }
  return await trace.span("whatsapp.send", SpanKind.CLIENT, {
    "server.address": "graph.facebook.com",
    "messaging.system": "whatsapp",
  }, async (s) => {
    try {
      const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: to.replace(/\D/g, ""),
          type: "text",
          text: { body },
        }),
        signal: AbortSignal.timeout(15000),
      });
      s.setAttributes({ "http.response.status_code": r.status });
      return { sent: r.ok, status: r.status };
    } catch (e) {
      s.recordError(String(e).slice(0, 200));
      return { sent: false, reason: String(e).slice(0, 160) };
    }
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  const trace = new Trace("yaad-quote-landed", req);
  const root = trace.startSpan(`POST /yaad-quote-landed`, SpanKind.SERVER, httpAttrs(req));

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const quoteId = String(body.quoteId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(quoteId)) return json({ error: "A quote id is needed." }, 400);

    // Who is asking. The anon key alone proves nothing, so the caller's own
    // token is read and matched against the quote's worker.
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: caller } = await admin.auth.getUser(jwt);
    const callerEmail = (caller?.user?.email ?? "").toLowerCase();
    if (!callerEmail) return json({ error: "Sign in first." }, 401);

    const { data: quote } = await admin
      .from("job_quotes")
      .select("id, job_id, worker_email, worker_name, labour_jmd, materials_jmd")
      .eq("id", quoteId)
      .maybeSingle();
    if (!quote) return json({ error: "No such quote." }, 404);

    if (String(quote.worker_email ?? "").toLowerCase() !== callerEmail) {
      root.setAttributes({ "yaadly.notify.outcome": "not_your_quote" });
      return json({ error: "That is not your quote." }, 403);
    }

    const { data: job } = await admin
      .from("jobs")
      .select("id, title, parish, portal_code, client_email, client_phone")
      .eq("id", quote.job_id)
      .maybeSingle();
    if (!job) return json({ error: "No such job." }, 404);

    const link = `${APP_URL}/jobs/${encodeURIComponent(job.id)}/quotes?code=${encodeURIComponent(job.portal_code ?? "")}`;
    const total = (quote.labour_jmd ?? 0) + (quote.materials_jmd ?? 0);

    const line =
      `A price has come in on your Yaadly job, ${job.title}. ` +
      `${quote.worker_name} quoted ${money(total)}, labour and materials itemised separately. ` +
      `Nothing is booked and nothing is charged until you choose. See it here: ${link}`;

    let emailed = false;
    let emailReason = "";
    const clientEmail = String(job.client_email ?? "").trim();

    if (clientEmail && RESEND_KEY) {
      await trace.span("resend.send", SpanKind.CLIENT, {
        "server.address": "api.resend.com",
        "messaging.system": "resend",
      }, async (s) => {
        try {
          const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: `Yaadly <${FROM_EMAIL}>`,
              to: [clientEmail],
              reply_to: REPLY_TO,
              subject: `A price on your job: ${job.title}`,
              text: line,
              html:
                `<p>A price has come in on your Yaadly job, <b>${job.title}</b>.</p>` +
                `<p><b>${quote.worker_name}</b> quoted <b>${money(total)}</b>, with labour and materials itemised separately. ` +
                `Materials are passed through at cost.</p>` +
                `<p><b>Nothing is booked and nothing is charged until you choose.</b></p>` +
                `<p><a href="${link}">See the quote</a></p>`,
            }),
            signal: AbortSignal.timeout(15000),
          });
          s.setAttributes({ "http.response.status_code": r.status });
          emailed = r.ok;
          if (!r.ok) {
            emailReason = `resend ${r.status}`;
            s.recordError(`${emailReason}: ${(await r.text()).slice(0, 160)}`);
          }
        } catch (e) {
          emailReason = String(e).slice(0, 160);
          s.recordError(emailReason);
        }
      });
    } else if (!clientEmail) {
      emailReason = "no client email on the job";
    } else {
      emailReason = "RESEND_API_KEY not set";
    }

    const clientPhone = String(job.client_phone ?? "").trim();
    const wa = clientPhone
      ? await sendWhatsApp(clientPhone, line, trace)
      : { sent: false, reason: "no client phone on the job" };

    // Said out loud rather than assumed. If neither channel worked the desk
    // needs to know, because the client is sitting waiting on a price nobody
    // told them about.
    const told = emailed || wa.sent;
    root.setAttributes({
      "yaadly.notify.emailed": emailed,
      "yaadly.notify.whatsapp": wa.sent,
      "yaadly.notify.outcome": told ? "told" : "nobody_told",
    });

    return json({ ok: true, told, emailed, emailReason: emailed ? "" : emailReason, whatsapp: wa });
  } catch (e) {
    root.recordError(e);
    return json({ error: String(e).slice(0, 200) }, 500);
  } finally {
    root.end();
    trace.flush();
  }
});
