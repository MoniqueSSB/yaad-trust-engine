import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";
import { pickTextProvider, providerAttrs, NO_PROVIDER_MESSAGE } from "./textmodel.ts";

// Model and endpoint come from _shared/textmodel.ts. See that file for why.

const PROMPTS: Record<string, string> = {
  intake: `You are the Intake Agent for Yaadly, a trust-first property works service in Jamaica (Kingston metro first: Kingston and Portmore). You read a raw message about a property job (English or Jamaican Patois, may be a client WhatsApp message, a voice note transcript, or the founder's rough notes) and produce a structured job card.
Return STRICT JSON only, no markdown fences, exactly this shape:
{"title":"short job title naming the issue","client_name":"client's name if stated","client_phone":"phone or WhatsApp number if stated","client_email":"email address if stated, otherwise empty string","trade":"main trade needed, chosen ONLY from the TRADES list given below","parish":"place if stated","urgency":"their words for timing","preferred_date":"any specific date or time they want the work done, as stated","scope":"clear plain-English scope of works, 2-4 sentences","questions":["up to 3 questions Yaadly should ask before quoting, and if no email was given, one of them must ask for the client's email so they can access their portal"]}
Rules: never invent facts; if a field is not in the message use "". Extract names carefully: "mi name Marcia" or "this is Marcia" means client_name is "Marcia"; a relative mentioned ("mi aunty") is not the client unless stated. Do not estimate any price. Keep the client's meaning, not their exact slang.`,
  classify: `You are the Trade Classifier for Yaadly, a property works service in Jamaica. You are given a raw description of a property job, in English or Jamaican Patois. You decide which single trade it needs.
Return STRICT JSON only, no markdown fences, exactly this shape:
{"trade":"one value copied EXACTLY from the TRADES list","confidence":"high|medium|low","second_choice":"another value from TRADES, or empty string","reason":"one short sentence, max 15 words, naming the words in the description that decided it"}
Rules. The value of "trade" MUST be copied character for character from the TRADES list you are given. Never invent a trade, never return a plural, never return a trade that is not on the list. If the job clearly needs more than one trade, return the one that must happen FIRST and put the other in second_choice. If the description is too vague to tell, return "handyman" with confidence "low". Never estimate a price. Never comment on the client.`,
  report: `You are the Reporting Agent for Yaadly. Draft a short, warm WhatsApp update from Yaadly to the client using ONLY the facts given. Plain text, no markdown. Never promise dates or amounts that are not in the facts. Never mention percentages or fees. End with one clear next step for the client. Sign off as Yaadly.`
};

// Who is calling, asked of Supabase rather than read off the token.
//
// This used to decode the JWT payload with atob() and trust what it said, in
// two places: callerRole() for the role, and callerEmail() for the email that
// was then handed to may_use_agents() as the thing being authorised. The
// second is the worse of the two, because a self-reported email as the input
// to a permission check means the caller nominates who they are.
//
// Nothing was exploitable: this function is deployed with verify_jwt = true,
// so the platform checks the signature before the code runs. But that made an
// unverified decode safe by accident rather than by design, and the README in
// this folder tells a future reader that some functions "must stay false".
// Anyone applying that here would have turned a belt-and-braces check into the
// only check, and it does not work. getUser() asks the auth server, so it is
// right either way.
async function callerIdentity(req: Request): Promise<{ email: string } | null | "misconfigured"> {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
  // "We cannot check" is not "they are not signed in". See yaad-completion.
  if (!url || !anon) return "misconfigured";
  if (!tok) return null;
  try {
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${tok}` },
    });
    if (!r.ok) return null;
    const u = await r.json();
    const email = String(u?.email ?? "").trim();
    return email ? { email } : null;
  } catch (_) { return null; }
}

// Who may use the agents: the Yaadly admin, or a client who has a profile and
// has signed the CURRENT Client Guidelines version. The rule lives in Postgres
// (may_use_agents) so it cannot drift between here and yaad-vision. The email
// passed in is the verified one, never the one the caller typed.
async function callerMayUse(req: Request, email: string): Promise<boolean> {
  try {
    const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!tok || !url || !anon) return false;
    const r = await fetch(`${url}/rest/v1/rpc/may_use_agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ p_email: email }),
    });
    return r.ok && (await r.json()) === true;
  } catch (_) { return false; }
}


Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const trace = new Trace("yaad-agent", req);
  const root = trace.startSpan("POST /yaad-agent", SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end();
    trace.flush();
    return res;
  };

  try {
    const who = await callerIdentity(req);
    if (who === "misconfigured") {
      root.recordError("SUPABASE_URL or SUPABASE_ANON_KEY missing; cannot verify the caller");
      return done(new Response(JSON.stringify({ error: "Sign in cannot be checked right now. This is a Yaadly problem, not yours." }), { status: 503, headers: { ...cors, "Content-Type": "application/json" } }), 503);
    }
    if (!who) {
      root.setAttributes({ "yaadly.auth.outcome": "rejected" });
      return done(new Response(JSON.stringify({ error: "Sign in required." }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } }), 401);
    }
    if (!(await callerMayUse(req, who.email))) {
      root.setAttributes({ "yaadly.auth.outcome": "not_permitted" });
      return done(new Response(JSON.stringify({ error: "Complete your client profile and sign the current Client Guidelines to use this." }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } }), 403);
    }
    root.setAttributes({ "yaadly.auth.outcome": "authenticated" });

    const { mode, text, job_id } = await req.json();
    const resolvedMode = PROMPTS[mode] ? mode : "intake";

    // The canonical trade list lives in app_settings so the prompt and
    // trade_key() in Postgres cannot drift apart. If it is missing we fall
    // back to the same list the migration seeds.
    const TRADES_FALLBACK = "plumbing,electrical,roofing,tiling,masonry,painting,grille and gate,air conditioning,carpentry,landscaping,security,windows,handyman";
    let tradeList = TRADES_FALLBACK;
    if (resolvedMode === "classify" || resolvedMode === "intake") {
      try {
        const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
        const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
        const r = await fetch(`${url}/rest/v1/app_settings?key=eq.trade_list&select=value`, {
          headers: { apikey: anon!, Authorization: `Bearer ${tok}` },
        });
        if (r.ok) { const j = await r.json(); if (j?.[0]?.value) tradeList = j[0].value; }
      } catch (_) { /* fallback stands */ }
    }
    root.setAttributes({ "yaadly.agent.mode": resolvedMode, "yaadly.input.chars": String(text || "").length });

    const prov = pickTextProvider();
    if (!prov) {
      root.setAttributes({ "yaadly.config.missing": "MISTRAL_API_KEY" });
      root.recordError("no text model is configured");
      return done(new Response(JSON.stringify({ error: NO_PROVIDER_MESSAGE }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } }), 500);
    }
    const sys = (resolvedMode === "classify" || resolvedMode === "intake")
      ? PROMPTS[resolvedMode] + `\n\nTRADES (the only permitted values): ${tradeList}`
      : PROMPTS[resolvedMode];

    // GenAI semantic conventions, so this span is recognised as a model call.
    const out = await trace.span(`chat ${prov.model}`, SpanKind.CLIENT, {
      ...providerAttrs(prov),
      "gen_ai.operation.name": "chat",
      "gen_ai.request.temperature": resolvedMode === "classify" ? 0 : 0.2,
    }, async (s) => {
      const r = await fetch(prov.api, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${prov.key}` },
        body: JSON.stringify({
          model: prov.model,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: String(text || "").slice(0, 6000) }
          ],
          temperature: resolvedMode === "classify" ? 0 : 0.2
        })
      });
      const j = await r.json();
      s.setAttributes({
        "http.response.status_code": r.status,
        "gen_ai.response.model": j?.model,
        "gen_ai.response.finish_reasons": j?.choices?.[0]?.finish_reason,
        "gen_ai.usage.input_tokens": j?.usage?.prompt_tokens,
        "gen_ai.usage.output_tokens": j?.usage?.completion_tokens,
      });
      if (!r.ok) s.recordError(`${prov.name} http ${r.status}`);
      return j?.choices?.[0]?.message?.content ?? JSON.stringify(j);
    });

    root.setAttributes({ "yaadly.output.chars": String(out || "").length });

    // ---- classify: validate, then persist -----------------------------
    if (resolvedMode === "classify") {
      const allowed = tradeList.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
      let parsed: Record<string, string> = {};
      try {
        parsed = JSON.parse(String(out).replace(/^```(json)?|```$/g, "").trim());
      } catch (_) { parsed = {}; }

      let trade = String(parsed.trade ?? "").trim().toLowerCase();
      let source = "model";

      // The model went off-list, or gave us nothing. Fall back to the
      // Postgres regex rather than failing the job. A roughly-right trade
      // beats no trade: a job with no trade matches nobody.
      if (!allowed.includes(trade)) {
        root.setAttributes({ "yaadly.classify.offlist": trade || "(empty)" });
        source = "regex";
        trade = "";
      }

      root.setAttributes({
        "yaadly.classify.trade": trade,
        "yaadly.classify.confidence": String(parsed.confidence ?? ""),
        "yaadly.classify.source": source,
      });

      let written: unknown = null;
      if (job_id) {
        try {
          const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
          const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
          if (source === "regex") {
            // No usable model answer. Hand the raw description to Postgres and
            // let set_job_trade normalise it through trade_key().
            //
            // Deliberately NOT backfill_missing_trades: that rewrites EVERY
            // job with a blank trade, so classifying one job would have
            // silently set trades on all the others. It is also service_role
            // only, so this call would have failed anyway.
            const rw = await fetch(`${url}/rest/v1/rpc/set_job_trade`, {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: anon!, Authorization: `Bearer ${tok}` },
              body: JSON.stringify({ p_job: job_id, p_trade: String(text ?? ""), p_source: "regex" }),
            });
            written = rw.ok ? await rw.json() : { error: `http ${rw.status}` };
          } else {
            const rw = await fetch(`${url}/rest/v1/rpc/set_job_trade`, {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: anon!, Authorization: `Bearer ${tok}` },
              body: JSON.stringify({ p_job: job_id, p_trade: trade, p_source: source }),
            });
            written = rw.ok ? await rw.json() : { error: `http ${rw.status}` };
          }
        } catch (e) {
          written = { error: String(e) };
          root.recordError(`set_job_trade failed: ${e}`);
        }
      }

      return done(new Response(JSON.stringify({
        result: out,
        trade,
        source,
        confidence: parsed.confidence ?? "",
        second_choice: parsed.second_choice ?? "",
        reason: parsed.reason ?? "",
        job_id: job_id ?? null,
        written,
      }), { headers: { ...cors, "Content-Type": "application/json" } }), 200);
    }

    return done(new Response(JSON.stringify({ result: out }), { headers: { ...cors, "Content-Type": "application/json" } }), 200);
  } catch (e) {
    root.recordError(e);
    return done(new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } }), 500);
  }
});
