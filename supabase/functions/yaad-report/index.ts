import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";
import { pickTextProvider, providerAttrs, NO_PROVIDER_MESSAGE } from "./textmodel.ts";
import * as guardrails from "./guardrails.ts";

// yaad-report
//
// The report drafting agent. Three of the seven priced services ARE a
// document: the Deposit Protection Check, the Condition Report and the
// Technical Sign-off. services.html promises a written verdict on page one and
// puts no timeline on it. Until now that document was typed by hand,
// which put the ceiling on this business at roughly four reports a week.
//
// So this drafts the findings and assembles the document. It does not write
// the two things the client is actually paying for.
//
// THE LINE, AND WHY IT IS WHERE IT IS
//
// A client paying £249 for a Condition Report is not buying prose. They are
// buying somebody with seven years of UK construction project management
// saying "this one is Severe and here is what I would do". Draft the prose and
// you save an evening. Draft the rating and you have sold a judgment nobody
// made, which is the one thing this company cannot survive selling.
//
// So, exactly as yaad-invoice has no amount field:
//
//   * the JSON schema below has NO severity field and NO verdict field
//   * the database refuses to issue a report while any finding is unrated or
//     the verdict is empty (report_guard_issue, 20260904c)
//   * rating a finding requires a signed-in admin and stamps who did it
//
// MEASUREMENTS. Same three layers as yaad-sketch, and deliberately the same
// regex, because two copies of that rule would drift. The prompt forbids a
// dimension, MEASUREMENT_RE below removes any that arrive anyway and reports
// every one to the desk rather than hiding it, and has_measurement() in
// Postgres refuses to let a report carrying one be issued. A phone photograph
// carries no scale, and measured work for reward is regulated in Jamaica.
//
// NO SERVICE-ROLE KEY. Every database call goes out under the caller's own
// token, so RLS is the access control, same as yaad-invoice.

const SYSTEM = `You are the Report Drafting Agent for Yaadly Ltd, a UK company providing construction project management, procurement review and independent oversight for property work in Jamaica. You turn an inspector's raw notes and photograph captions into the findings of a draft report, in Yaadly's house structure, for a named person to rate and sign.

Return STRICT JSON only, no markdown fences, exactly this shape:
{"findings":[{"heading":"","body":"","action":""}],"omitted":[],"questions":[]}

Rules, all of them absolute:
1. You may NEVER rate a finding. There is no severity field. Do not write "severe", "moderate", "low", "urgent", "critical" or "minor" anywhere, and do not rank the findings by seriousness.
2. You may NEVER write the verdict, the recommendation to proceed or not proceed, or any overall conclusion. There is no field for it. A person writes it.
3. You may NEVER state a measurement: no millimetres, centimetres, metres, feet, inches, yards, square metres or square feet. Say "a hairline crack", "a full height crack", "most of the ceiling". Counting is fine: "two of the five latches are missing" is good English and not a measurement.
4. You may NEVER state, estimate or imply a cost, a price, a day rate or a quantity of materials to buy. There is no field for one.
5. You may NEVER say anything about what a property is worth, who owns it, whether title is clean, whether a structure is sound, or where a boundary runs. Those four go to a licensed valuer, an attorney, a PERB registered engineer and a commissioned land surveyor. If the notes raise one, put it in "questions" naming which professional it belongs to, and write no finding about it.
6. Add nothing the inspector did not record. If the notes do not say whether the gutter is blocked, the report does not say. Anything you could not source from the notes goes in "omitted" so the person knows what is missing before they sign.
7. "heading" is one short line naming the finding. "body" is two to four plain sentences describing what was recorded, in British English. "action" is what the client should do about it, practically, in one or two sentences. If the notes do not support an action, leave "action" empty rather than inventing one.
8. Never promise an outcome, a date, or that anything is guaranteed, fully covered or risk free. Never use the word escrow. Never say Yaadly holds anyone's money.
9. No em dashes and no en dashes anywhere. Use a comma, a colon, brackets or a full stop.
10. Write so an anxious person four thousand miles away can read it once and understand it. Plain, warm, specific. Never alarming for effect and never soothing past what the notes support.

You draft. A named person rates every finding, writes the verdict and signs. You do not decide how serious anything is.`;

// Same rule as yaad-sketch's own MEASUREMENT_RE. A bare "in" is deliberately
// excluded as a unit, because "1 in 5 tiles is cracked" is ordinary English.
const MEASUREMENT_RE =
  /(^|[^a-z0-9])\d+([.,]\d+)?\s*(mm|cm|m|m2|m²|metre|meter|metres|meters|ft|foot|feet|yard|yards|inch|inches|sq\.?\s*(m|ft|metre|metres|foot|feet)|square\s+(metre|metres|meter|meters|foot|feet))([^a-z0-9]|$)|\d\s*('|")(\s|$|[.,;)])/gi;

type Scrub = { where: string; text: string };

function scrub(text: string, where: string, found: Scrub[]): string {
  if (!text) return text;
  const out = text.replace(MEASUREMENT_RE, (m) => {
    found.push({ where, text: m.trim() });
    return " [size removed] ";
  });
  return out.replace(/\s{2,}/g, " ").trim();
}

// Belt and braces on rule 1. A model told not to rate will occasionally rate
// anyway, in prose, and "this is a severe problem" inside a body reads to a
// client exactly like the rating they paid a person for.
const RATING_WORDS = /\b(severe|critical|urgent|moderate|minor|low risk|high risk)\b/gi;

function deRate(text: string, where: string, found: Scrub[]): string {
  if (!text) return text;
  return text.replace(RATING_WORDS, (m) => {
    found.push({ where, text: m });
    return "[rating removed]";
  });
}

function bearer(req: Request): string {
  return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
}

function env() {
  return { url: Deno.env.get("SUPABASE_URL")!, anon: Deno.env.get("SUPABASE_ANON_KEY")! };
}

// Caller's token only. This function holds no service-role key, so RLS is
// doing the access control and an ordinary session cannot draft a report.
async function db(req: Request, path: string, init: RequestInit = {}) {
  const { url, anon } = env();
  return await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: anon,
      Authorization: `Bearer ${bearer(req)}`,
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const KINDS = ["deposit_check", "condition", "technical_signoff", "visual_check"] as const;

// Same tracer shape as yaad-job-health: start the root span, end it and flush
// on every exit, so a failure path is traced as carefully as a success.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-report", req);
  const root = trace.startSpan(`${req.method} /yaad-report`, SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush(); return res;
  };
  const json = (body: unknown, status = 200) =>
    done(new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } }), status);

  try {
    const fail = (message: string, status: number) => {
      root.recordError(message);
      return json({ error: message }, status);
    };
    if (req.method !== "POST") return fail("Method not allowed.", 405);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch (_) { return fail("Send JSON.", 400); }

    const kind = String(body.kind ?? "");
    const notes = String(body.notes ?? "").trim();
    const captions = Array.isArray(body.captions) ? (body.captions as unknown[]).map(String) : [];
    const jobId = body.job_id ? String(body.job_id) : null;
    const serviceId = body.service_id ? String(body.service_id) : null;

    if (!KINDS.includes(kind as typeof KINDS[number])) {
      return fail(`kind must be one of ${KINDS.join(", ")}.`, 400);
    }
    // A report with nothing behind it is the failure mode this whole product
    // exists to prevent, so it is refused here rather than drafted thinly.
    if (notes.length < 40) {
      return fail("There are not enough notes from the visit to draft a report. Write what you saw first, even roughly.", 400);
    }

    const prov = pickTextProvider();
    if (!prov) return fail(NO_PROVIDER_MESSAGE, 503);

    root.setAttributes({ "yaadly.report.kind": kind, "yaadly.report.captions": captions.length });

    const userBlock = [
      `SERVICE: ${kind}`,
      `INSPECTOR'S NOTES FROM THE VISIT:\n${notes}`,
      captions.length ? `PHOTOGRAPH CAPTIONS:\n${captions.map((c, i) => `${i + 1}. ${c}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n");

    const raw = await trace.span(`chat ${prov.model}`, SpanKind.CLIENT, {
      ...providerAttrs(prov),
      "gen_ai.operation.name": "chat",
      "gen_ai.request.temperature": 0,
    }, async (s) => {
      const r = await fetch(prov.api, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${prov.key}` },
        body: JSON.stringify({
          model: prov.model,
          temperature: 0,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: userBlock },
          ],
        }),
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
      return j?.choices?.[0]?.message?.content ?? "";
    });

    let parsed: Record<string, any> = {};
    try {
      parsed = JSON.parse(String(raw).replace(/^```(json)?/i, "").replace(/```$/, "").trim());
    } catch (_) {
      return fail("The agent did not return a usable draft. Try again, or write the notes more plainly.", 502);
    }

    const found: Scrub[] = [];
    const findings = (Array.isArray(parsed.findings) ? parsed.findings : [])
      .slice(0, 40)
      .map((f: Record<string, unknown>, i: number) => {
        const heading = deRate(scrub(String(f?.heading ?? "").trim(), `finding ${i + 1} heading`, found), `finding ${i + 1} heading`, found);
        const bodyText = deRate(scrub(String(f?.body ?? "").trim(), `finding ${i + 1} body`, found), `finding ${i + 1} body`, found);
        const action = deRate(scrub(String(f?.action ?? "").trim(), `finding ${i + 1} action`, found), `finding ${i + 1} action`, found);
        return { ord: i + 1, heading, body: bodyText, action: action || null };
      })
      .filter((f: { heading: string; body: string }) => f.heading && f.body);

    if (!findings.length) {
      return fail("The agent produced no usable findings from those notes.", 502);
    }

    // The banned-language screen, on everything a client would read. A hit is
    // reported rather than silently rewritten, because the desk needs to know
    // the model reached for that word at all.
    const blob = findings.map((f: { heading: string; body: string; action: string | null }) =>
      `${f.heading}\n${f.body}\n${f.action ?? ""}`).join("\n\n");
    const banned = guardrails.scan(blob);
    root.setAttributes({
      ...guardrails.screenAttrs(banned),
      "yaadly.report.findings": findings.length,
      "yaadly.report.scrubbed": found.length,
    });
    if (banned.length) {
      return fail(
        "The draft used language Yaadly does not use (" +
        banned.map((b) => b.guidance).join("; ") +
        "). Nothing was saved. Run it again.",
        422,
      );
    }

    // Written with verdict and verdict_line null, and every finding unrated.
    // That is the product, not an unfinished state.
    const ins = await db(req, "reports", {
      method: "POST",
      body: JSON.stringify({
        kind,
        job_id: jobId,
        service_id: serviceId,
        client_name: body.client_name ? String(body.client_name) : null,
        property: body.property ? String(body.property) : null,
        visited_on: body.visited_on ? String(body.visited_on) : null,
        status: "draft",
        model: prov.model,
        provider: prov.name,
        scrubbed: found,
      }),
    });
    if (!ins.ok) {
      const t = await ins.text();
      return fail(`Could not save the draft: ${ins.status} ${t.slice(0, 200)}`, 502);
    }
    const report = (await ins.json())[0];

    const insF = await db(req, "report_findings", {
      method: "POST",
      body: JSON.stringify(findings.map((f: Record<string, unknown>) => ({ ...f, report_id: report.id }))),
    });
    if (!insF.ok) {
      const t = await insF.text();
      return fail(`The report was saved but its findings were not: ${insF.status} ${t.slice(0, 200)}`, 502);
    }

    // The ledger. Written as the agent, with the actions it may take. Rating
    // and issuing are recorded separately, by the desk, as the person.
    await db(req, "agent_actions", {
      method: "POST",
      body: JSON.stringify({
        job_id: jobId,
        actor: "yaad-report",
        actor_kind: "agent",
        action: "draft_report",
        summary: `Drafted ${findings.length} finding(s) for a ${kind.replace(/_/g, " ")}. Unrated, no verdict.`,
        refs: { reports: report.id },
        model: prov.model,
        provider: prov.name,
      }),
    }).catch(() => {});

    return json({
      ok: true,
      report_id: report.id,
      findings: findings.length,
      scrubbed: found,
      omitted: Array.isArray(parsed.omitted) ? parsed.omitted.slice(0, 20) : [],
      questions: Array.isArray(parsed.questions) ? parsed.questions.slice(0, 20) : [],
      next: "Rate every finding and write the verdict. The report cannot be issued until both are done.",
    });
  } catch (e) {
    root.recordError(String(e).slice(0, 300));
    return json({ error: "The report drafter failed. Nothing was saved." }, 500);
  }
});
