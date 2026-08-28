import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

// Completion Report narrative agent.
//
// Takes the FACTS of a finished job - scope, worker, evidence log labels,
// checklist results - and drafts the connective prose for the Completion
// Report: what was found, what was done, how the evidence proves it, and
// how to care for the finished work. It DRAFTS ONLY; Monique reviews and can
// edit or clear the narrative before the report is issued.
//
// Hard rules mirror the kickoff agent's: never invent facts not in the
// input, never issue a verdict or certification (describe what the evidence
// shows; Yaadly observes and documents, it does not survey or certify), and
// never mention money in any form - the payment record on the report is
// rendered from the job data directly, not written by a model.

function pickProvider(): { name: string; api: string; key: string; model: string } | null {
  const mk = Deno.env.get("MINIMAX_API_KEY");
  if (mk) return { name: "minimax", api: "https://api.minimax.io/v1/chat/completions", key: mk, model: "MiniMax-M2.7" };
  return null;
}
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `You write the narrative sections of a Yaadly Completion Report: the document a property owner, usually overseas in the UK, US or Canada, keeps forever as the record of work done on their property in Jamaica. Warm, plain, direct English for a non-builder. This is a factual record, not marketing.

ABSOLUTE RULES:
1. Use ONLY the facts given in the input. Never invent a detail, a measurement, a material, a date or an event that is not there. If the input is thin, write less.
2. NEVER mention money: no prices, amounts, rates, currencies or costs of any kind. The payment record is a separate part of the report and is not yours.
3. Describe, never certify. You may say what the evidence shows ("the after photographs show the ceiling repainted with no staining visible"). You may NOT issue verdicts ("the roof is now safe", "the structure is sound") - Yaadly documents and oversees; it does not survey or certify. Where a judgement would need a licensed professional, say so.
4. Care suggestions must be general good practice for the kind of work described, phrased as suggestions, and anything beyond routine care must point to a qualified tradesperson.

Return STRICT JSON only, exactly this shape:
{
 "overview": "3-5 sentences: what the client asked for, what was found on site, what was done about it, and what state the evidence shows the work in now",
 "work_carried_out": ["2-4 short paragraphs walking through the job in the order it ran, grounded in the evidence log entries and their timestamps"],
 "evidence_note": "2-3 sentences on how the evidence on record - arrival, before, after, video, receipts - proves the work, mentioning any GAP honestly",
 "care_notes": ["2-4 practical suggestions for looking after the finished work, each one sentence, general good practice only"],
 "closing_note": "1-2 warm sentences to the owner about the record they now hold"
}`;

// Who is calling, asked of Supabase rather than read off the token.
//
// This used to decode the JWT payload with atob() and trust the role it found.
// Forging {"role":"authenticated"} is trivial. Nothing was exploitable, because
// the function is deployed with verify_jwt = true and the platform checks the
// signature first, but that made the check safe by accident rather than by
// design. The README in this folder tells a future reader some functions "must
// stay false"; applying that here would have left this as the only check, and
// it does not work. getUser() asks the auth server, so it is right either way.
async function callerIsSignedIn(req: Request): Promise<boolean | "misconfigured"> {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
  // Distinguish "we cannot check" from "they are not signed in". Collapsing the
  // two would turn a missing environment variable into a silent 401 for every
  // real user, which looks like a permissions bug and is not one.
  if (!url || !anon) return "misconfigured";
  if (!tok) return false;
  try {
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${tok}` },
    });
    if (!r.ok) return false;
    const u = await r.json();
    return Boolean(u?.id);
  } catch (_) { return false; }
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
    else if (c === "}") { depth--; if (depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch (_) { return null; } } }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const trace = new Trace("yaad-completion", req);
  const root = trace.startSpan("POST /yaad-completion", SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => { root.setAttributes({ "http.response.status_code": status }); root.end(); trace.flush(); return res; };
  const json = (body: unknown, status = 200) =>
    done(new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } }), status);

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const signedIn = await callerIsSignedIn(req);
    if (signedIn === "misconfigured") {
      root.recordError("SUPABASE_URL or SUPABASE_ANON_KEY missing; cannot verify the caller");
      return json({ error: "Sign in cannot be checked right now. This is a Yaadly problem, not yours." }, 503);
    }
    if (!signedIn) {
      root.setAttributes({ "yaadly.auth.outcome": "rejected" });
      return json({ error: "Sign in required." }, 401);
    }
    root.setAttributes({ "yaadly.auth.outcome": "authenticated" });

    const body = await req.json().catch(() => ({}));
    const job = (body && typeof body.job === "object" && body.job) ? body.job : null;
    if (!job || !String(job.desc || "").trim()) return json({ error: "The job needs a scope description before a narrative can be drafted." }, 400);

    const prov = pickProvider();
    if (!prov) { console.error("completion: no model API key"); return json({ error: "MINIMAX_API_KEY is not set." }, 500); }

    // Only facts, no client contact details, no money fields.
    const ev = Array.isArray(job.evidence) ? job.evidence.slice(0, 40) : [];
    const checks = Array.isArray(job.checklist) ? job.checklist : [];
    const userPrompt = [
      "Job title: " + String(job.title || ""),
      "Parish: " + String(job.parish || ""),
      "Client first name: " + String(job.client || ""),
      "Worker: " + String(job.workerName || "") + (job.workerTrade ? " (" + job.workerTrade + ")" : ""),
      "Scope agreed: " + String(job.desc || ""),
      "Evidence on record (label · note):",
      ...ev.map((e: { label?: string; meta?: string }) => "- " + String(e.label || "") + (e.meta ? " · " + String(e.meta) : "")),
      "Evidence checklist results:",
      ...checks.map((c: { name?: string; have?: number; need?: number }) =>
        "- " + String(c.name || "") + ": " + String(c.have ?? 0) + " of " + String(c.need ?? 0) + ((Number(c.have ?? 0) >= Number(c.need ?? 0)) ? " (PASS)" : " (GAP)")),
    ].join("\n").slice(0, 7000);

    root.setAttributes({ "yaadly.completion.evidence_items": ev.length });

    let finishReason = "";
    const raw = await trace.span(`chat ${prov.model}`, SpanKind.CLIENT, {
      "gen_ai.system": prov.name, "gen_ai.operation.name": "chat",
      "gen_ai.request.model": prov.model, "gen_ai.request.temperature": 0.3,
      "server.address": new URL(prov.api).hostname, "yaadly.agent.name": "completion",
    }, async (s) => {
      const r = await fetch(prov.api, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${prov.key}` },
        body: JSON.stringify({
          model: prov.model, temperature: 0.3, max_tokens: 8000,
          messages: [ { role: "system", content: SYSTEM }, { role: "user", content: userPrompt } ],
        }),
      });
      const j = await r.json();
      s.setAttributes({ "http.response.status_code": r.status,
        "gen_ai.usage.input_tokens": j?.usage?.prompt_tokens, "gen_ai.usage.output_tokens": j?.usage?.completion_tokens });
      if (!r.ok) { console.error("completion: model http", r.status, JSON.stringify(j).slice(0, 300)); s.recordError(`minimax http ${r.status}`); throw new Error(`Model call failed (${r.status})`); }
      finishReason = j?.choices?.[0]?.finish_reason ?? "";
      return j?.choices?.[0]?.message?.content ?? "";
    });

    const docs = extractJson(String(raw));
    if (!docs) {
      console.error("completion: unparseable.", "finish_reason=" + (finishReason || "unknown"), "chars=" + String(raw).length, "head=" + stripNoise(String(raw)).slice(0, 200));
      root.setAttributes({ "yaadly.completion.outcome": finishReason === "length" ? "truncated" : "unparseable" });
      return json({ error: finishReason === "length" ? "The narrative ran out of room. Try again." : "The model did not return usable JSON. Try again." }, 502);
    }

    // Money guard: the narrative must not talk about money at all.
    const blob = JSON.stringify(docs);
    const moneyHits = [
      ...(blob.match(/(?:J?\$|£|€|USD|JMD|GBP)\s?[\d,]+(?:\.\d+)?/gi) ?? []),
      ...(blob.match(/\b(?:paid|payment of|cost|price|charge)\b[^"]{0,40}\d/gi) ?? []),
    ];
    root.setAttributes({ "yaadly.completion.outcome": "drafted", "yaadly.completion.money_guardrail_hits": moneyHits.length });

    return json({
      ok: true, narrative: docs, model: prov.model,
      guardrail: {
        money_language_detected: moneyHits.length > 0,
        samples: moneyHits.slice(0, 5),
        note: moneyHits.length ? "The narrative mentions money. It must not - remove it before the report is issued." : "No money language found in the narrative.",
      },
      reminder: "A draft. Read it against the evidence before the report is issued.",
    });
  } catch (e) {
    console.error("completion: failed", String(e));
    root.recordError(e);
    return json({ error: String(e) }, 500);
  }
});
