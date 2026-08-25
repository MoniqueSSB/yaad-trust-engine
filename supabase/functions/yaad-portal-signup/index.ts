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
//   client -> must present the portal code for a job or service that carries
//             their email. verify_portal_code() also rate limits: five wrong
//             answers for one email inside fifteen minutes and it stops
//             answering.
//   worker -> must already have an active worker profile, which only exists
//             once Monique has vetted them. No vetting, no account. That is
//             the same rule the site already promises clients.
//
// This function holds the service role key, so it is deliberately small and
// does exactly one thing. Nothing here echoes a secret, and it never says
// whether an email is already registered.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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

      const { data: ok, error } = await admin.rpc("verify_portal_code", { p_email: email, p_code: code });
      if (error) {
        root.recordError(error.message);
        return json({ error: "Could not check that code. Try again shortly." }, 502);
      }
      if (ok !== true) {
        root.setAttributes({ "yaadly.signup.outcome": "code_rejected" });
        return json({ error: "That code and email do not match a job we hold. Check both, or message Yaadly." }, 403);
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
    // Created UNCONFIRMED on purpose. The portal code proves which job they
    // are attached to; it does not prove they can read that mailbox. A real
    // confirmation email does, and it is also the thing people expect to see.
    const { error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: false,
    });

    if (createErr) {
      const msg = String(createErr.message || "");
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
    // The account exists but cannot sign in until this link is clicked.
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    let emailed = false;
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/resend`, {
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
    return json({ ok: true, emailed: true, message: `Check ${email} for a confirmation link, then sign in.` });
  } catch (e) {
    root.recordError(e);
    return json({ error: "Something went wrong. Try again, or message Yaadly." }, 500);
  }
});
