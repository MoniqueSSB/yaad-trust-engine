import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";
import { pickTextProvider, providerAttrs, chatWithFailover } from "./textmodel.ts";
import * as guardrails from "./guardrails.ts";
import { SYSTEM, buildPrompt, rankedPicks, validatePicks, type Candidate, type JobForPrompt, type Pick } from "./picks.ts";

// =====================================================================
// yaad-shortlist: the shortlist agent. Picks a few vetted tradespeople to
// be ASKED TO QUOTE on a job, and writes them to job_shortlists for a named
// person on the desk to invite.
//
// Founder instruction, 9 September 2026: "there be an AI agent that picks a
// few tradespeople to quote."
//
// WHAT IT IS ALLOWED TO DO. Read the job as the board shows it (the scrubbed
// description, never the address or the client's contact details), read the
// candidates' PUBLISHED profiles (the same words on /workers/<slug>), and
// name up to N of them with one plain reason each. That is the whole job.
//
// WHAT IT CANNOT DO, by construction rather than by instruction:
//   - alert anybody: it writes job_shortlists and nothing else. The desk's
//     Invite button calls yaad-match with the names, and only then does
//     anyone hear about the job.
//   - pick somebody it was not shown: picks.ts drops any number outside the
//     candidate list, and the candidate list is shortlist_candidates_for_job,
//     which applies the same vetting bar as the alert path (active,
//     guidelines signed, trade or parish match).
//   - touch a quote, a price, a Yaad Score or a booking. It has no access to
//     job_quotes and its output never reaches a client.
//   - say anything the banned-language screen refuses. Reasons are scanned
//     and a dirty one is replaced with the database's plain match reason.
//
// WHEN THE MODEL IS NOT USED. Fewer candidates than asked for (nothing to
// choose between), agents paused on the desk, no provider configured, or an
// unusable answer: the database ranking stands in and the rows say
// source = 'rank', so the desk can tell a judgement from an ordering.
//
// Deploy with verify_jwt = true. Two callers: the desk with Monique's JWT
// (is_admin() must pass), or Yaadly's own automation with the service-role
// key and the x-yaad-internal header, the same two doors as yaad-match.
// =====================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-yaad-internal",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const trace = new Trace("yaad-shortlist", req);
  const root = trace.startSpan("POST /yaad-shortlist", SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => { root.setAttributes({ "http.response.status_code": status }); root.end(); trace.flush(); return res; };
  const json = (body: unknown, status = 200) =>
    done(new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } }), status);

  try {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // ---- who is calling -------------------------------------------------
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const internal = req.headers.get("x-yaad-internal") === "1" && token === SERVICE_KEY;
    let actor = "automation";
    if (!internal) {
      const asUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data: isAdmin, error: adminErr } = await asUser.rpc("is_admin");
      if (adminErr || isAdmin !== true) {
        root.setAttributes({ "yaadly.auth.outcome": "rejected" });
        return json({ error: "not permitted" }, 403);
      }
      const { data: u } = await asUser.auth.getUser();
      actor = u?.user?.email ?? "admin";
    }
    root.setAttributes({ "yaadly.auth.outcome": internal ? "service_role" : "admin" });

    // ---- input ----------------------------------------------------------
    let body: { job_id?: string; limit?: number; dry_run?: boolean };
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const jobId = String(body.job_id ?? "").trim();
    if (!jobId) return json({ error: "job_id required" }, 400);
    // Four by default. "A few" was the instruction, and five is where the
    // Blueprint capped the client's own shortlist, so the desk's is no wider.
    const limit  = Math.min(Math.max(Number(body.limit ?? 4) || 4, 1), 5);
    const dryRun = body.dry_run === true;
    root.setAttributes({ "yaadly.job.id": jobId, "yaadly.shortlist.limit": limit, "yaadly.shortlist.dry_run": dryRun });

    // ---- the job, as the board would show it ----------------------------
    // The description is deliberately NOT selected here. It arrives below
    // through board_descr_for_job(), which applies the public board's own
    // scrub, so the model reads what a worker would read and never the
    // client's name, contact details or address.
    const { data: job, error: jobErr } = await admin.from("jobs")
      .select("id, title, trade, job_type, parish, urgency, access_type, size_band, worker_email, stage, status")
      .eq("id", jobId).maybeSingle();
    if (jobErr) return json({ error: "job lookup failed", detail: jobErr.message }, 500);
    if (!job) return json({ error: "no such job" }, 404);
    if ((job.worker_email ?? "") !== "" || Number(job.stage ?? 0) !== 0) {
      return json({ error: "this job already has a worker, or has started; nothing to shortlist", job_id: jobId }, 409);
    }
    if (!job.trade) {
      return json({ error: "job has no trade set. Set the trade first; a shortlist on parish alone is how a plumber gets asked about a roof", job_id: jobId }, 422);
    }
    const { data: descrRows, error: descrErr } = await admin.rpc("board_descr_for_job", { p_job: jobId });
    if (descrErr) return json({ error: "could not read the job description", detail: descrErr.message }, 500);
    const descr = typeof descrRows === "string" ? descrRows : String(descrRows ?? "");

    // ---- candidates -----------------------------------------------------
    const { data: candRows, error: candErr } = await admin.rpc("shortlist_candidates_for_job", { p_job: jobId, p_limit: 12 });
    if (candErr) return json({ error: "candidate lookup failed", detail: candErr.message }, 500);
    const candidates = (candRows ?? []) as Candidate[];
    root.setAttributes({ "yaadly.shortlist.candidates": candidates.length });
    if (candidates.length === 0) {
      return json({ ok: true, job_id: jobId, picks: [], note: "nobody on the vetted bench matches this trade or parish yet" });
    }

    // ---- is a model wanted, and available -------------------------------
    const { data: pausedRow } = await admin.from("app_settings").select("value").eq("key", "agents_paused").maybeSingle();
    const paused = pausedRow ? /^"?true"?$/i.test(String(pausedRow.value)) : false;
    const prov = paused ? null : pickTextProvider();
    let picks: Pick[];
    let modelName: string | null = null;
    let how = "rank";

    if (candidates.length <= limit) {
      how = "rank:too_few_to_choose";
      picks = rankedPicks(candidates, limit);
    } else if (!prov) {
      how = paused ? "rank:agents_paused" : "rank:no_provider";
      picks = rankedPicks(candidates, limit);
    } else {
      const jobForPrompt: JobForPrompt = {
        id: job.id, title: job.title, trade: job.trade, job_type: job.job_type, parish: job.parish,
        urgency: job.urgency, access_type: job.access_type, size_band: job.size_band, descr,
      };
      let raw = "";
      try {
        raw = await trace.span(`chat ${prov.model}`, SpanKind.CLIENT, {
          ...providerAttrs(prov),
          "gen_ai.operation.name": "chat",
          "gen_ai.request.temperature": 0.2,
          "yaadly.agent.name": "shortlist",
        }, async (s) => {
          const { provider, res: r } = await chatWithFailover(prov, {
            temperature: 0.2,
            max_tokens: 800,
            messages: [
              { role: "system", content: SYSTEM },
              { role: "user", content: buildPrompt(jobForPrompt, candidates, limit).slice(0, 9000) },
            ],
          }, { timeoutMs: 45_000, retries: 2, maxRetryWaitMs: 10_000 });
          // deno-lint-ignore no-explicit-any
          let j: any = {};
          try { j = await r.json(); } catch (_) { /* read as empty below */ }
          s.setAttributes({
            ...providerAttrs(provider),
            "http.response.status_code": r.status,
            "gen_ai.usage.input_tokens": j?.usage?.prompt_tokens,
            "gen_ai.usage.output_tokens": j?.usage?.completion_tokens,
          });
          if (!r.ok) { s.recordError(`${provider.name} http ${r.status}`); throw new Error(`model call failed (${provider.name} ${r.status})`); }
          modelName = provider.model;
          return String(j?.choices?.[0]?.message?.content ?? "");
        });
      } catch (e) {
        root.recordError(e);
        raw = "";
      }
      const validated = raw ? validatePicks(raw, candidates, limit, guardrails.isClean) : null;
      if (validated === null) {
        how = "rank:model_unusable";
        picks = rankedPicks(candidates, limit);
        modelName = null;
      } else {
        how = "model";
        picks = validated;
      }
    }
    root.setAttributes({ "yaadly.shortlist.how": how, "yaadly.shortlist.picked": picks.length });

    if (dryRun) return json({ ok: true, dry_run: true, job_id: jobId, how, picks });

    // ---- write it ---------------------------------------------------------
    // A fresh run replaces the rows nobody has acted on yet. Anyone already
    // invited or dropped stays as the record says: a shortlist that quietly
    // forgets who was asked is worse than none.
    const { error: delErr } = await admin.from("job_shortlists")
      .delete().eq("job_id", jobId).is("invited_at", null).is("dropped_at", null);
    if (delErr) return json({ error: "could not clear the previous shortlist", detail: delErr.message }, 500);

    const rows = picks.map((p) => ({
      job_id: jobId, worker_email: p.worker_email, worker_name: p.worker_name,
      rank: p.rank, reason: p.reason, source: p.source, model: p.source === "model" ? modelName : null,
      created_by: actor,
    }));
    if (rows.length) {
      const { error: insErr } = await admin.from("job_shortlists")
        .upsert(rows, { onConflict: "job_id,worker_email", ignoreDuplicates: true });
      if (insErr) return json({ error: "could not save the shortlist", detail: insErr.message }, 500);
    }

    return json({ ok: true, job_id: jobId, how, picks, candidates: candidates.length });
  } catch (e) {
    console.error("yaad-shortlist: failed", String(e));
    root.recordError(e);
    return json({ error: String(e) }, 500);
  }
});
