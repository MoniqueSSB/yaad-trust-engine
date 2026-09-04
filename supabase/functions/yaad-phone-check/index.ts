/* ── yaad-phone-check ──────────────────────────────────────────────────────
 *
 * Is this a real number, and can it receive WhatsApp?
 *
 * WHY IT EXISTS. A worker's entire surface is WhatsApp, by design (CLAUDE.md
 * section 9). Everything reaches them there: the quote pack, the Kickoff Pack
 * confirmation, the daily check-in, the prompt to send evidence, the draft
 * report they have to approve before a client sees it. All of it goes to
 * worker_profiles.phone, which they type into a form themselves.
 *
 * If they type a landline, or transpose a digit, none of it arrives and
 * nothing anywhere says so. The job simply goes quiet, and the first person to
 * notice is the client wondering why nobody turned up. That is the failure
 * this closes, and it closes it at the one moment it is cheap to fix: while
 * they are still looking at the form.
 *
 * IT ALSO FIXES THE STORED SHAPE. link_worker_phone() strips a number to bare
 * digits, so "876 555 1234" becomes 8765551234 while Twilio delivers
 * 18765551234 for the same person. That mismatch is the whole reason phone
 * matching was ever written as "the last nine digits", the rule 20260904b had
 * to replace because it made two numbers in different countries one person.
 * Lookup returns proper E.164, so the number goes in normalised and the
 * mismatch stops being created.
 *
 * WHY A FUNCTION AND NOT A SERVER ACTION. The Twilio credentials live as
 * Supabase secrets and nowhere else. The web app runs on Cloudflare Workers
 * and does not have them, and copying a credential into a second place to save
 * one HTTP hop is a bad trade: one home for a secret is worth more than one
 * less request.
 *
 * verify_jwt stays TRUE. Deploy with no flag. Lookup costs money per call, so
 * this is not an endpoint to leave open, and the only legitimate caller is a
 * signed-in worker looking at their own form.
 *
 * IT NEVER BLOCKS ON ITS OWN. It reports. The caller decides what to do with
 * "this looks like a landline", because a worker who genuinely has no mobile
 * is a business problem rather than a validation error, and refusing them at a
 * form is not this function's call to make.
 */

import { httpAttrs, SpanKind, Trace } from "./otel.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Verdict = {
  ok: boolean;
  valid: boolean;
  /** Proper E.164, e.g. +18765551234. Empty when Twilio could not parse it. */
  e164: string;
  /** mobile, landline, voip, or "" when the lookup did not say. */
  lineType: string;
  /** Our reading of it, in words a person can act on. */
  note: string;
  /** True only when we positively believe WhatsApp cannot reach it. */
  unreachable: boolean;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-phone-check", req);
  const root = trace.startSpan(`${req.method} /yaad-phone-check`, SpanKind.SERVER, httpAttrs(req));
  const json = (b: unknown, status = 200) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush();
    return new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  };

  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const raw = String(body.phone ?? "").trim();
    // Jamaica by default, because that is where every worker is. A number
    // already in E.164 ignores this entirely.
    const country = (String(body.country ?? "JM").trim().toUpperCase() || "JM").slice(0, 2);
    if (!raw) return json({ error: "No number given." }, 400);

    const sid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
    const tok = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
    if (!sid || !tok) {
      // Unconfigured is not invalid. Say so plainly and let the caller carry
      // on rather than blocking a worker over our own missing secret.
      root.setAttributes({ "yaadly.lookup.configured": false });
      return json({
        ok: false, valid: true, e164: "", lineType: "", unreachable: false,
        note: "The number was not checked, because Twilio lookup is not configured.",
      } satisfies Verdict);
    }

    const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(raw)}`
      + `?Fields=line_type_intelligence&CountryCode=${encodeURIComponent(country)}`;

    const r = await trace.span("twilio.lookup", SpanKind.CLIENT, {
      "server.address": "lookups.twilio.com",
    }, async (s) => {
      const res = await fetch(url, {
        headers: { Authorization: "Basic " + btoa(`${sid}:${tok}`) },
        signal: AbortSignal.timeout(8000),
      });
      s.setAttributes({ "http.response.status_code": res.status });
      return res;
    });

    // 404 is Twilio's answer for "that is not a number", not an error.
    if (r.status === 404) {
      root.setAttributes({ "yaadly.lookup.valid": false });
      return json({
        ok: true, valid: false, e164: "", lineType: "", unreachable: true,
        note: "That does not look like a real phone number. Check it and try again.",
      } satisfies Verdict);
    }
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 200);
      root.recordError(`lookup ${r.status}: ${detail}`);
      console.error(`yaad-phone-check: lookup ${r.status}: ${detail}`);
      return json({
        ok: false, valid: true, e164: "", lineType: "", unreachable: false,
        note: "The number could not be checked just now.",
      } satisfies Verdict);
    }

    const d = await r.json() as {
      valid?: boolean; phone_number?: string;
      line_type_intelligence?: { type?: string } | null;
    };
    const valid = d.valid === true;
    const lineType = String(d.line_type_intelligence?.type ?? "").toLowerCase();
    // Only these two are positively unable to hold a WhatsApp account. An
    // empty type means the lookup did not say, which is not the same as no,
    // and must never be treated as one.
    const unreachable = !valid || lineType === "landline" || lineType === "fixedVoip".toLowerCase();

    root.setAttributes({
      "yaadly.lookup.valid": valid, "yaadly.lookup.line_type": lineType || "unknown",
    });

    return json({
      ok: true,
      valid,
      e164: valid ? String(d.phone_number ?? "") : "",
      lineType,
      unreachable,
      note: !valid
        ? "That does not look like a real phone number. Check it and try again."
        : lineType === "landline"
        ? "That looks like a landline. WhatsApp needs a mobile, and everything Yaadly sends you goes there."
        : lineType === "mobile"
        ? "That is a mobile and it checks out."
        : "The number checks out.",
    } satisfies Verdict);
  } catch (e) {
    root.recordError(e);
    console.error("yaad-phone-check: threw:", String(e).slice(0, 300));
    return json({
      ok: false, valid: true, e164: "", lineType: "", unreachable: false,
      note: "The number could not be checked just now.",
    } satisfies Verdict);
  }
});
