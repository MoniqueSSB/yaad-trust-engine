import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

const MODEL = "MiniMax-M2.7";
const API = "https://api.minimax.io/v1/chat/completions";

const PROMPTS: Record<string, string> = {
  intake: `You are the Intake Agent for Yaadly, a trust-first property works service in Jamaica (Kingston metro first: Kingston and Portmore). You read a raw message about a property job (English or Jamaican Patois, may be a client WhatsApp message, a voice note transcript, or the founder's rough notes) and produce a structured job card.
Return STRICT JSON only, no markdown fences, exactly this shape:
{"title":"short job title naming the issue","client_name":"client's name if stated","client_phone":"phone or WhatsApp number if stated","client_email":"email address if stated, otherwise empty string","trade":"main trade needed","parish":"place if stated","urgency":"their words for timing","preferred_date":"any specific date or time they want the work done, as stated","scope":"clear plain-English scope of works, 2-4 sentences","questions":["up to 3 questions Yaadly should ask before quoting, and if no email was given, one of them must ask for the client's email so they can access their portal"]}
Rules: never invent facts; if a field is not in the message use "". Extract names carefully: "mi name Marcia" or "this is Marcia" means client_name is "Marcia"; a relative mentioned ("mi aunty") is not the client unless stated. Do not estimate any price. Keep the client's meaning, not their exact slang.`,
  report: `You are the Reporting Agent for Yaadly. Draft a short, warm WhatsApp update from Yaadly to the client using ONLY the facts given. Plain text, no markdown. Never promise dates or amounts that are not in the facts. Never mention percentages or fees. End with one clear next step for the client. Sign off as Yaadly.`
};

function callerRole(req: Request): string {
  try {
    const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role || "";
  } catch (_) { return ""; }
}

function callerEmail(req: Request): string {
  try {
    const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.email || "";
  } catch (_) { return ""; }
}

// Who may use the agents: the Yaadly admin, or a client who has a profile and
// has signed the CURRENT Client Guidelines version. The rule lives in Postgres
// (may_use_agents) so it cannot drift between here and yaad-vision.
async function callerMayUse(req: Request): Promise<boolean> {
  try {
    const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!tok || !url || !anon) return false;
    const r = await fetch(`${url}/rest/v1/rpc/may_use_agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ p_email: callerEmail(req) }),
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
    if (callerRole(req) !== "authenticated") {
      root.setAttributes({ "yaadly.auth.outcome": "rejected" });
      return done(new Response(JSON.stringify({ error: "Sign in required." }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } }), 401);
    }
    if (!(await callerMayUse(req))) {
      root.setAttributes({ "yaadly.auth.outcome": "not_permitted" });
      return done(new Response(JSON.stringify({ error: "Complete your client profile and sign the current Client Guidelines to use this." }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } }), 403);
    }
    root.setAttributes({ "yaadly.auth.outcome": "authenticated" });

    const { mode, text } = await req.json();
    const resolvedMode = PROMPTS[mode] ? mode : "intake";
    root.setAttributes({ "yaadly.agent.mode": resolvedMode, "yaadly.input.chars": String(text || "").length });

    const key = Deno.env.get("MINIMAX_API_KEY");
    if (!key) {
      root.setAttributes({ "yaadly.config.missing": "MINIMAX_API_KEY" });
      root.recordError("MINIMAX_API_KEY secret is not set");
      return done(new Response(JSON.stringify({ error: "MINIMAX_API_KEY secret is not set in Edge Function secrets" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } }), 500);
    }
    const sys = PROMPTS[resolvedMode];

    // GenAI semantic conventions, so this span is recognised as a model call.
    const out = await trace.span(`chat ${MODEL}`, SpanKind.CLIENT, {
      "gen_ai.system": "minimax",
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": MODEL,
      "gen_ai.request.temperature": 0.2,
      "server.address": "api.minimax.io",
    }, async (s) => {
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: String(text || "").slice(0, 6000) }
          ],
          temperature: 0.2
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
      if (!r.ok) s.recordError(`minimax http ${r.status}`);
      return j?.choices?.[0]?.message?.content ?? JSON.stringify(j);
    });

    root.setAttributes({ "yaadly.output.chars": String(out || "").length });
    return done(new Response(JSON.stringify({ result: out }), { headers: { ...cors, "Content-Type": "application/json" } }), 200);
  } catch (e) {
    root.recordError(e);
    return done(new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } }), 500);
  }
});
