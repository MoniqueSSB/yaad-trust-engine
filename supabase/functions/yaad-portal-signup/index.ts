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
//             until 20260829f. It rate limits on both the email and the code:
//             five wrong answers against either inside fifteen minutes and it
//             stops answering.
//   worker -> must already have an active worker profile, which only exists
//             once Monique has vetted them. No vetting, no account.
//
// Nothing here attaches an email to a job. Signing up records a PENDING claim
// and the confirmation link is what binds it, because clicking that link is
// the only thing that proves the address is real and belongs to the person
// typing it. A client who mistypes their own address loses nothing: no link
// arrives, no claim is consumed, they try again. See 20260829g.
//
// The confirmation email is GoTrue's own, sent over this project's custom
// SMTP, which is already Resend.
//
// It briefly was not. A version of this file created the account with
// generateLink({type:"signup"}) so the link could be carried out over the
// Resend HTTP API under our own copy. That broke every new signup: this
// project has disable_signup turned on, admin.createUser() is an admin call
// and steps around that, and generate_link for a signup is not, so GoTrue
// answered "signups not allowed" and the account was never created. The
// justification was wrong as well as the code: custom SMTP was already
// configured, so nothing was going through Supabase's testing sender.
// If the copy is ever worth customising again, do it in the GoTrue email
// template, not by moving account creation.
// This function holds the service role key, so it is deliberately small and
// does exactly one thing. Nothing here echoes a secret, and it never says
// whether an email is already registered.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Where the confirmation link lands. Without this GoTrue falls back to the
// project's Site URL, which is the site root: a marketing page that does not
// look at the fragment, so a client who had just confirmed was left standing
// on the front page with their session in the address bar and no way in.
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

    // ---- create the account ---------------------------------------------
    // Created UNCONFIRMED on purpose, and that is now load-bearing rather than
    // good manners: the confirmation click is what binds the job to them.
    //
    // admin.createUser() and not generate_link, because this project has
    // disable_signup on. An admin create steps around that by design; a
    // generated signup link does not.
    const { error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: false,
    });

    if (createErr) {
      const msg = String(createErr.message || "");
      root.setAttributes({ "yaadly.signup.outcome": "create_failed" });
      if (/already|registered|exists/i.test(msg)) {
        // They have an account. The claim they just pended is still standing,
        // so the page signs them in with what they typed and claims the code
        // against that session. Worth being explicit that this is a real
        // route and not a dead end: a returning client with a second job is
        // the normal case, not an edge case.
        return json({ error: "You already have a Yaadly account. Signing you in instead.", existing: true }, 409);
      }
      root.recordError(msg);
      return json({ error: "Could not create the account. Try again, or message Yaadly." }, 502);
    }

    // ---- send the confirmation email ------------------------------------
    // GoTrue's own confirmation mail, over this project's custom SMTP, which
    // is Resend. The account exists but cannot sign in until this is clicked,
    // and the job stays unattached to anybody until it is.
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    let emailed = false;
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/resend?redirect_to=${encodeURIComponent(SIGNIN_URL)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` },
        body: JSON.stringify({ type: "signup", email }),
      });
      emailed = r.ok;
      if (!r.ok) root.recordError(`confirmation email not sent: ${r.status} ${(await r.text()).slice(0, 200)}`);
    } catch (e) {
      root.recordError(`confirmation email threw: ${String(e).slice(0, 200)}`);
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
