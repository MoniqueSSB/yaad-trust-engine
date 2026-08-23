import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

// Project Kickoff Pack agent.
//
// Turns a short intake into the document set Yaadly issues at the start of a
// job. It DRAFTS ONLY. Nothing here is client-facing until a named human marks
// the pack approved, and the database enforces that, not this function.
//
// The hard rule encoded in the prompt: no prices, no estimates, no valuations.
// Monique sells project management, procurement and oversight judgment, and
// says so on the website. A generated budget would cross the line her
// professional indemnity position rests on. The pack therefore produces the
// STRUCTURE of money - stages, proportions, evidence gates, a tracking table
// the client fills from their own builder's quote - and never an amount.
//
// v2, 22 Aug 2026: raised the token cap, stripped <think> blocks, extracted
// JSON by balanced braces, named truncation as truncation.
//
// v7, 24 Aug 2026: drafting moved to the BACKGROUND. The first realistic test
// brief (Old Harbour rental renovation) took the model past Supabase's 150s
// request limit; the worker was killed with WORKER_RESOURCE_LIMIT and the
// browser received {"code":546,...} - a body with no "error" key, which the
// desk mistook for success and rendered an empty pack. Now the request
// returns a draft id within a second, the model call runs in
// EdgeRuntime.waitUntil, and the result is written to kickoff_drafts, which
// the desk polls. Every failure path writes status='failed' with the reason,
// so a dead draft is visible instead of silent.

// Provider selection, checked at request time. MiniMax is the DEFAULT by
// Monique's standing decision (23 Aug: "leave NVIDIA, make it better on
// MiniMax") - the mere presence of an NVIDIA key must never hijack the
// draft (v5 did exactly that and a test failed on an NVIDIA 503).
// NVIDIA runs only when explicitly chosen: set the secret PROVIDER=nvidia.
function pickProvider(): { name: string; api: string; key: string; model: string } | null {
  const want = (Deno.env.get("PROVIDER") || "").toLowerCase();
  const nk = Deno.env.get("NVIDIA_API_KEY");
  const mk = Deno.env.get("MINIMAX_API_KEY");
  if (want === "nvidia" && nk) return {
    name: "nvidia",
    api: "https://integrate.api.nvidia.com/v1/chat/completions",
    key: nk,
    model: Deno.env.get("NVIDIA_MODEL") || "nvidia/nemotron-3-ultra-550b-a55b",
  };
  if (mk) return { name: "minimax", api: "https://api.minimax.io/v1/chat/completions", key: mk, model: "MiniMax-M2.7" };
  if (nk) return { name: "nvidia", api: "https://integrate.api.nvidia.com/v1/chat/completions", key: nk,
    model: Deno.env.get("NVIDIA_MODEL") || "nvidia/nemotron-3-ultra-550b-a55b" };
  return null;
}
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `You are the Project Kickoff Agent for Yaadly, a trust-first property works service operating across Jamaica, launching in Kingston and Portmore first. You produce the document set a client receives before any work begins.

WHO YOU ARE WRITING FOR: mostly Jamaican diaspora clients in the UK, US and Canada paying for work on property they own in Jamaica and cannot stand over themselves. They are not construction people. Write plain, warm, direct English. No jargon without explaining it. Never talk down to them.

ABSOLUTE RULES, these override everything else:
1. NEVER state, estimate, guess or imply a price, cost, rate, valuation or budget figure. Not in any currency. Not a range. Not "typically around". Pricing is a quantity surveyor's job and Yaadly does not do it. Where money must be described, describe the STRUCTURE only: stage names, the proportion of the total each stage represents, and what evidence must exist before that stage is released. Use percentages of an unnamed total, never amounts.
2. Yaadly provides observation, documentation and oversight judgment. NOT surveys, valuations, quantity surveying, structural engineering or legal advice. Never write a verdict like "the wall is unsafe". Write what would be observed and what question would be put to the contractor.
3. Never invent facts about this specific job. If the intake does not say, either omit it or write it as a question for the client in the open_questions list.
4. Payment stages must always be tied to evidence, never to elapsed time. Money moves when work is proven, not when a date passes.
5. Flag anything that needs a licensed professional (structural, electrical, plumbing certification, permits, title) as a risk with an owner, rather than absorbing it into Yaadly's scope.

Return STRICT JSON only. No markdown fences, no commentary. Exactly this shape:
{
 "cover_note": "3-4 warm plain-English sentences addressed to the client by name where known: what this pack is, how it protects them, and what happens next. No prices.",
 "scope_of_works": {"summary":"4-6 sentences a non-builder understands: what is wrong today, what will be done about it, in what order, and what the property will be like when it is finished","included":["specific items of work"],"excluded":["what is explicitly not covered"],"assumptions":["what this scope assumes to be true"],"acceptance_criteria":["how each party knows the work is done"]},
 "timeline": {"basis":"2-3 sentences: what the sequence depends on, including the season and weather reality for this specific job","phases":[{"name":"phase name","duration":"working days or weeks, as a range","depends_on":"what must finish first, or Start","milestone":"the observable thing that marks it complete"}]},
 "payment_schedule": {"note":"2-3 sentences: why the money is staged this way for this job, and that no amounts appear here because the client inserts figures from their own contractor quote","stages":[{"stage":"stage name","proportion_percent":0,"release_condition":"the evidence that must be approved before release","evidence_required":["specific photo, video or document"]}],"cost_tracking_template":{"columns":["Stage","Agreed amount (client to enter)","Released to date","Balance remaining","Evidence approved date"],"instruction":"one sentence on how to use it"}},
 "evidence_checklist": [{"stage":"stage name","items":[{"item":"what to capture","type":"photo | video | document","why":"what it proves","timestamped_geotagged":true}]}],
 "document_pack": [{"document":"name of the document to obtain","who_provides":"client | contractor | Yaadly | authority","why":"why it matters","risk_if_missing":"plain consequence"}],
 "risk_register": [{"risk":"what could go wrong","category":"scope | schedule | quality | payment | legal | access | weather | supply","likelihood":"low | medium | high","impact":"low | medium | high","mitigation":"the practical step that reduces it","owner":"who holds it","early_warning_sign":"what would be seen first"}],
 "communications_list": [{"role":"role name","who":"name if stated, otherwise TBC","responsibility":"what they decide or do","contact_method":"how they are reached","update_cadence":"how often they hear from Yaadly"}],
 "open_questions": ["things that must be answered before this pack is issued"],
 "human_review_notes": ["specific things the project manager must personally verify or correct before issuing this to the client"]
}

QUALITY BARS - a pack that misses these is not issuable:
- Write complete sentences everywhere. Specific beats short. Never pad, and never use filler words like "ensure", "appropriate", "as needed", "properly", "high quality".
- Every included and excluded scope item must be concrete to THIS job: name the rooms, elevations, materials or elements involved, never generic lines like "carry out repairs".
- Every acceptance criterion must be observable in a photograph, video or document - something a person overseas could verify from their phone.
- Every mitigation starts with an action verb and names who does it. Every early warning sign is a specific observable event, not a feeling.
- Every evidence item states what would prove the work rather than merely show it: angles, counts, before-and-after pairing, receipts.
- Phases and stages must follow the real build logic of the trade involved (strip before inspect, inspect before cover, prove watertight before finishes, and so on).
- For renovation and build-scale projects, the final stage of the evidence checklist must include one continuous site overview video walking the whole site, and the final payment stage's release condition should note the client may take a live video walkthrough with the worker before approving.
- Aim for 4-7 payment stages, 8-12 risks, and at least one open question. Weight the risk register toward the things that actually go wrong on this kind of job in Jamaica.

Jamaica-specific realities are expected wherever relevant: hurricane season and rain stopping outdoor work, utility connection lead times, JPS and NWC, parish council building approvals, material availability and delivery to site, site access and security, and the client being in a different time zone from the work.`;

function callerJwt(req: Request): { role: string; sub: string } {
  try {
    const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const p = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return { role: p.role || "", sub: p.sub || "" };
  } catch (_) { return { role: "", sub: "" }; }
}

function intakeToPrompt(i: Record<string, unknown>): string {
  const line = (label: string, key: string) => {
    const v = String(i[key] ?? "").trim();
    return v ? `${label}: ${v}` : "";
  };
  return [
    line("Project title", "title"),
    line("Client name", "client_name"),
    line("Client is based", "client_location"),
    line("Property location", "parish"),
    line("Property type", "property_type"),
    line("What the client wants done", "brief"),
    line("Trades likely involved", "trades"),
    line("Client's stated timing", "timing"),
    line("Access and security on site", "access"),
    line("Who is on the ground in Jamaica", "ground_contact"),
    line("Known constraints or worries", "constraints"),
    line("Anything already agreed or started", "already_agreed"),
  ].filter(Boolean).join("\n");
}

// Reasoning models wrap or precede their answer. Remove what is definitely
// not the answer before looking for it.
function stripNoise(s: string): string {
  return String(s)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
}

// Extract the first balanced top-level JSON object, string-aware, so trailing
// prose after the JSON cannot poison the parse the way a greedy regex did.
function extractJson(s: string): Record<string, unknown> | null {
  const text = stripNoise(s);
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, escNext = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escNext) { escNext = false; continue; }
    if (c === "\\") { if (inStr) escNext = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); }
        catch (_) { return null; }
      }
    }
  }
  return null;
}

// Writes to kickoff_drafts go through the service role: RLS lets no client
// touch this table, so the rows can only come from here.
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
async function draftsWrite(method: string, path: string, body: unknown): Promise<Response> {
  return await fetch(`${SB_URL}/rest/v1/kickoff_drafts${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: SB_SERVICE,
      Authorization: `Bearer ${SB_SERVICE}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
}

// The background draft. Runs after the HTTP response has returned, inside
// EdgeRuntime.waitUntil, so the 150s request limit no longer applies to the
// model call. Every exit path updates the row: a draft is never left
// 'drafting' by this code.
async function runDraft(draftId: string, intake: Record<string, unknown>, trace: Trace): Promise<void> {
  const fail = async (msg: string) => {
    console.error("kickoff draft", draftId, "failed:", msg);
    await draftsWrite("PATCH", `?id=eq.${draftId}`, {
      status: "failed", error: msg.slice(0, 500), finished_at: new Date().toISOString(),
    }).catch(() => {});
  };
  try {
    const prov = pickProvider();
    if (!prov) { await fail("No model API key is set on this function. Add MINIMAX_API_KEY in Supabase secrets."); return; }

    const userPrompt = intakeToPrompt(intake);
    let finishReason = "";
    const raw = await trace.span(`chat ${prov.model}`, SpanKind.CLIENT, {
      "gen_ai.system": prov.name,
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": prov.model,
      "gen_ai.request.temperature": 0.3,
      "server.address": new URL(prov.api).hostname,
      "yaadly.agent.name": "kickoff",
      "yaadly.kickoff.draft_id": draftId,
    }, async (s) => {
      const r = await fetch(prov.api, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${prov.key}` },
        body: JSON.stringify({
          model: prov.model,
          temperature: 0.3,
          // A reasoning model spends part of the budget thinking. 14000
          // leaves room for the thinking, the full document set and prose.
          max_tokens: 14000,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: userPrompt.slice(0, 8000) },
          ],
        }),
        signal: AbortSignal.timeout(330_000),
      });
      const j = await r.json();
      s.setAttributes({
        "http.response.status_code": r.status,
        "gen_ai.usage.input_tokens": j?.usage?.prompt_tokens,
        "gen_ai.usage.output_tokens": j?.usage?.completion_tokens,
      });
      if (!r.ok) {
        s.recordError(`${prov.name} http ${r.status}`);
        throw new Error(`Model call failed (${prov.name} ${r.status})`);
      }
      finishReason = j?.choices?.[0]?.finish_reason ?? "";
      return j?.choices?.[0]?.message?.content ?? "";
    });

    const docs = extractJson(String(raw));
    if (!docs) {
      const truncated = finishReason === "length";
      await fail(truncated
        ? "The draft ran out of room before it finished. Trim the intake a little and try again."
        : "The model did not return usable JSON. Try again.");
      return;
    }

    // Guardrail. The model is told never to price; this checks whether it did
    // anyway, and reports it rather than trusting the instruction held.
    const blob = JSON.stringify(docs);
    const priceHits: string[] = [
      ...(blob.match(/(?:J?\$|£|€|USD|JMD|GBP)\s?[\d,]+(?:\.\d+)?/gi) ?? []),
      ...(blob.match(/\b\d[\d,]{2,}(?:\.\d{2})?\s?(?:dollars|pounds|JMD|USD|GBP)\b/gi) ?? []),
    ];
    const priced = priceHits.length > 0;

    const up = await draftsWrite("PATCH", `?id=eq.${draftId}`, {
      status: "ready",
      docs,
      model: prov.model,
      guardrail: {
        price_language_detected: priced,
        samples: priceHits.slice(0, 5),
        note: priced
          ? "The draft contains something that reads like a price. Yaadly does not price work. Remove it before issuing."
          : "No price-like figures found in the draft.",
      },
      finished_at: new Date().toISOString(),
    });
    if (!up.ok) await fail(`Draft finished but could not be saved (db ${up.status}).`);
  } catch (e) {
    await fail(String(e));
  } finally {
    trace.flush();
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-kickoff", req);
  const root = trace.startSpan("POST /yaad-kickoff", SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush(); return res;
  };
  const json = (body: unknown, status = 200) =>
    done(new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } }), status);

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    // Admin session only. These documents are commercial terms for a real client.
    const caller = callerJwt(req);
    if (caller.role !== "authenticated") {
      root.setAttributes({ "yaadly.auth.outcome": "rejected" });
      return json({ error: "Sign in required. The kickoff agent only answers to the Yaadly admin session." }, 401);
    }
    root.setAttributes({ "yaadly.auth.outcome": "authenticated" });

    const body = await req.json().catch(() => ({}));
    const intake = (body && typeof body.intake === "object" && body.intake) ? body.intake : null;
    if (!intake || !String(intake.brief || "").trim()) {
      return json({ error: "Tell the agent what the client wants done. A brief is the minimum." }, 400);
    }
    if (!SB_URL || !SB_SERVICE) {
      return json({ error: "Function is missing its Supabase service configuration." }, 500);
    }

    // Register the draft, hand back its id, and do the slow work after the
    // response. The desk polls kickoff_drafts for the result.
    const ins = await draftsWrite("POST", "", {
      requested_by: caller.sub || crypto.randomUUID(),
      status: "drafting",
      intake,
    });
    if (!ins.ok) {
      const t = await ins.text().catch(() => "");
      console.error("kickoff: could not register draft", ins.status, t.slice(0, 300));
      return json({ error: "Could not register the draft. Try again." }, 500);
    }
    const row = (await ins.json())[0];
    root.setAttributes({
      "yaadly.kickoff.draft_id": row.id,
      "yaadly.kickoff.intake_chars": intakeToPrompt(intake).length,
      "yaadly.kickoff.parish": String(intake.parish || ""),
      "yaadly.kickoff.outcome": "queued",
    });

    const bg = runDraft(row.id, intake, trace);
    const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(bg);

    return json({
      ok: true,
      draftId: row.id,
      status: "drafting",
      note: "Drafting in the background. Poll kickoff_drafts for this id; usually one to three minutes.",
    });
  } catch (e) {
    console.error("kickoff: failed", String(e));
    root.recordError(e);
    return json({ error: String(e) }, 500);
  }
});
