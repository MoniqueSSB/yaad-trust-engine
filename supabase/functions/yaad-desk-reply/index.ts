/* ── yaad-desk-reply ────────────────────────────────────────────────────────
 *
 * Monique's own reply, sent from the Yaadly WhatsApp number.
 *
 * WHY. When a client asks to speak to a person, the intake assistant promises
 * "she will come back to you on this number". Until this function existed the
 * only way to keep that promise was Monique messaging from her personal
 * WhatsApp, which arrives as a brand new chat from an unknown number, not a
 * continuation of the conversation they were already having. This sends her
 * words through the same Twilio sender the assistant uses, so her reply lands
 * in the same thread the client wrote to.
 *
 * WHAT IT IS NOT. There is no model call anywhere in this file. The text is
 * typed by a signed-in admin at the desk, word for word, and sent as typed.
 * That is why it is not screened by guardrails.ts either: the banned-language
 * screen exists to stop AI output making promises no human approved, and this
 * is a named human speaking for herself. Do not add a model call here; a
 * drafted reply belongs in the desk UI as text she edits, not in this path.
 *
 * AUTH. Platform verify_jwt stays ON for this function (deploy without
 * --no-verify-jwt). Inside, is_admin() is checked through the caller's own
 * token, and every database write goes out under that token too, so RLS is
 * doing the access control and this function holds no service-role key.
 *
 * SIDE EFFECT. A successful send appends the message to the intake_threads
 * transcript (labelled as Monique's) and sets human_handling true, because a
 * thread a human has spoken on is a human's thread: yaad-inbound stands down
 * on it until the desk hands it back.
 *
 * THE 24 HOUR WINDOW. WhatsApp only allows free-text business replies within
 * 24 hours of the client's last message. Outside that, Twilio refuses with
 * code 63016 and this function reports exactly that, honestly, rather than
 * pretending the message went. The desk shows the refusal as it came back.
 *
 * THE WEBSITE CHAT (2 Sep 2026). A thread on channel 'web' has no number to
 * send to. Her words go into web_chat_replies instead, keyed by the visitor
 * token, and the widget on yaadly.co.uk polls for them while it is open.
 * Nothing is sent anywhere: if the visitor has closed the page they will not
 * see it, and the note returned says so, because the widget also gave them a
 * WhatsApp button for exactly that case. Same transcript append, same
 * human_handling claim, same "no model in this path" rule.
 */

import { httpAttrs, SpanKind, Trace } from "./otel.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function bearer(req: Request): string {
  return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
}

function env() {
  return {
    url: Deno.env.get("SUPABASE_URL")!,
    anon: Deno.env.get("SUPABASE_ANON_KEY")!,
  };
}

// Every database call goes out under the CALLER's token, so RLS is doing the
// access control and this function holds no service-role key. Same pattern as
// yaad-invoice, for the same reason.
async function db(req: Request, path: string, init: RequestInit = {}) {
  const { url, anon } = env();
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

/* Twilio, same shape as yaad-portal-code and yaad-notify-client. A copy
   rather than a shared module for the reason recorded in yaad-portal-code:
   sync-shared.sh copies one file into every function, and this send is a few
   lines that three functions already carry independently. */
async function sendTwilio(
  to: string, body: string, channel: "whatsapp" | "sms", trace: Trace,
  template?: { sid: string; vars: Record<string, string> },
): Promise<{ sent: boolean; reason?: string; code?: number; sid?: string }> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const tok = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  const from = channel === "whatsapp"
    ? (Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "")
    : (Deno.env.get("TWILIO_SMS_FROM") ?? "");
  if (!sid || !tok) return { sent: false, reason: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set" };
  if (!from) return { sent: false, reason: `TWILIO_${channel === "whatsapp" ? "WHATSAPP" : "SMS"}_FROM not set` };

  const digits = to.replace(/\D/g, "");
  if (digits.length < 7) return { sent: false, reason: "number not usable" };
  const dest = channel === "whatsapp" ? `whatsapp:+${digits}` : `+${digits}`;

  return await trace.span(`twilio.send.${channel}`, SpanKind.CLIENT, {
    "server.address": "api.twilio.com", "messaging.system": "twilio",
    "yaadly.send.templated": !!template,
  }, async (s) => {
    try {
      // Same two shapes yaad-notify-client uses: free text, or an approved
      // template with its fixed variable slots. A template is only ever sent
      // with the variables it was approved for.
      const params = template
        ? new URLSearchParams({ To: dest, From: from, ContentSid: template.sid, ContentVariables: JSON.stringify(template.vars) })
        : new URLSearchParams({ To: dest, From: from, Body: body });
      // Ask Twilio to tell us what actually happens to it. A 201 means Twilio
      // took the message, not that a phone received it, and this is the one
      // message a client has been promised. Only set when the URL is
      // configured, so nothing changes until yaad-message-status is deployed.
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
        ? "More than 24 hours since their last message, so WhatsApp will not deliver a typed reply."
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-desk-reply", req);
  const root = trace.startSpan(`${req.method} /yaad-desk-reply`, SpanKind.SERVER, httpAttrs(req));
  const json = (b: unknown, status = 200) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end();
    trace.flush();
    return new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  };

  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  try {
    if (!(await isAdmin(req))) {
      return json({ error: "Only a signed-in admin can send from the Yaadly number." }, 403);
    }

    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    const channel = String(b.channel ?? "");
    const fromAddr = String(b.from_addr ?? "").trim();
    const text = String(b.text ?? "").trim();

    if (channel !== "whatsapp" && channel !== "sms" && channel !== "web") {
      return json({ error: "This lane only sends WhatsApp, SMS and the website chat. An email thread is answered from your own mailbox." }, 400);
    }
    if (!fromAddr) return json({ error: "No number to send to on this thread." }, 400);
    if (!text) return json({ error: "Nothing to send." }, 400);
    if (text.length > 1500) {
      return json({ error: "Too long for one WhatsApp message. Keep it under 1500 characters or split it in two." }, 400);
    }

    // The thread first, under the caller's token: if RLS will not show it,
    // nothing gets sent to anybody.
    const q = `intake_threads?channel=eq.${encodeURIComponent(channel)}&from_addr=eq.${encodeURIComponent(fromAddr)}&select=job_id,transcript,turns,first_human_reply_at`;
    const tr = await db(req, q);
    const rows = tr.ok ? await tr.json() as { job_id: string; transcript: string; turns: number; first_human_reply_at: string | null }[] : [];
    if (!rows.length) return json({ error: "That conversation is not in intake_threads any more. Reload the desk." }, 404);
    const thread = rows[0];

    if (channel === "web") {
      // Written under her token: the admin policy on web_chat_replies is
      // what lets this row in, and nothing else can.
      const ins = await db(req, "web_chat_replies", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ visitor_key: fromAddr, job_id: thread.job_id, body: text }),
      });
      if (!ins.ok) return json({ error: `Could not save the reply: rest ${ins.status}.` }, 502);
    } else {
      const sent = await sendTwilio(fromAddr, text, channel, trace);
      // The row a status callback updates. Written on the caller's own token,
      // so RLS still applies and this function keeps holding no service key.
      // Best effort throughout: not knowing what happened to a delivered
      // message is a smaller problem than refusing to send one.
      if (sent.sid) {
        await db(req, "message_deliveries", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({
            message_sid: sent.sid, to_addr: fromAddr, channel,
            kind: "desk_reply", job_id: thread.job_id ?? "", status: "accepted",
          }),
        }).catch(() => { /* never let bookkeeping cost a delivered reply */ });
      }
      if (!sent.sent && sent.code === 63016) {
        // ── the 24 hour window closed, 4 September 2026 ──────────────────
        //
        // Until now this returned 502 and her typed reply was simply gone.
        // That is the ordinary shape of her week rather than an edge case:
        // a client writes on Tuesday afternoon, she reaches the desk on
        // Wednesday night, and WhatsApp will not carry free text that far.
        // Meanwhile the assistant has already promised the client she would
        // come back to them on this number.
        //
        // So the reply is kept, and an approved template goes instead saying
        // one is waiting. Her actual words are NOT put in the template:
        // a template's variable slots are approved for one specific
        // sentence, and yaad-notify-client's header records why reusing one
        // to carry a different sentence is how a sender gets flagged. The
        // words go as free text the moment the client writes back, which is
        // what reopens the window, and yaad-inbound does that flush.
        const queued = await db(req, "pending_desk_replies", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ channel, to_addr: fromAddr, job_id: thread.job_id ?? "", body: text }),
        });
        if (!queued.ok) {
          return json({ error: `${sent.reason} It could not be queued either (rest ${queued.status}), so it is not saved. Copy it somewhere before you lose it.` }, 502);
        }

        const nudgeSid = Deno.env.get("TWILIO_CONTENT_SID_DESK_REPLY") ?? "";
        let nudged = false;
        if (nudgeSid && channel === "whatsapp") {
          const n = await sendTwilio(fromAddr, "", channel, trace, {
            sid: nudgeSid,
            vars: { "1": String(thread.job_id || "your job") },
          });
          nudged = n.sent;
        }
        root.setAttributes({ "yaadly.desk_reply.queued": true, "yaadly.desk_reply.nudged": nudged });

        // Recorded on the transcript and the thread claimed, exactly as a
        // delivered reply would be: she said it, it is going, and the
        // assistant must not start answering this number in the meantime.
        const heldTranscript = `${String(thread.transcript ?? "")}\n\nYaadly (from the desk, waiting to send): ${text}`.slice(-8000);
        await db(
          req,
          `intake_threads?channel=eq.${encodeURIComponent(channel)}&from_addr=eq.${encodeURIComponent(fromAddr)}`,
          { method: "PATCH", body: JSON.stringify({ transcript: heldTranscript, human_handling: true, last_at: new Date().toISOString() }) },
        );

        return json({
          ok: true,
          queued: true,
          nudged,
          note: nudged
            ? "More than 24 hours had passed, so WhatsApp would not carry your words directly. They are saved, and a short approved message has gone telling them a reply is waiting. The moment they send anything back, your reply goes out in full, automatically."
            : "More than 24 hours had passed, so WhatsApp would not carry your words directly. They are saved and will go out the moment that number writes back. No nudge was sent, because TWILIO_CONTENT_SID_DESK_REPLY is not configured, so they do not yet know to write back. See RUNBOOK.md.",
        });
      }
      if (!sent.sent) return json({ error: sent.reason ?? "The send failed." }, 502);
    }

    // Sent, so it is part of the record. Labelled as hers, and the thread is
    // hers now too: yaad-inbound stands down until the desk hands it back.
    const transcript = `${String(thread.transcript ?? "")}\n\nYaadly (from the desk): ${text}`.slice(-8000);
    // The site says "a person replies within one working day", and until 4
    // September 2026 nothing recorded when that happened. Written ONCE and
    // never overwritten: the promise is about the first reply, not the most
    // recent one, so a long conversation cannot make a slow start look fast.
    // awaiting_human_since is cleared in the same write, because the queue it
    // feeds is "who is still owed an answer".
    const firstReply = thread.first_human_reply_at ? {} : { first_human_reply_at: new Date().toISOString() };
    const up = await db(
      req,
      `intake_threads?channel=eq.${encodeURIComponent(channel)}&from_addr=eq.${encodeURIComponent(fromAddr)}`,
      {
        method: "PATCH",
        // THE REPLY CLOCK. This is the only place a real person answering is
        // recorded, which is what makes the "a person replies within one
        // working day" promise on every public page checkable at all.
        //
        //   first_human_reply_at  set ONCE and never overwritten (see
        //                         firstReply above), because the promise is
        //                         about the first answer, not the most recent.
        //   awaiting_human_since  cleared here, so a thread that has been
        //                         answered stops counting against the desk.
        //
        // first_client_at is set on the way in, by yaad-inbound, not here.
        body: JSON.stringify({
          transcript, human_handling: true, last_at: new Date().toISOString(),
          awaiting_human_since: null, ...firstReply,
        }),
      },
    );
    // The message is already with the client either way; a failed record
    // write is reported, not hidden, so the transcript is never quietly
    // missing something that was really said.
    const recorded = up.ok;
    if (!recorded) root.recordError(`sent but not recorded: rest ${up.status}`);

    root.setAttributes({
      "yaadly.desk_reply.channel": channel,
      "yaadly.desk_reply.recorded": recorded,
      "yaadly.job.id": String(thread.job_id ?? ""),
    });
    const where = channel === "web" ? "Placed in their chat window on yaadly.co.uk" : "Sent from the Yaadly number";
    const webCaveat = channel === "web"
      ? " They see it only while that page is open; if they have left, they were given the WhatsApp button and the same reference, so watch for them there."
      : "";
    return json({
      ok: true,
      recorded,
      note: recorded
        ? `${where} and added to the transcript. The assistant is standing down on this thread until you hand it back.${webCaveat}`
        : `${where}, but writing it into the transcript failed. Say it again in the thread notes or retry, so the record stays complete.${webCaveat}`,
    });
  } catch (e) {
    root.recordError(e);
    return json({ error: String(e).slice(0, 200) }, 500);
  }
});
