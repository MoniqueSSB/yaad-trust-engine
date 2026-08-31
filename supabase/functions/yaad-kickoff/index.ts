import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";
import { pickTextProvider, providerAttrs, type TextProvider, NO_PROVIDER_MESSAGE } from "./textmodel.ts";
import * as guardrails from "./guardrails.ts";

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
//
// v12, 24 Aug 2026: model shootout plumbing. The desk can pass an OpenRouter
// model slug per draft (admin session only, slug shape validated), so the
// same brief can be drafted by MiniMax M2.7, GLM 5.2, Kimi K3 and DeepSeek
// V4 Pro and the packs read side by side. Requires the OPENROUTER_API_KEY
// secret; without it the override is refused with a plain message. The
// default remains MiniMax direct, per the standing decision.
//
// v11, 24 Aug 2026: the v10 budgets made part A too slow for one worker; a
// rich-brief draft was culled at the background worker's 400 second lifetime
// with the row left 'drafting'. The pack now drafts as FOUR parallel parts
// (cover+scope / timeline+questions+notes / payments+evidence / documents+
// risks+comms), so the slowest part carries a third less writing. A foreign
// text guardrail also flags any CJK characters in the draft: MiniMax leaked
// "\u8fde\u7eed" into a v9 risk register and nothing caught it.
//
// v10, 24 Aug 2026: the writing bar raised to the worked example Monique
// approved ("Yaadly Kickoff Pack - Old Harbour"): a personal multi-paragraph
// cover note that answers the client's stated fear, scope prose that explains
// the order the building demands, a diagnosis-and-decision gate wherever the
// job opens something up, weighting rationale on the payment stages, open
// questions that each carry their reason, and early warnings that are
// concretely observable events. Per-part token budgets raised to give the
// writing room.
//
// v9, same night: ONE model call for the whole pack was still too slow. The
// smoke brief drafted in ~100s, but the Old Harbour brief ran past the
// background worker's own lifetime and was culled silently at ~6 minutes.
// The pack is therefore drafted as THREE PARALLEL calls - (A) cover, scope,
// timeline, open questions, review notes; (B) payment schedule and evidence
// checklist, which share stage names and so must come from one mind; (C)
// document pack, risk register, communications - merged into one document
// set. Wall time drops to the slowest third. Same table, same polling desk;
// MiniMax stays the model, per the standing decision.

// Provider selection, checked at request time. MiniMax is the DEFAULT by
// Monique's standing decision (23 Aug: "leave NVIDIA, make it better on
// MiniMax") - the mere presence of an NVIDIA key must never hijack the
// draft (v5 did exactly that and a test failed on an NVIDIA 503).
// NVIDIA runs only when explicitly chosen: set the secret PROVIDER=nvidia.
function pickProvider(override?: string): TextProvider | null {
  if (override) {
    const ork = Deno.env.get("OPENROUTER_API_KEY");
    if (!ork) return null;
    return { name: "openrouter", api: "https://openrouter.ai/api/v1/chat/completions", key: ork, model: override, region: "unstated" };
  }
  const want = (Deno.env.get("PROVIDER") || "").toLowerCase();
  const nk = Deno.env.get("NVIDIA_API_KEY");
  const nvidia = (): TextProvider | null => nk
    ? { name: "nvidia", api: "https://integrate.api.nvidia.com/v1/chat/completions", key: nk,
        model: Deno.env.get("NVIDIA_MODEL") || "nvidia/nemotron-3-ultra-550b-a55b", region: "us" }
    : null;

  if (want === "nvidia") { const n = nvidia(); if (n) return n; }

  // The ordinary path. Shared with the other seven functions so the EU move
  // is one secret, not eight edits.
  return pickTextProvider() ?? nvidia();
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
 "cover_note": "3 to 5 short paragraphs addressed to the client by name where known, separated by \\n\\n. Name the specific fear or constraint the intake states and answer it directly. Explain in plain words that no figures appear anywhere in this pack and why, and that the client drops their own contractor's figures into the tracking table. Close with exactly what happens next before anything is instructed. Warm, direct, never salesy. No prices.",
 "scope_of_works": {"summary":"3 to 4 short paragraphs separated by \\n\\n, written for a non-builder: what is wrong today, in plain words; the order the work will run in and WHY the building demands that order (open up before diagnosing, diagnose before repairing, prove watertight before covering, decorate last); anything inspected but not worked on, framed explicitly as an inspection and not a work item; and what the property will be like when it is finished","included":["specific items of work"],"excluded":["what is explicitly not covered"],"assumptions":["what this scope assumes to be true"],"acceptance_criteria":["how each party knows the work is done"]},
 "timeline": {"basis":"3 to 5 sentences: what the sequence depends on, including the season and weather reality for this specific job, which phases are rain-stoppable and how the programme absorbs that without stopping internal work, and what site access assumes. Wherever the job involves opening something up or an unknown, the phases MUST include a dedicated diagnosis-and-client-decision phase between opening up and repair, so nothing is bought or covered before the client has instructed in writing","phases":[{"name":"phase name","duration":"working days or weeks, as a range","depends_on":"what must finish first, or Start","milestone":"the observable thing that marks it complete"}]},
 "payment_schedule": {"note":"2 to 3 short paragraphs separated by \\n\\n: why the money is staged this way for THIS job, naming which stages are deliberately weighted and the reason (an opening-up stage paid early and generously so the contractor has every reason to open up fully; a final stage held back so the retention still has something in it), and that no amounts appear because the client inserts figures from their own contractor quote","stages":[{"stage":"stage name","proportion_percent":0,"release_condition":"the evidence that must be approved before release","evidence_required":["specific photo, video or document"]}],"cost_tracking_template":{"columns":["Stage","Agreed amount (client to enter)","Released to date","Balance remaining","Evidence approved date"],"instruction":"one sentence on how to use it"}},
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
- Aim for 5-7 payment stages, 9-12 risks, and 8-16 open questions. Weight the risk register toward the things that actually go wrong on this kind of job in Jamaica.
- Every open question carries its reason in the same breath: not "Is the property insured?" but "Is the property currently insured, and does the insurer know it is unoccupied and about to be renovated?" Wherever the intake leaves them open, the questions must cover: authority or title to instruct the works, utility account status and reconnection, insurance for an unoccupied property under renovation, whether the stated deadline is a commitment to someone else or a preference, and the burden falling on any single named person on the ground.
- Every early warning sign is a concretely observable event someone could screenshot or photograph: a specific phrase appearing in a message, a missed weekly photograph, a request for money accompanied by an explanation instead of evidence. Never a feeling or a tendency.
- Where one named person controls site access, their availability and the unpaid burden on them is itself a risk with a named mitigation. Where the client is overseas, decision latency across time zones is itself a risk with a batching mitigation.
- Write as if the pack will be read aloud to a nervous first-time client. Every sentence should survive that reading.
- Write in English only, throughout. No characters from any other script, anywhere in the output.

Jamaica-specific realities are expected wherever relevant: hurricane season and rain stopping outdoor work, utility connection lead times, JPS and NWC, parish council building approvals, material availability and delivery to site, site access and security, and the client being in a different time zone from the work.`;

function callerJwt(req: Request): { role: string; sub: string } {
  try {
    const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const p = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return { role: p.role || "", sub: p.sub || "" };
  } catch (_) { return { role: "", sub: "" }; }
}

async function callerIsAdmin(req: Request): Promise<boolean> {
  try {
    const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!tok || !url || !anon) return false;
    const r = await fetch(`${url}/rest/v1/rpc/is_admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${tok}` },
      body: "{}",
    });
    return r.ok && (await r.json()) === true;
  } catch (_) { return false; }
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

// The pack in three parts. B keeps payment_schedule and evidence_checklist
// together on purpose: they share stage names, and two separate calls would
// invent two different stage lists.
const PARTS: { name: string; keys: string[]; maxTokens: number }[] = [
  { name: "A1", keys: ["cover_note", "scope_of_works"], maxTokens: 6000 },
  { name: "A2", keys: ["timeline", "open_questions", "human_review_notes"], maxTokens: 6000 },
  { name: "B", keys: ["payment_schedule", "evidence_checklist"], maxTokens: 7000 },
  { name: "C", keys: ["document_pack", "risk_register", "communications_list"], maxTokens: 8000 },
];
const ALL_KEYS = PARTS.flatMap((p) => p.keys);

async function draftPart(
  prov: TextProvider,
  userPrompt: string,
  part: { name: string; keys: string[]; maxTokens: number },
  trace: Trace,
): Promise<Record<string, unknown>> {
  let finishReason = "";
  const raw = await trace.span(`chat ${prov.model} part ${part.name}`, SpanKind.CLIENT, {
    ...providerAttrs(prov),
    "gen_ai.operation.name": "chat",
    "gen_ai.request.temperature": 0.3,
    "yaadly.agent.name": "kickoff",
    "yaadly.kickoff.part": part.name,
  }, async (s) => {
    const r = await fetch(prov.api, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${prov.key}` },
      body: JSON.stringify({
        model: prov.model,
        temperature: 0.3,
        max_tokens: part.maxTokens,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content:
            userPrompt.slice(0, 8000) +
            "\n\nFOR THIS RESPONSE ONLY: return STRICT JSON with EXACTLY these top-level keys and no others: " +
            part.keys.join(", ") +
            ". Follow the shape defined for those keys in the schema above. The remaining sections are being drafted separately; do not mention or include them." },
        ],
      }),
      signal: AbortSignal.timeout(300_000),
    });
    const j = await r.json();
    s.setAttributes({
      "http.response.status_code": r.status,
      "gen_ai.usage.input_tokens": j?.usage?.prompt_tokens,
      "gen_ai.usage.output_tokens": j?.usage?.completion_tokens,
    });
    if (!r.ok) {
      s.recordError(`${prov.name} http ${r.status}`);
      throw new Error(`part ${part.name}: model call failed (${prov.name} ${r.status})`);
    }
    finishReason = j?.choices?.[0]?.finish_reason ?? "";
    return j?.choices?.[0]?.message?.content ?? "";
  });
  const parsed = extractJson(String(raw));
  if (!parsed) {
    throw new Error(finishReason === "length"
      ? `part ${part.name}: ran out of room before it finished`
      : `part ${part.name}: did not return usable JSON`);
  }
  const missing = part.keys.filter((k) => !(k in parsed));
  if (missing.length) throw new Error(`part ${part.name}: missing sections ${missing.join(", ")}`);
  return parsed;
}

// The background draft. Runs after the HTTP response has returned, inside
// EdgeRuntime.waitUntil, so the 150s request limit no longer applies to the
// model calls. Every exit path updates the row: a draft is never left
// 'drafting' by this code (short of the platform culling the worker, which
// the desk's own 8 minute cutoff reports).
async function runDraft(draftId: string, intake: Record<string, unknown>, trace: Trace, overrideModel?: string): Promise<void> {
  const fail = async (msg: string) => {
    console.error("kickoff draft", draftId, "failed:", msg);
    await draftsWrite("PATCH", `?id=eq.${draftId}`, {
      status: "failed", error: msg.slice(0, 500), finished_at: new Date().toISOString(),
    }).catch(() => {});
  };
  try {
    const prov = pickProvider(overrideModel);
    if (!prov) { await fail(overrideModel
      ? "A model override needs the OPENROUTER_API_KEY secret, which is not set."
      : NO_PROVIDER_MESSAGE); return; }

    const userPrompt = intakeToPrompt(intake);
    const partDocs = await Promise.all(PARTS.map((p) => draftPart(prov, userPrompt, p, trace)));
    const docs: Record<string, unknown> = Object.assign({}, ...partDocs);
    const absent = ALL_KEYS.filter((k) => !(k in docs));
    if (absent.length) { await fail(`Merged draft is missing sections: ${absent.join(", ")}`); return; }

    // Guardrail. The model is told never to price; this checks whether it did
    // anyway, and reports it rather than trusting the instruction held.
    const blob = JSON.stringify(docs);
    const priceHits: string[] = [
      ...(blob.match(/(?:J?\$|£|€|USD|JMD|GBP)\s?[\d,]+(?:\.\d+)?/gi) ?? []),
      ...(blob.match(/\b\d[\d,]{2,}(?:\.\d{2})?\s?(?:dollars|pounds|JMD|USD|GBP)\b/gi) ?? []),
    ];
    const priced = priceHits.length > 0;
    // MiniMax is a Chinese model and can leak CJK fragments into English
    // prose (it did, once). Flag them; the desk shows the samples.
    const cjkHits = blob.match(/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]+/g) ?? [];

    // Banned language, same list as the Python engine. Flags rather than
    // blocks: nothing here is client-facing until a named human marks it so.
    const bannedHits = guardrails.scan(blob);

    const up = await draftsWrite("PATCH", `?id=eq.${draftId}`, {
      status: "ready",
      docs,
      model: prov.model,
      guardrail: {
        price_language_detected: priced,
        samples: priceHits.slice(0, 5),
        foreign_text_detected: cjkHits.length > 0,
        foreign_samples: cjkHits.slice(0, 5),
        banned_language_detected: bannedHits.length > 0,
        banned_samples: [...new Set(bannedHits.map((f) => f.term))].slice(0, 5),
        banned_note: bannedHits.length
          ? "The draft uses language Yaadly never uses: " + [...new Set(bannedHits.map((f) => f.guidance))].join(" ") + " Fix it before issuing."
          : "No banned language found in the draft.",
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

    // Admin session, or this repository's own automation, calling as the
    // service role. Nothing weaker than that: these documents are
    // commercial terms for a real client. verify_jwt stays on for this
    // function, so by the time this code runs the platform has already
    // confirmed whichever JWT arrived was genuinely signed by Supabase;
    // this only reads the role it already verified, the same trust the
    // "authenticated" branch below already relied on.
    const caller = callerJwt(req);
    // Not a JWT role check: this project's service role secret is the
    // newer opaque sb_secret_... form, not a JWT, so it has no "role"
    // claim to decode - callerJwt() silently returns role:"" for it, which
    // the JWT check below would have wrongly treated as "reject". Direct
    // string comparison against this function's own copy of the secret is
    // correct either way, legacy JWT or opaque key, and is what actually
    // ran clean, not the first version.
    const presentedToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    let isServiceRole = false;
    if (SB_SERVICE && presentedToken.length === SB_SERVICE.length) {
      let diff = 0;
      for (let i = 0; i < SB_SERVICE.length; i++) diff |= presentedToken.charCodeAt(i) ^ SB_SERVICE.charCodeAt(i);
      isServiceRole = diff === 0;
    }
    if (!isServiceRole) {
      if (caller.role !== "authenticated") {
        root.setAttributes({ "yaadly.auth.outcome": "rejected" });
        return json({ error: "Sign in required. The kickoff agent only answers to the Yaadly admin session." }, 401);
      }
      if (!(await callerIsAdmin(req))) {
        root.setAttributes({ "yaadly.auth.outcome": "not_admin" });
        return json({ error: "Admin only. The kickoff agent answers only to the Yaadly admin." }, 403);
      }
    }
    root.setAttributes({ "yaadly.auth.outcome": isServiceRole ? "service_role" : "authenticated" });

    const body = await req.json().catch(() => ({}));
    const intake = (body && typeof body.intake === "object" && body.intake) ? body.intake : null;
    if (!intake || !String(intake.brief || "").trim()) {
      return json({ error: "Tell the agent what the client wants done. A brief is the minimum." }, 400);
    }
    if (!SB_URL || !SB_SERVICE) {
      return json({ error: "Function is missing its Supabase service configuration." }, 500);
    }
    // Only a service-role caller (this repository's own automation) may
    // stamp a job onto the draft. An admin's own manual draft from the desk
    // stays unattributed, exactly as it works today, so this never changes
    // that path's behaviour.
    const jobId = isServiceRole && typeof body.jobId === "string" && body.jobId.trim() ? body.jobId.trim() : undefined;
    // Optional per-draft model override, for reading the same brief drafted by
    // different models side by side. Admin session only; OpenRouter slugs only.
    const overrideModel = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
    if (overrideModel) {
      if (!/^[\w-]+\/[\w.:-]+$/.test(overrideModel)) {
        return json({ error: "Model override must be an OpenRouter slug like z-ai/glm-5.2." }, 400);
      }
      if (!Deno.env.get("OPENROUTER_API_KEY")) {
        return json({ error: "Model overrides go through OpenRouter. Add the OPENROUTER_API_KEY secret to this function first (Supabase dashboard, Edge Functions, Secrets)." }, 400);
      }
    }

    // Register the draft, hand back its id, and do the slow work after the
    // response. The desk polls kickoff_drafts for the result.
    const ins = await draftsWrite("POST", "", {
      // A service-role JWT's sub is not a user id worth trusting into this
      // column; a fresh id for every automatic request is honest about who
      // this is, same as the fallback already did for a missing sub.
      requested_by: isServiceRole ? crypto.randomUUID() : (caller.sub || crypto.randomUUID()),
      status: "drafting",
      intake,
      job_id: jobId ?? null,
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

    const bg = runDraft(row.id, intake, trace, overrideModel);
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
