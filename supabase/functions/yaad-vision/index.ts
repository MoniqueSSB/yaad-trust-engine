// Supabase Edge Function: yaad-vision
// Reviews construction/property evidence photos for visible defects using
// an NVIDIA-hosted vision-language model (build.nvidia.com / NIM).
//
// DEPLOY:
//   1. In your Supabase project, create a new function called "yaad-vision"
//      (dashboard: Edge Functions -> New Function -> name it yaad-vision)
//      or via CLI: supabase functions new yaad-vision
//   2. Paste this file in as its index.ts
//   3. Set secrets (dashboard: Edge Functions -> yaad-vision -> Secrets, or via CLI):
//        supabase secrets set NVIDIA_API_KEY=nvapi-xxxxxxxxxxxxxxxxxxxx
//      Get the key from build.nvidia.com -> your profile -> API Keys.
//      SUPABASE_URL and SUPABASE_ANON_KEY are usually already available to
//      every Edge Function automatically -- check your other functions
//      (like yaad-agent) to confirm the variable names match what's used there.
//   4. Deploy: supabase functions deploy yaad-vision
//
// MODEL: Set NVIDIA_VISION_MODEL as a secret to swap models without
// touching code, e.g. to compare quality:
//   nvidia/nemotron-nano-12b-v2-vl        (default, NVIDIA's own, solid all-rounder)
//   meta/llama-4-scout-17b-16e-instruct   (strong general vision reasoning)
//   mistralai/mistral-small-3.2-24b-instruct-2506
// Check build.nvidia.com/models for the exact current model IDs -- this
// catalog changes, so confirm the ID on the model's page before relying on it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

const NVIDIA_API_KEY = Deno.env.get("NVIDIA_API_KEY");
const NVIDIA_MODEL = Deno.env.get("NVIDIA_VISION_MODEL") || "nvidia/nemotron-nano-12b-v2-vl";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

const SYSTEM_PROMPT = `You are a construction and property condition reviewer working for Yaadly, a property oversight service in Jamaica. You look at photos of a property or completed work and report ONLY what is visibly evident in the image itself. You are not a licensed surveyor, engineer, or inspector, and your findings are a starting point for a human project manager, not a final judgement.

For each photo, look for visible issues in these categories where present:
- Water damage or staining
- Cracks (wall, foundation, ceiling)
- Peeling, bubbling, or flaking paint
- Missing, cracked, or degraded sealant or grout
- Mould or damp
- Rust or corrosion on metalwork
- Roofing issues (missing tiles, visible sagging, rust on zinc)
- Visible electrical hazards (exposed wiring, damaged fixtures)
- Visible plumbing issues (leaks, staining under fixtures)
- Structural concerns (visible sagging, leaning, significant cracking)
- Incomplete or inconsistent work versus the agreed scope, if scope is provided
- General visible safety hazards

Respond with a JSON array ONLY, no other text before or after it, in this exact shape:
[
  {
    "issue": "short label, e.g. Sealant missing on right column",
    "category": "one of: cosmetic, maintenance, safety, structural, scope_mismatch",
    "severity": "low, medium, or high",
    "note": "one sentence, plain English, describing only what is visible",
    "recommend_professional": true or false
  }
]

Rules:
- If nothing notable is visible, return an empty array: []
- Never state a structural or safety diagnosis with certainty. Use language like "appears to show" or "worth checking in person"
- Any finding in the "structural" or "safety" category MUST have "recommend_professional": true
- Do not invent detail that is not visible in the image
- If the photo is unclear, too dark, or too zoomed to judge, say so as a low-severity "cosmetic" note rather than guessing
- Output ONLY the JSON array`;

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const trace = new Trace("yaad-vision", req);
  const root = trace.startSpan("POST /yaad-vision", SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end();
    trace.flush();
    return res;
  };

  try {
    // Require a signed-in caller who is permitted to use the agents: the Yaadly
    // admin, or a client with a profile who has signed the CURRENT Client
    // Guidelines. Same rule as yaad-agent, and it lives in Postgres
    // (may_use_agents) so the two cannot drift apart.
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(SUPABASE_URL ?? "", SUPABASE_ANON_KEY ?? "", {
      global: { headers: { Authorization: authHeader } },
    });

    const user = await trace.span("auth.get_user", SpanKind.CLIENT, {
      "db.system.name": "supabase_auth",
    }, async (s) => {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      s.setAttributes({ "yaadly.auth.outcome": user ? "authenticated" : "rejected" });
      if (authErr) s.recordError(authErr.message);
      return user;
    });

    if (!user) {
      root.setAttributes({ "yaadly.auth.outcome": "rejected" });
      return done(new Response(JSON.stringify({ error: "Not signed in." }), { status: 401, headers: cors }), 401);
    }
    const { data: mayUse } = await supabase.rpc("may_use_agents", { p_email: user.email ?? "" });
    if (mayUse !== true) {
      root.setAttributes({ "yaadly.auth.outcome": "not_permitted" });
      return done(new Response(JSON.stringify({ error: "Complete your client profile and sign the current Client Guidelines to use this." }), { status: 403, headers: cors }), 403);
    }
    root.setAttributes({ "yaadly.auth.outcome": "authenticated" });

    if (!NVIDIA_API_KEY) {
      root.setAttributes({ "yaadly.config.missing": "NVIDIA_API_KEY" });
      root.recordError("NVIDIA_API_KEY is not set");
      return done(new Response(JSON.stringify({ error: "NVIDIA_API_KEY is not set on this function. Add it under Edge Function secrets." }), { status: 500, headers: cors }), 500);
    }

    const { images, scope, jobTitle } = await req.json();
    if (!Array.isArray(images) || !images.length) {
      root.setAttributes({ "yaadly.vision.outcome": "no_images" });
      return done(new Response(JSON.stringify({ error: "No images provided." }), { status: 400, headers: cors }), 400);
    }

    const userContent: Record<string, unknown>[] = [
      { type: "text", text: `Job: ${jobTitle || "unspecified"}\nAgreed scope: ${scope || "not provided"}\n\nReview the following photo(s) and return findings as instructed.` },
    ];
    // Cap at 6 photos per call to keep cost and latency sane.
    const used = images.slice(0, 6);
    for (const img of used) {
      userContent.push({ type: "image_url", image_url: { url: img } });
    }
    root.setAttributes({ "yaadly.vision.images_submitted": images.length, "yaadly.vision.images_reviewed": used.length });

    const nvRes = await trace.span(`chat ${NVIDIA_MODEL}`, SpanKind.CLIENT, {
      "gen_ai.system": "nvidia_nim",
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": NVIDIA_MODEL,
      "gen_ai.request.max_tokens": 1200,
      "gen_ai.request.temperature": 0.2,
      "server.address": "integrate.api.nvidia.com",
      "yaadly.agent.name": "photo_review",
      "yaadly.vision.images_reviewed": used.length,
    }, async (s) => {
      const r = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${NVIDIA_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: NVIDIA_MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
          max_tokens: 1200,
          temperature: 0.2,
        }),
      });
      s.setAttributes({ "http.response.status_code": r.status });
      if (!r.ok) s.recordError(`nvidia http ${r.status}`);
      return r;
    });

    if (!nvRes.ok) {
      const errText = await nvRes.text();
      root.setAttributes({ "yaadly.vision.outcome": "model_error" });
      return done(new Response(JSON.stringify({ error: "Vision model error: " + errText.slice(0, 300) }), { status: 502, headers: cors }), 502);
    }

    const nvJson = await nvRes.json();
    const raw = nvJson.choices?.[0]?.message?.content || "[]";
    let findings: unknown[] = [];
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      findings = match ? JSON.parse(match[0]) : [];
    } catch (_e) {
      root.setAttributes({ "yaadly.vision.outcome": "unparseable_response" });
      root.recordError("Could not parse model response");
      return done(new Response(JSON.stringify({ error: "Could not parse model response.", raw }), { status: 502, headers: cors }), 502);
    }

    // Counting the safety and structural findings makes the guardrail visible
    // in the trace: those are the categories that must escalate to a human.
    let escalating = 0;
    try {
      for (const f of findings as { category?: string; recommend_professional?: boolean }[]) {
        if (f?.recommend_professional || f?.category === "safety" || f?.category === "structural") escalating++;
      }
    } catch (_) { /* attribute only */ }

    root.setAttributes({
      "yaadly.vision.outcome": "reviewed",
      "yaadly.vision.finding_count": findings.length,
      "yaadly.vision.escalating_finding_count": escalating,
      "gen_ai.usage.input_tokens": nvJson?.usage?.prompt_tokens,
      "gen_ai.usage.output_tokens": nvJson?.usage?.completion_tokens,
    });

    return done(new Response(JSON.stringify({ findings }), { headers: { ...cors, "Content-Type": "application/json" } }), 200);
  } catch (e) {
    root.recordError(e);
    return done(new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors }), 500);
  }
});
