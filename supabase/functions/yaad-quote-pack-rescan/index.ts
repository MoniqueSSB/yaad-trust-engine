/* ── yaad-quote-pack-rescan ────────────────────────────────────────────────
 *
 * A person corrects the wording, and the SAME guardrail decides again.
 *
 * WHY THIS EXISTS. A quote pack draft that the guardrail flags is held at
 * 'ready', and approve_quote_pack_draft() refuses it outright with no
 * override, which is correct: nobody should be able to wave flagged content
 * through to a client. But Approve was the only action on the desk, so there
 * was no route at all from "this flag is a false positive" to "this job can
 * move". The job stopped, and nothing said so.
 *
 * The case that showed it: a painting pack said "surface fully covered". The
 * phrase is banned because "your job is fully covered" is a promise about
 * money, and it fired on paint covering a railing. Painting is a large share
 * of the trade list, so this will recur.
 *
 * WHAT THIS IS NOT. It is not a way to clear a flag. The corrected text goes
 * through _shared/quote-pack-verdict.ts, which is the identical function the
 * drafter uses, so a correction that is still dirty stays dirty and Postgres
 * still refuses to approve it. Nothing here changes `status`, nothing here
 * approves anything, and a named human still presses Approve afterwards.
 *
 * The alternative was to narrow the banned pattern so paint stopped matching.
 * That is exactly the change CLAUDE.md §3 exists to refuse: a loosened
 * banned-language rule is permanent and applies to every future client, while
 * a stuck draft is one row. Widen what the desk can do; never the rule.
 *
 * NO MODEL IS CALLED. This is a person's edit being re-checked, not a
 * redraft, so there is no pause switch to honour and no provider involved.
 * Redrafting from the brief is yaad-quote-pack's job and remains separate.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SpanKind, Trace } from "./otel.ts";
import * as guardrails from "./guardrails.ts";
import { missingSections, verdictFor } from "./quote-pack-verdict.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  const trace = new Trace("yaad-quote-pack-rescan", req);
  const root = trace.startSpan(`${req.method} /yaad-quote-pack-rescan`, SpanKind.SERVER);

  try {
    // Platform auth is ON for this function (no --no-verify-jwt), so a token
    // has already been checked before this line. This establishes WHO, which
    // is what gets written onto the row.
    const authHeader = req.headers.get("Authorization") || "";
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });

    const { data: { user } } = await asCaller.auth.getUser();
    if (!user?.email) {
      root.setAttributes({ "yaadly.auth.outcome": "rejected" });
      return json({ error: "Not signed in." }, 401);
    }
    const { data: admin } = await asCaller.rpc("is_admin");
    if (admin !== true) {
      root.setAttributes({ "yaadly.auth.outcome": "not_admin" });
      return json({ error: "Admin only." }, 403);
    }
    root.setAttributes({ "yaadly.auth.outcome": "admin" });

    const body = await req.json().catch(() => ({})) as {
      draftId?: string; docs?: unknown; note?: string;
    };
    const draftId = String(body.draftId ?? "").trim();
    const note = String(body.note ?? "").trim().slice(0, 1000);
    if (!draftId) return json({ error: "draftId is required." }, 400);
    if (!body.docs || typeof body.docs !== "object" || Array.isArray(body.docs)) {
      return json({ error: "docs must be the corrected pack, as an object." }, 400);
    }
    const docs = body.docs as Record<string, unknown>;

    // The drafter's own completeness rule, so a correction cannot quietly
    // delete a section that a finished pack is required to carry.
    const missing = missingSections(docs);
    if (missing.length) {
      return json({ error: `The corrected pack is missing: ${missing.join(", ")}. Nothing was written.` }, 400);
    }

    const admin$ = createClient(SUPABASE_URL, SERVICE_KEY);

    // Only a HELD draft. An approved pack has already been through a person
    // and is not something to rewrite from here; a draft still being written
    // would be overwritten by the drafter finishing.
    const { data: draft, error: readErr } = await admin$
      .from("quote_pack_drafts").select("id,status,job_id,guardrail").eq("id", draftId).maybeSingle();
    if (readErr) return json({ error: `Could not read the draft (${readErr.message}).` }, 500);
    if (!draft) return json({ error: "No such draft." }, 404);
    if (draft.status !== "ready") {
      return json({ error: `This draft is '${draft.status}'. Only a draft held at 'ready' can be corrected here.` }, 409);
    }

    // The identical function the drafter uses. Not a second opinion: the same
    // opinion, on corrected words.
    const verdict = verdictFor(docs, guardrails.scan);

    const { error: writeErr } = await admin$
      .from("quote_pack_drafts")
      .update({
        docs,
        guardrail: {
          ...verdict,
          rescanned_at: new Date().toISOString(),
          rescanned_by: user.email,
          rescan_note: note || null,
          previous_banned_samples:
            (draft.guardrail as Record<string, unknown> | null)?.banned_samples ?? null,
        },
      })
      .eq("id", draftId)
      .eq("status", "ready");   // nothing else moved it while we were deciding
    if (writeErr) return json({ error: `Could not save the correction (${writeErr.message}).` }, 500);

    root.setAttributes({
      "yaadly.rescan.draft_id": draftId,
      "yaadly.rescan.job_id": String(draft.job_id ?? ""),
      "yaadly.rescan.clean": !verdict.banned_language_detected && !verdict.price_language_detected,
    });

    const clean = !verdict.banned_language_detected && !verdict.price_language_detected;
    return json({
      ok: true,
      clean,
      guardrail: verdict,
      // Said plainly, because "clean" is not "approved" and the difference is
      // the whole product.
      note: clean
        ? "The corrected wording passes the same check the drafter runs. The draft is still held: press Approve when you are happy with it."
        : "Still flagged, so nothing has been cleared. Fix the wording it names and run this again.",
    });
  } catch (e) {
    root.recordError(String(e));
    return json({ error: "Could not rescan this draft." }, 500);
  } finally {
    root.end();
    trace.flush();
  }
});
