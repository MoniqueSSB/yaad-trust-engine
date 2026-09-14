/* ── yaad-wise-recipient ─────────────────────────────────────────────────────
 *
 * A worker gives their bank details straight to Wise.
 *
 * WHY. Founder, 14 Sep 2026: Yaadly pays workers by bank transfer through its
 * Wise Business account and stores no worker bank details. She asked for a
 * form in the worker portal that puts the details straight into Wise, and
 * accepted the access key risk ("yes on both").
 *
 * WHAT IT DOES. A signed-in worker posts their details. This checks them
 * against Wise's rules for a JMD payment to Jamaica (wise.ts), creates them
 * as a recipient in Yaadly's Wise Business account (POST /v1/accounts), and
 * records only Wise's id for that recipient on the worker's profile
 * (20260914240000). A trigger then clears any earlier call-back, so the
 * founder must phone the worker and press Call-back done before either Mark
 * as sent will work.
 *
 * WHAT IT NEVER DOES. It never stores, logs or traces the details: not in the
 * database, not in console output, not in a span attribute. It sends no
 * money. A UK Wise personal access key cannot fund a transfer (PSD2); money
 * moves only when the founder, signed in to Wise, sends it.
 *
 * THE KEY. WISE_API_TOKEN is a personal access key from Yaadly's Wise
 * Business account, set as a Supabase secret by the founder in her own
 * terminal. It can create and read recipients, so it is as sensitive as the
 * details it handles: never in a file, never in chat. Unset means the form
 * says the feature is not switched on.
 *
 * Runs with the platform's JWT check ON (verify_jwt = true).
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { httpAttrs, SpanKind, Trace } from "./otel.ts";
import { checkBankInput, wiseFieldErrors, wiseRecipientBody } from "./wise.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WISE_BASE = (Deno.env.get("WISE_API_BASE") || "https://api.wise.com").replace(/\/+$/, "");
const NOT_NOW = "Saving bank details is not available right now. Try again later, or ask Yaadly.";

Deno.serve(async (req: Request) => {
  const trace = new Trace("yaad-wise-recipient", req);
  const root = trace.startSpan(`${req.method} /yaad-wise-recipient`, SpanKind.SERVER, httpAttrs(req));
  const done = (body: unknown, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush();
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  const fail = (error: string, status: number, fields?: Record<string, string>) => done({ error, fields: fields ?? {} }, status);

  if (req.method !== "POST") return fail("POST only.", 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return fail("Not configured.", 500);
  const token = Deno.env.get("WISE_API_TOKEN") ?? "";
  if (!token) return fail("Saving bank details is not switched on yet. Yaadly will call you to take them instead.", 503);

  // One place that talks to Wise. The body is never logged.
  const wise = (method: "GET" | "POST", path: string, body?: unknown) =>
    trace.span(`wise ${method} ${path.split("?")[0]}`, SpanKind.CLIENT, { "server.address": new URL(WISE_BASE).host }, async (s) => {
      const r = await fetch(`${WISE_BASE}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      s.setAttributes({ "http.response.status_code": r.status });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) {
        const codes = (Array.isArray(out?.errors) ? out.errors : []).map((e: { code?: string }) => String(e?.code ?? "")).join(",");
        console.error(`yaad-wise-recipient: Wise ${method} ${path.split("?")[0]} answered ${r.status}${codes ? " (" + codes.slice(0, 120) + ")" : ""}`);
      }
      return { ok: r.ok, status: r.status, body: out };
    });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
    const email = (who?.user?.email ?? "").trim().toLowerCase();
    if (whoErr || !email) return fail("Sign in again, then try.", 401);

    const { data: rows, error: rowsErr } = await admin
      .from("worker_profiles").select("id, wise_recipient_set_at").ilike("worker_email", email);
    if (rowsErr) return fail(NOT_NOW, 502);
    if (!rows || !rows.length) return fail("Only a Yaadly tradesperson can give bank details here.", 403);

    // A saved form is not re-sent by a double tap or a script.
    const last = rows.map((r) => Date.parse(String(r.wise_recipient_set_at ?? ""))).filter((t) => !Number.isNaN(t)).sort().pop();
    if (last && Date.now() - last < 2 * 60 * 1000) {
      return fail("Your details were saved a moment ago. Yaadly will call you to check them.", 429);
    }

    const body = await req.json().catch(() => ({}));
    const checked = checkBankInput((body?.details ?? {}) as Record<string, unknown>);
    if (!checked.ok) return fail("Some details need another look.", 422, checked.errors);

    // Yaadly's business profile in Wise: set WISE_PROFILE_ID, or it is found.
    let profileId = Number(Deno.env.get("WISE_PROFILE_ID") ?? "");
    if (!Number.isFinite(profileId) || profileId <= 0) {
      const p = await wise("GET", "/v2/profiles");
      const list = Array.isArray(p.body) ? p.body : [];
      const biz = list.find((x: { type?: string }) => String(x?.type ?? "").toUpperCase() === "BUSINESS");
      profileId = Number(biz?.id ?? 0);
      if (!p.ok || !profileId) return fail(NOT_NOW, 502);
    }

    const made = await wise("POST", "/v1/accounts", wiseRecipientBody(profileId, checked.value));
    if (!made.ok) {
      const fields = wiseFieldErrors(made.body);
      return Object.keys(fields).length
        ? fail("Wise could not accept some of these details.", 422, fields)
        : fail(NOT_NOW, 502);
    }
    const recipientId = String(made.body?.id ?? "");
    if (!recipientId) return fail(NOT_NOW, 502);

    const { error: upErr } = await admin.from("worker_profiles").update({ wise_recipient_id: recipientId }).ilike("worker_email", email);
    if (upErr) {
      console.error(`yaad-wise-recipient: Wise recipient made but not recorded: ${upErr.message}`);
      return fail(NOT_NOW, 502);
    }
    root.setAttributes({ "yaadly.wise.recipient_saved": true });
    return done({ ok: true }, 200);
  } catch (e) {
    console.error("yaad-wise-recipient: threw:", String(e).slice(0, 200));
    root.recordError(e);
    return fail(NOT_NOW, 500);
  }
});
