import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";
import { pickTextProvider, providerAttrs, chatWithFailover, NO_PROVIDER_MESSAGE } from "./textmodel.ts";
import * as guardrails from "./guardrails.ts";
import { missingSections, verdictFor } from "./quote-pack-verdict.ts";

// Quote Kickoff Pack agent, 1 Sep 2026.
//
// A short, worker-facing DRAFT ONLY, one per job. A worker considering the
// job gets a starting overview instead of a blank form: what's being done,
// roughly when, and how payment stages work. They review, edit to their own
// terms, add their own price on job_quotes (not here), and send that edited
// version as their quote. Nothing this function writes is ever shown to a
// client directly.
//
// Deliberately NOT the big yaad-kickoff pack: no evidence checklist, no
// risk register, no document pack, none of the twelve sections. Same two
// absolute rules carried over from that agent's system prompt, because
// they are not specific to the big pack, they are specific to Yaadly:
// never state a price or amount (Monique sells oversight judgement, not
// pricing, CLAUDE.md §5), and never say escrow (CLAUDE.md §6, §8).
//
// One call, not the big pack's four-way split: this document is a few
// short paragraphs and a handful of payment stages, well inside a single
// request's time and token budget.

const SYSTEM = `You are the Quote Kickoff Pack agent for Yaadly, a trust-first property works service operating across Jamaica, launching in Kingston and Portmore first.

WHO YOU ARE WRITING FOR: a tradesperson deciding whether and how to quote on this job. They see this before they have entered a price. Write plain, direct English, addressed to them.

ABSOLUTE RULES, these override everything else:
1. NEVER state, estimate, guess or imply a price, cost, rate, valuation or budget figure, in any currency, in any form. The worker adds their own price separately; you never see it and must never guess at one. Where money must be described, describe the STRUCTURE only: stage names and what evidence must be filed and signed off before that stage is complete, as a percentage of an unnamed total. Never an amount.
2. Never use the word escrow, in any form, and never say money is held on anyone's behalf, with a payment provider or otherwise. Yaadly holds nothing. Yaadly is the principal contractor: the client buys the job from Yaadly, and Yaadly separately engages you and pays you under its own agreement with you. Say that plainly where it helps, because it is the best thing about working this way: your money does not wait on a client abroad approving anything.
3. Never invent facts about this specific job. If the intake does not say, write the summary around what is known rather than guessing at what is not.
4. Payment stages are tied to evidence, never to elapsed time. A stage completes when the evidence is filed and a named person at Yaadly has signed it off. Never write that a client's approval is what pays you.

Return STRICT JSON only. No markdown fences, no commentary. Exactly this shape:
{
 "scope_summary": "2 to 3 short paragraphs separated by \\n\\n: what the job actually involves, in plain words a tradesperson would recognise, and anything the intake flags as a constraint (access, timing, materials already agreed). Concrete to THIS job, never generic.",
 "included": ["short bullets, high level: what a tradesperson quoting this job would be taking on. Concrete to THIS job, e.g. 'Strip and repaint both bedrooms and the hallway' not 'painting work'"],
 "excluded": ["short bullets, high level: what is explicitly NOT part of this, either because the intake says so, or because it is the kind of thing this trade commonly gets blamed for overstepping into (e.g. structural repair behind a crack, electrical near a damp patch, anything needing a permit). Never leave this empty: if the intake gives nothing to exclude, state the boundary of the trade itself"],
 "rough_timeline": "1 to 2 short paragraphs: a rough shape of how long this kind of job runs and what it depends on (site access, weather if outdoor work, materials lead time). Ranges only, never a fixed date, since no worker has been chosen yet.",
 "payment_stages": [
   {"stage": "stage name", "proportion_percent": 0, "evidence_note": "what would need to be shown before this stage releases"}
 ]
}

QUALITY BARS:
- 3 to 6 payment stages, ordered the way the work actually happens (never paint before plaster, never cover before it is inspected).
- proportion_percent values are whole numbers and should sum to 100.
- included and excluded are each 2 to 5 bullets, high level, never a duplicate of the other list reworded.
- Write as if a working tradesperson will read this on their phone before deciding whether to quote. Short, direct, no filler words like "ensure", "appropriate", "as needed".
- Write in English only, throughout.`;

function jobToPrompt(j: Record<string, unknown>): string {
  const line = (label: string, key: string) => {
    const v = String(j[key] ?? "").trim();
    return v ? `${label}: ${v}` : "";
  };
  return [
    line("Job title", "title"),
    line("Parish", "parish"),
    line("What the client wants done", "brief"),
    line("Trade", "trades"),
    line("Client's stated timing", "timing"),
    line("Access and security on site", "access"),
  ].filter(Boolean).join("\n");
}

function stripNoise(s: string): string {
  return String(s).replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "").trim();
}

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

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
async function draftsWrite(method: string, path: string, body: unknown): Promise<Response> {
  return await fetch(`${SB_URL}/rest/v1/quote_pack_drafts${path}`, {
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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function runDraft(draftId: string, job: Record<string, unknown>, trace: Trace): Promise<void> {
  const fail = async (msg: string) => {
    console.error("quote-pack draft", draftId, "failed:", msg);
    await draftsWrite("PATCH", `?id=eq.${draftId}`, {
      status: "failed", error: msg.slice(0, 500), finished_at: new Date().toISOString(),
    }).catch(() => {});
  };
  try {
    const prov = pickTextProvider();
    if (!prov) { await fail(NO_PROVIDER_MESSAGE); return; }

    let finishReason = "";
    const raw = await trace.span(`chat ${prov.model}`, SpanKind.CLIENT, {
      ...providerAttrs(prov),
      "gen_ai.operation.name": "chat",
      "gen_ai.request.temperature": 0.3,
      "yaadly.agent.name": "quote-pack",
    }, async (s) => {
      // Retries, then the failover, 6 September 2026. See _shared/textmodel.ts.
      const { provider, res: r } = await chatWithFailover(prov, {
        temperature: 0.3,
        max_tokens: 3000,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: jobToPrompt(job).slice(0, 4000) },
        ],
      }, { timeoutMs: 120_000, retries: 2, maxRetryWaitMs: 15_000 });
      let j: any = {};
      try { j = await r.json(); } catch (_) { /* a non-JSON body reads as an empty answer below */ }
      s.setAttributes({
        ...providerAttrs(provider),
        "http.response.status_code": r.status,
        "gen_ai.usage.input_tokens": j?.usage?.prompt_tokens,
        "gen_ai.usage.output_tokens": j?.usage?.completion_tokens,
      });
      if (!r.ok) { s.recordError(`${provider.name} http ${r.status}`); throw new Error(`model call failed (${provider.name} ${r.status})`); }
      finishReason = j?.choices?.[0]?.finish_reason ?? "";
      return j?.choices?.[0]?.message?.content ?? "";
    });

    const docs = extractJson(String(raw));
    if (!docs) {
      console.error(`yaad-quote-pack: ${finishReason === "length" ? "ran out of room" : "no usable JSON"}, finish_reason=${finishReason}:`, String(raw).slice(0, 1200));
      await fail(finishReason === "length" ? "ran out of room before it finished" : "did not return usable JSON");
      return;
    }
    const missing = missingSections(docs);
    if (missing.length) { await fail(`Missing sections: ${missing.join(", ")}`); return; }

    // Same guardrail discipline as yaad-kickoff: the model is told never to
    // price and never to say escrow, this checks whether it did anyway.
    //
    // The verdict moved into _shared/quote-pack-verdict.ts on 5 September 2026
    // when yaad-quote-pack-rescan became the second thing that decides whether
    // a pack is clean. If the drafter and the rescan door ever computed it
    // differently, correcting a pack could clear a flag the drafter would
    // still have raised, and the flag would stop meaning anything.
    const verdict = verdictFor(docs, guardrails.scan);

    const up = await draftsWrite("PATCH", `?id=eq.${draftId}`, {
      status: "ready",
      docs,
      model: prov.model,
      guardrail: verdict,
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

  const trace = new Trace("yaad-quote-pack", req);
  const root = trace.startSpan("POST /yaad-quote-pack", SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => { root.setAttributes({ "http.response.status_code": status }); root.end(); trace.flush(); return res; };
  const json = (body: unknown, status = 200) =>
    done(new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } }), status);

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!SB_URL || !SB_SERVICE) return json({ error: "Function is missing its Supabase service configuration." }, 500);

    // Service role only. Unlike yaad-kickoff, this has no admin-desk manual
    // door: it is requested exactly one way, by yaad-quote-pack-check, the
    // moment a job goes live.
    const presentedToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    let isServiceRole = false;
    if (SB_SERVICE && presentedToken.length === SB_SERVICE.length) {
      let diff = 0;
      for (let i = 0; i < SB_SERVICE.length; i++) diff |= presentedToken.charCodeAt(i) ^ SB_SERVICE.charCodeAt(i);
      isServiceRole = diff === 0;
    }
    if (!isServiceRole) {
      root.setAttributes({ "yaadly.auth.outcome": "rejected" });
      return json({ error: "This agent only answers to Yaadly's own automation." }, 401);
    }
    root.setAttributes({ "yaadly.auth.outcome": "service_role" });

    const body = await req.json().catch(() => ({}));
    const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
    const job = (body && typeof body.job === "object" && body.job) ? body.job : null;
    if (!jobId || !job || !String((job as Record<string, unknown>).brief || "").trim()) {
      return json({ error: "jobId and a job with a brief are required." }, 400);
    }

    const ins = await draftsWrite("POST", "", { job_id: jobId, status: "drafting" });
    if (!ins.ok) {
      const t = await ins.text().catch(() => "");
      console.error("quote-pack: could not register draft", ins.status, t.slice(0, 300));
      return json({ error: "Could not register the draft. Try again." }, 500);
    }
    const row = (await ins.json())[0];
    root.setAttributes({ "yaadly.quote_pack.draft_id": row.id, "yaadly.quote_pack.job_id": jobId, "yaadly.quote_pack.outcome": "queued" });

    const bg = runDraft(row.id, job as Record<string, unknown>, trace);
    const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(bg);

    return json({ ok: true, draftId: row.id, status: "drafting" });
  } catch (e) {
    console.error("quote-pack: failed", String(e));
    root.recordError(e);
    return json({ error: String(e) }, 500);
  }
});
