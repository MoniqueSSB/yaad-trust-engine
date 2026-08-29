import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

// Gated portal signup.
//
// The site tells people "they need this code plus their email to create a
// portal account, it is not open sign-up". Until now that was not true:
// clientGateSignup() called sb.auth.signUp() directly and anyone could make an
// account with any email. A check in the page's JavaScript would not have
// fixed it either, because the browser can always call the auth API directly.
//
// The only way to make the claim true is to close public sign-up in Auth and
// create accounts here, behind the check. That is what this does.
//
//   client -> must present the portal code for their job or service.
//             pend_portal_code() decides. If the row already carries an
//             email, that email has to match, exactly as before. If it does
//             not carry one yet, the code is good enough on its own: that is
//             the normal case, because WhatsApp intake has a phone number and
//             never an email, and those jobs were impossible to claim at all
//             until 20260829b. It rate limits on both the email and the code:
//             five wrong answers against either inside fifteen minutes and it
//             stops answering.
//   worker -> must already have an active worker profile, which only exists
//             once Monique has vetted them. No vetting, no account.
//
// Nothing here attaches an email to a job. Signing up records a PENDING claim
// and the confirmation link is what binds it, because clicking that link is
// the only thing that proves the address is real and belongs to the person
// typing it. A client who mistypes their own address loses nothing: no link
// arrives, no claim is consumed, they try again. See 20260829c.
//
// The confirmation email goes out through Resend, not through GoTrue's own
// sender. Supabase's built-in SMTP is rate limited to a handful of messages an
// hour and is documented as being for testing, which is not a thing to find
// out during a launch. Resend is already the sending path for worker match
// alerts and desk summaries on this project, from a domain with live DKIM and
// SPF. generateLink() gives us the same link GoTrue would have posted; we just
// carry it ourselves.
// This function holds the service role key, so it is deliberately small and
// does exactly one thing. Nothing here echoes a secret, and it never says
// whether an email is already registered.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_KEY   = Deno.env.get("RESEND_API_KEY") ?? "";
// in.yaadly.co.uk, not send.yaadly.co.uk. Resend still lists the latter as
// verified but its DKIM and SPF records are gone from DNS, so mail from it
// fails authentication and lands in spam. Same reasoning as yaad-inbound.
const FROM_EMAIL   = Deno.env.get("YAAD_FROM_EMAIL") ?? "jobs@in.yaadly.co.uk";
const SIGNIN_URL   = Deno.env.get("YAAD_PORTAL_SIGNIN_URL") ?? "https://app.yaadly.co.uk/portal/sign-in";
const MIN_PASSWORD = 8;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-portal-signup", req);
  const root = trace.startSpan("POST /yaad-portal-signup", SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush(); return res;
  };
  const json = (body: unknown, status = 200) =>
    done(new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } }), status);

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!SUPABASE_URL || !SERVICE_KEY) {
      root.recordError("service role key not available");
      return json({ error: "Sign-up is not configured. Contact Yaadly." }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const code = String(body.code ?? "").trim();
    const role = body.role === "worker" ? "worker" : "client";

    root.setAttributes({ "yaadly.signup.role": role });

    if (!email || !email.includes("@")) return json({ error: "A valid email is needed." }, 400);
    if (password.length < MIN_PASSWORD) {
      return json({ error: `Password needs to be at least ${MIN_PASSWORD} characters.` }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ---- the gate -------------------------------------------------------
    if (role === "client") {
      if (!code) return json({ error: "Your job code is needed. It is on the message Yaadly sent you." }, 400);

      // Records a pending claim on success. Binds nothing: that happens when
      // the confirmation link is clicked.
      const { data: ok, error } = await admin.rpc("pend_portal_code", { p_email: email, p_code: code });
      if (error) {
        root.recordError(error.message);
        return json({ error: "Could not check that code. Try again shortly." }, 502);
      }
      if (ok !== true) {
        root.setAttributes({ "yaadly.signup.outcome": "code_rejected" });
        // Deliberately one message for every way this fails: wrong code, a
        // code already claimed by somebody else, or too many tries. Naming
        // which would tell a guesser which half they got right.
        return json({ error: "That job code will not open an account. Check it against the message Yaadly sent you. If you have been here before, sign in instead, or message Yaadly." }, 403);
      }
    } else {
      const { data: profile, error } = await admin
        .from("worker_profiles")
        .select("worker_email")
        .eq("active", true)
        .ilike("worker_email", email)
        .maybeSingle();
      if (error) {
        root.recordError(error.message);
        return json({ error: "Could not check that. Try again shortly." }, 502);
      }
      if (!profile) {
        root.setAttributes({ "yaadly.signup.outcome": "not_vetted" });
        return json({ error: "Worker accounts open once Yaadly has vetted you. Apply first, and we will be in touch." }, 403);
      }
    }

    // ---- create the account, and take the link ---------------------------
    // Created UNCONFIRMED on purpose, and this is now load-bearing rather than
    // good manners: the confirmation click is what binds the job to them.
    //
    // generateLink() makes the user and hands back the very link GoTrue would
    // have emailed, without emailing it. We carry it ourselves so it goes out
    // over Resend rather than Supabase's testing-grade built-in SMTP.
    const { data: link, error: createErr } = await admin.auth.admin.generateLink({
      type: "signup",
      email,
      password,
      options: { redirectTo: SIGNIN_URL },
    });

    const confirmUrl = link?.properties?.action_link ?? "";

    if (createErr || !confirmUrl) {
      const msg = String(createErr?.message || "no action link returned");
      root.setAttributes({ "yaadly.signup.outcome": "create_failed" });
      if (/already|registered|exists/i.test(msg)) {
        // Deliberately not confirmed as "this email exists": say the same
        // thing either way and point them at sign-in.
        return json({ error: "Could not create that account. If you already have one, sign in above instead." }, 409);
      }
      root.recordError(msg);
      return json({ error: "Could not create the account. Try again, or message Yaadly." }, 502);
    }

    // ---- send the confirmation email ------------------------------------
    // The account exists but cannot sign in until this link is clicked, and
    // the job stays unattached to anyone until it is.
    const esc = (t: string) => t.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string));
    const href = esc(confirmUrl);

    const text =
`Confirm your email to open your Yaadly portal.

${confirmUrl}

That link does two things: it proves this address is yours, and it attaches
your job to it. Until you click it, nothing on your job moves and nobody is
charged anything.

If you did not ask for a Yaadly portal, ignore this. Nothing happens.`;

    const html =
`<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#0b1a16;max-width:600px">
<p style="margin:0 0 18px">Confirm your email and your portal is open.</p>
<p style="margin:0 0 22px"><a href="${href}" style="background:#14b8a6;color:#04211d;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:100px;display:inline-block">Confirm my email</a></p>
<p style="margin:0 0 18px">That link does two things: it proves this address is yours, and it attaches your job to it. Until you click it, nothing on your job moves and nobody is charged anything.</p>
<p style="margin:0 0 18px;font-size:13px;color:#67807a">If the button does not work, paste this into your browser:<br><span style="word-break:break-all">${href}</span></p>
<p style="margin:0;font-size:12.5px;color:#67807a">If you did not ask for a Yaadly portal, ignore this. Nothing happens.</p>
</div>`;

    let emailed = false;
    if (!RESEND_KEY) {
      root.recordError("RESEND_API_KEY is not set on this project, confirmation email not sent");
    } else {
      await trace.span("resend.send confirmation", SpanKind.CLIENT, {
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
              subject: "Confirm your email to open your Yaadly portal",
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
    }

    root.setAttributes({ "yaadly.signup.confirmation_emailed": emailed });
    if (!emailed) {
      // The account is real but unusable until confirmed, and we could not
      // send. Say so plainly rather than leaving them staring at an inbox.
      return json({
        ok: true, emailed: false,
        message: "Your account is created, but we could not send the confirmation email just now. Message Yaadly and we will send it.",
      });
    }

    root.setAttributes({ "yaadly.signup.outcome": "created" });
    return json({ ok: true, emailed: true, message: `Check ${email} for a confirmation link. Clicking it opens your portal and attaches your job.` });
  } catch (e) {
    root.recordError(e);
    return json({ error: "Something went wrong. Try again, or message Yaadly." }, 500);
  }
});
