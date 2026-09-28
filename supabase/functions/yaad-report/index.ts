import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";
import { pickTextProvider, providerAttrs, chatWithFailover, answerText, firstJsonObject, NO_PROVIDER_MESSAGE } from "./textmodel.ts";
import * as guardrails from "./guardrails.ts";
import { measurementRegExp } from "./measurements.ts";
import { figureRegExp } from "./figures.ts";

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
// MEASUREMENTS. Same three layers as yaad-sketch, and now literally the same
// pattern: _shared/measurements.ts, imported by both. Writing "deliberately the
// same regex" and then typing it out a second time is how it drifted. The
// prompt forbids a dimension, the scrubber removes any that arrive anyway and
// reports every one to the desk rather than hiding it, and has_measurement() in
// Postgres refuses to let a report carrying one be issued. A phone photograph
// carries no scale, and measured work for reward is regulated in Jamaica.
//
// NO SERVICE-ROLE KEY. Every database call goes out under the caller's own
// token, so RLS is the access control, same as yaad-invoice.

const SYSTEM = `You are the Report Drafting Agent for Yaadly Ltd, a UK company providing construction project management, procurement review and independent oversight for property work in Jamaica. You turn the raw notes behind one of Yaadly's priced services, and any photograph captions with them, into the findings of a draft report, in Yaadly's house structure, for a named person to rate and sign. Not all four services are a site visit. The SERVICE BRIEF below tells you which one this is and what its findings are about, and it is as binding as the rules.

Return STRICT JSON only, no markdown fences, exactly this shape:
{"findings":[{"heading":"","body":"","why":"","action":""}],"omitted":[],"questions":[]}

Rules, all of them absolute:
1. You may NEVER rate a finding. There is no severity field. Do not write "severe", "moderate", "low", "urgent", "critical" or "minor" anywhere, and do not rank the findings by seriousness.
2. You may NEVER write the verdict, the recommendation to proceed or not proceed, or any overall conclusion. There is no field for it. A person writes it.
3. You may NEVER state a measurement: no millimetres, centimetres, metres, feet, inches, yards, square metres or square feet. Say "a hairline crack", "a full height crack", "most of the ceiling". Counting is fine: "two of the five latches are missing" is good English and not a measurement.
4. You may NEVER state, estimate or imply a cost, a price, a day rate or a quantity of materials to buy. There is no field for one. Do not repeat a figure out of the notes either, even one the client already has in front of them: the person signing decides which numbers go in the document. The SHAPE of an arrangement is not a cost and you may describe it: "most of the price is payable before any materials are on site", "the whole of it is one figure with no breakdown", "payment is in three stages and the last is the smallest". Saying a figure is too high or too low is a rating, which rule 1 already forbids.
5. You may NEVER say anything about what a property is worth, who owns it, whether title is clean, whether a structure is sound, or where a boundary runs. Those four go to a licensed valuer, an attorney, a PERB registered engineer and a commissioned land surveyor. If the notes raise one, put it in "questions" naming which professional it belongs to, and write no finding about it.
6. Add nothing the notes did not record. If the notes do not say whether the gutter is blocked, the report does not say. There is a difference between a gap in the notes and an absence the notes record, and it matters most on a paperwork review: "the notes do not say whether he is insured" goes in "omitted", but "the notes record that the quote names no insurer" is something that was checked and found missing, and that is a finding. Anything you could not source from the notes goes in "omitted" so the person knows what is missing before they sign.
7. "heading" is one short line naming the finding. "body" is two to four plain sentences describing what was recorded, in British English. "why" is one to three sentences on why this matters to the client, in plain terms: what it exposes them to and how, without rating it and without a figure. "action" is what the client should do about it, practically, in one or two sentences, and it should remove or reduce the exposure rather than only ask for it to be written down. If the notes do not support an action, leave "action" empty rather than inventing one.
8. Never promise an outcome, a date, or that anything is guaranteed, fully covered or risk free. Never use the word escrow. Never say Yaadly holds anyone's money.
9. No em dashes and no en dashes anywhere. Use a comma, a colon, brackets or a full stop.
10. Write so an anxious person four thousand miles away can read it once and understand it. Plain, warm, specific. Never alarming for effect and never soothing past what the notes support.

You draft. A named person rates every finding, writes the verdict and signs. You do not decide how serious anything is.`;

// THE SERVICE BRIEF, added 25 September 2026.
//
// One prompt drafted all four services until today, and it opened "You turn an
// inspector's raw notes and photograph captions", which is a site visit. Three
// of the four are. The Deposit Protection Check is not: it is a desk review of
// a contractor and their written quote, done before any money moves, often
// with nobody having been to the property at all. The only thing that changed
// between a Condition Report and a £149 Deposit Protection Check was the line
// "SERVICE: deposit_check" in the user block, so the agent was being asked to
// inspect a building when the client had paid it to read a deal.
//
// The rules above are cross-cutting and stay one list. This is the part that
// is different per service: what the source material is, and what the findings
// are supposed to be ABOUT. Nothing here loosens a rule. No brief may grant a
// severity, a verdict, a measurement or a figure, and there is deliberately no
// per-service exception mechanism for any of those.
const BRIEFS: Record<string, string> = {
  deposit_check: `SERVICE BRIEF: Deposit Protection Check.

This is a desk review of a contractor and their written quote, carried out before the client pays anybody anything. Usually nobody has visited the property. Your source material is the quote, the messages, what the client was told, what could and could not be confirmed about the contractor, and any photographs somebody on the ground sent.

Your findings are about the deal, not the building. The ground they cover:
- who the contractor is, and what about them could be confirmed and what could not
- what the quote covers, what it leaves undefined, and what is simply missing from it
- how the payment is structured, in what order, and what the client is standing exposed on at each stage
- what has already been paid and what proof of it exists
- what is not written down anywhere: dates, insurance, who supplies materials, who owns them once paid for, what happens if either side stops
- anything that does not reconcile, such as two accounts of the same thing that do not match

A building observation only belongs here when it bears on the deal, for example a condition the quote does not mention but plainly needs to cover. You are not inspecting the property and you must not read one from photographs.

Questions of title, ownership, transfer, structural soundness and boundaries come up constantly on this service. Rule 5 is absolute and they go in "questions", naming the professional, with no finding written about them.

Each finding also carries "why": one to three plain sentences on what this exposes the client to and how. Not how serious it is. That is a rating and it is not yours.

IN ADDITION, for this service only, return a top-level "sections" object beside "findings", exactly this shape:
{"sections":{"finding_refs":[{"source":"","lines":[]}],"glance":{"proposed":"","proposed_detail":"","ours":"","ours_detail":""},"documents":[{"what":"","dated":"","form":""}],"checked":"","next_payment":"","get_before_paying":[{"document":"","finding":0}],"next_steps":[{"step":"","who":"","when":""}],"payment_terms":[{"proposed":"","source":""}],"scope_included":[],"scope_not_stated":[],"payment_stages":[{"stage":"","when":"","evidence":""}],"ask_the_builder":"","checklist":[{"state":"","note":""}]}}

- "finding_refs": one entry per finding, in the same order as "findings". "source" says where the finding came from, plainly: "document 1, quote, line 7", "document 2, WhatsApp, 18 September 2026", "reviewer's own search". "lines" is the list of QUOTE LINE numbers the finding rests on, using the numbering in the QUOTE, LINE BY LINE block if there is one, otherwise an empty list.
- "glance": two short sides for page one. "proposed" is one line on the payment arrangement as the builder proposed it, and "proposed_detail" one sentence adding who is paid, receipts and stages. "ours" is one line on the arrangement this report proposes instead (normally: nothing paid before materials are on site), and "ours_detail" one sentence on the stages and evidence. Percentages the builder used may be repeated. No sums of money.
- "documents": one entry per document the reviewer received, in order: what it is, the date it carries or covers, and its form ("1 photograph", "6 screenshots", "PDF, 2 pages"). Only what the notes show.
- "checked": one or two sentences on what the reviewer checked independently, only if the notes record it. Empty if they do not.
- "next_payment": when the builder has asked for the next payment, as the notes record it ("Monday 5 October 2026"). Empty if the notes do not say.
- "get_before_paying": the documents the client should get from the builder before paying anything, each tied to the finding number it answers.
- "next_steps": three to seven practical steps for the client, in order, each with "who" (you, you and the builder) and "when" (today, within two days, this week, before stage 1). None of them may be paying anyone, except paying the first stage once its evidence exists.
- "payment_terms": exactly 11 entries, in this order, one per term below. "proposed" is what the builder's quote or messages say on that term, in a few words and in the builder's terms where possible, or "Not stated" if nothing does. "source" says where, as in finding_refs, or is empty. Do not write what should be agreed instead: that part is Yaadly's standard and is filled in for you.
  1 Money before work
  2 Who is paid
  3 How it is paid
  4 Materials
  5 Stages
  6 When a stage is paid
  7 Receipts
  8 The last payment
  9 Currency
  10 If work stops
  11 Changes
- "scope_included": what the quote says it covers, one line per element, in the contractor's own wording where the notes give it.
- "scope_not_stated": what the quote does not say and therefore is not agreed either way: quantities, brands, who supplies, purlins, fascia, making good, waste, access, protection from rain, who receives deliveries. Only items the notes support.
- "payment_stages": the ORDER money should move in for this job, three to six stages, each with "when" (the condition) and "evidence" (what must exist before it moves: dated photographs, a supplier invoice in the client's name, a short video, a signed snag list). Never a share, never a percentage, never a figure. The person signing decides the shares.
- "ask_the_builder": one message the client can copy and send as it stands, in plain warm British English, numbering the things the contractor needs to provide in writing (including a bank account in their own name, and any guarantee on the finished work), then one paragraph proposing staged payment against evidence, by bank transfer to their own account, each stage paid promptly once its evidence arrives, then one paragraph on changes: stop, write down what changed and what it does to time and price, agree before carrying on. No figures anywhere in it. No dashes.
- "questions", for this service, starts each entry with the profession it belongs to and a colon: "Structural engineer: whether the rear wall...", "Attorney: ...", "Local authority: ...".
- "checklist": exactly 25 entries, in this order, one per line below. For each give "state", one of: provided, confirmed, not_provided, not_found, referred, not_applicable, and a short "note" only where the notes give a reason. Do not repeat the line text; the order is the key.
  1 Contractor named on the quote
  2 Business registration or TRN
  3 Verifiable address and a number other than WhatsApp
  4 Independent trace of the business
  5 Quote in writing and dated
  6 Quote itemised by element of work
  7 Labour and materials separated
  8 Quantities and specification stated
  9 Who supplies the materials
  10 Who owns the materials once paid for
  11 Who receives deliveries on site
  12 Waste removal and clean up
  13 Payment structure written down
  14 Payment to an account in the contractor's own name
  15 No request for cash
  16 What the client is exposed to at each stage
  17 Receipt for anything already paid
  18 Insurance held by the contractor
  19 Who else will work on site
  20 Guarantee on the finished work
  21 Permissions needed for the work
  22 Start date, working duration and completion date
  23 What happens if the contractor is late
  24 What happens if the client stops the work
  25 How a disagreement is settled`,

  condition: `SERVICE BRIEF: Condition Report.

This is a physical inspection of a property. Your source material is what the inspector recorded on the visit and the photograph captions with it.

Your findings are about the condition of what was seen, each one its own finding, described as recorded. What was not looked at, or could not be reached or seen on the day, goes in "omitted" so the person signing knows the boundary of the visit before they sign it.`,

  technical_signoff: `SERVICE BRIEF: Technical Sign-off.

This is an attendance on work in progress or work presented as complete, to record whether what is there is what was specified.

Your findings are about what was found against what was supposed to be done: what is present, what is absent, what was recorded about how it was carried out, and what is still outstanding. Whether the work passes is the verdict, and rule 2 means it is not yours to write.`,

  visual_check: `SERVICE BRIEF: Visual Check.

This is a short visual attendance, often on a job the client arranged themselves, where Yaadly supplies only the eyes.

Your findings are about what was visible on the day and nothing beyond it. This is the thinnest of the four services and the draft should stay thin: a small number of findings, each plainly what was seen. Do not pad it out to look like a bigger report.`,
};

// The rules first, the brief second, and a loud failure rather than a quiet
// generic draft if a kind ever arrives without one. KINDS and BRIEFS are
// checked against each other at the bottom of this file.
function systemFor(kind: string): string {
  return `${SYSTEM}\n\n${BRIEFS[kind]}`;
}

// One rule, from _shared/measurements.ts. This was a second hand-typed copy of
// the sketch pack's pattern until 5 September 2026, and the two were equivalent
// only because nobody had touched either since August. A bare "in" is still
// deliberately not a unit, because "1 in 5 tiles is cracked" is ordinary
// English. A fresh regex each call, because a global one carries lastIndex.
const measurementRe = () => measurementRegExp("gi");

// The figure rule, from _shared/figures.ts, added 25 September 2026 after the
// first real Deposit Protection Check came back carrying four sums of money
// lifted out of the notes, hours after rule 4 had been rewritten to forbid
// exactly that. A rule that lives only in the prompt is a wish. A fresh regex
// each call, because a global one carries lastIndex.
const figureRe = () => figureRegExp("gi");

type Scrub = { where: string; text: string };

function scrub(text: string, where: string, found: Scrub[]): string {
  if (!text) return text;
  let out = text.replace(measurementRe(), (m) => {
    found.push({ where, text: m.trim() });
    return " [size removed] ";
  });
  out = out.replace(figureRe(), (m) => {
    found.push({ where, text: m.trim() });
    return " [figure removed] ";
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

// The house checklist for a Deposit Protection Check. The model supplies a
// state and a note against each line; the line itself, and the one line on
// why it matters, are fixed here, so a client buying the same service twice
// gets the same list twice, including the lines where nothing was wrong. Keep
// this in step with the numbered list in the deposit_check brief above; the
// two are asserted equal at load.
//
// 18 lines until 28 September 2026. The seven added that day (waste, own
// account, cash, who else is on site, guarantee, permissions, disputes) came
// out of comparing the document against published guidance on reviewing a
// builder's quote. A report drafted before then carries 18, and the renderer
// prints whatever the report stored rather than this list.
const DEPOSIT_CHECKLIST: { item: string; group: string; why: string }[] = [
  ["Contractor named on the quote", "identity", "You need to know who you are agreeing with."],
  ["Business registration or TRN", "identity", "The only formal way to identify them later."],
  ["Verifiable address and a number other than WhatsApp", "identity", "A WhatsApp number can disappear overnight."],
  ["Independent trace of the business", "identity", "Past work others can see is the best evidence of a track record."],
  ["Quote in writing and dated", "the quote", "Fixes what was offered and when."],
  ["Quote itemised by element of work", "the quote", "Lets each stage be matched to what it pays for."],
  ["Labour and materials separated", "the quote", "Shows how much of the money is materials you could own."],
  ["Quantities and specification stated", "the quote", "Stops cheaper materials being swapped in."],
  ["Who supplies the materials", "materials", "Decides who you pay for them."],
  ["Who owns the materials once paid for", "materials", "Decides whether they are yours if the job stops."],
  ["Who receives deliveries on site", "materials", "Somebody has to count what arrives."],
  ["Waste removal and clean up", "materials", "Often left out, then charged as extra."],
  ["Payment structure written down", "money", "The single biggest source of risk on a job like this."],
  ["Payment to an account in the contractor's own name", "money", "Makes every payment traceable to the contractor and the job."],
  ["No request for cash", "money", "Cash leaves no record."],
  ["What the client is exposed to at each stage", "money", "Tells you the most you could lose at any moment."],
  ["Receipt for anything already paid", "money", "Your record of what has moved."],
  ["Insurance held by the contractor", "risk", "Covers damage or injury on your property."],
  ["Who else will work on site", "risk", "You should know who is in your house."],
  ["Guarantee on the finished work", "risk", "Says what happens if something fails after they leave."],
  ["Permissions needed for the work", "risk", "Some work needs the local authority told before it starts."],
  ["Start date, working duration and completion date", "programme", "Without dates, nothing is ever late."],
  ["What happens if the contractor is late", "programme", "Gives you a point at which to act."],
  ["What happens if the client stops the work", "programme", "Protects the contractor as well as you."],
  ["How a disagreement is settled", "programme", "Agreed now, it is a process. Agreed later, it is a fight."],
].map(([item, group, why]) => ({ item, group, why }));

for (const [i, row] of DEPOSIT_CHECKLIST.entries()) {
  if (!BRIEFS.deposit_check.includes(`${i + 1} ${row.item}`)) {
    throw new Error(`yaad-report: checklist line ${i + 1} differs between DEPOSIT_CHECKLIST and the brief.`);
  }
}

// The payment terms Yaadly recommends in place of whatever the builder asked
// for. The model fills in only the left column, what was proposed and where
// it says so; the right two columns are the house standard and are written
// here, not by the model, for the same reason the checklist lines are. Added
// 28 September 2026 on Monique's instruction ("include payment terms also
// based on information"). The two working days and the ten working days are
// her numbers to change; they are a standard, not a price, and there is no
// sum of money anywhere in this list.
const PAYMENT_TERMS: { term: string; instead: string; why: string }[] = [
  ["Money before work", "Nothing before the materials are on site. The first payment is stage 1 of the schedule.", "Your money should never be ahead of what you can see."],
  ["Who is paid", "An account in the contractor's own name, confirmed in writing, or the materials supplier directly.", "A payment has to be traceable to the contractor and the job."],
  ["How it is paid", "Bank transfer only. Never cash, and never a transfer to a person collecting on their behalf.", "A transfer is a record. Cash is not."],
  ["Materials", "Supplier invoices made out in your name. Pay the supplier directly if the contractor agrees.", "Materials in your name are yours if the job stops."],
  ["Stages", "Paid in stages, each only against the evidence in the payment schedule.", "Money follows progress you can see from abroad."],
  ["When a stage is paid", "Within two working days of the evidence arriving, so the contractor is never kept waiting once the work is proven.", "Protects the contractor as much as you. Fair terms are easier to hold them to."],
  ["Receipts", "A written receipt for every payment, dated, naming the stage.", "Your record of what has been paid and for what."],
  ["The last payment", "Paid only once a snag list is agreed and every item on it is signed off.", "Finished needs a definition both of you signed."],
  ["Currency", "Each stage fixed in Jamaican dollars in writing, so an exchange rate move does not change what is owed.", "Removes an argument before it starts."],
  ["If work stops", "If no work happens for ten working days without a written reason, no further stage is paid until you have both agreed a new date in writing.", "Gives you a clear point at which to act."],
  ["Changes", "No extra work is paid unless it is agreed in writing before it starts.", "The most common way a job goes over."],
].map(([term, instead, why]) => ({ term, instead, why }));

for (const [i, row] of PAYMENT_TERMS.entries()) {
  if (!BRIEFS.deposit_check.includes(`  ${i + 1} ${row.term}\n`)) {
    throw new Error(`yaad-report: payment term ${i + 1} differs between PAYMENT_TERMS and the brief.`);
  }
}

// The builder's quote, line by line, taken out of what yaad-report-read
// transcribed. Numbered here so the model can point a finding at a line and
// the document can reproduce the quote with the finding's number beside it.
// Verbatim and unscreened, figures included, for the same reason source_text
// is: it is the record of what the builder wrote, not the agent's words, and
// the document says so above it. Only the first quote is taken; the reader's
// "Layout:" line is its own description, not the builder's, and is dropped.
function quoteFrom(source: string | null): { doc: number; lines: string[] } | null {
  if (!source) return null;
  const m = /^DOCUMENT (\d+) \(quote\)[^\n]*:\n([\s\S]*?)(?=\n\s*\n(?:DOCUMENT|PHOTOGRAPH) \d|\s*(?![\s\S]))/m.exec(source);
  if (!m) return null;
  const lines = m[2].split("\n").map((l) => l.trim()).filter((l) => l && !/^layout:/i.test(l)).slice(0, 60);
  return lines.length ? { doc: Number(m[1]), lines: lines.map((l) => l.slice(0, 300)) } : null;
}

const CHECK_STATES = new Set(["provided", "confirmed", "not_provided", "not_found", "referred", "not_applicable"]);

// A kind with no brief would silently fall back to a generic draft, which is
// the exact failure this change exists to end. Fail at module load instead, so
// the deploy is what breaks and not a client's report.
for (const k of KINDS) {
  if (!BRIEFS[k]) throw new Error(`yaad-report: no SERVICE BRIEF for kind "${k}".`);
}

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

    // Screen mode, 28 September 2026. When a line of a drafted report is
    // corrected by hand at the desk, the wording is checked here against the
    // same banned-language list the draft was, before edit_report() writes it.
    // No model, no database, nothing saved: one list, read by both paths.
    // edit_report() itself refuses figures and measurements, so a correction
    // meets every screen a draft meets.
    if (body.mode === "screen") {
      const hits = guardrails.scan(String(body.text ?? ""));
      return json({ ok: hits.length === 0, banned: hits.map((b) => ({ term: b.term, guidance: b.guidance })) });
    }

    const kind = String(body.kind ?? "");
    const notes = String(body.notes ?? "").trim();
    const captions = Array.isArray(body.captions) ? (body.captions as unknown[]).map(String) : [];
    const jobId = body.job_id ? String(body.job_id) : null;
    const serviceId = body.service_id ? String(body.service_id) : null;
    // What yaad-report-read transcribed, kept verbatim on the report as the
    // record of the source. Not screened, on purpose: see 20260925230000.
    const sourceText = body.source_text ? String(body.source_text).slice(0, 40_000) : null;

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

    // The heading over the notes used to say "INSPECTOR'S NOTES FROM THE VISIT"
    // for all four services, which contradicts a deposit check brief that says
    // in terms that usually nobody visited. Two instructions disagreeing in one
    // prompt is worse than either alone.
    const NOTES_LABEL: Record<string, string> = {
      deposit_check: "REVIEWER'S NOTES ON THE CONTRACTOR, THE QUOTE AND WHAT THE CLIENT WAS TOLD",
      condition: "INSPECTOR'S NOTES FROM THE VISIT",
      technical_signoff: "INSPECTOR'S NOTES FROM THE ATTENDANCE",
      visual_check: "INSPECTOR'S NOTES FROM THE VISIT",
    };

    // The quote, numbered, from the notes as corrected at the desk first and
    // the reader's own transcript only if the notes no longer carry it, so a
    // digit fixed by hand is the digit the document reproduces.
    const quote = kind === "deposit_check" ? (quoteFrom(notes) ?? quoteFrom(sourceText)) : null;

    const userBlock = [
      `SERVICE: ${kind}`,
      `${NOTES_LABEL[kind]}:\n${notes}`,
      captions.length ? `PHOTOGRAPH CAPTIONS:\n${captions.map((c, i) => `${i + 1}. ${c}`).join("\n")}` : "",
      quote ? `QUOTE, LINE BY LINE (document ${quote.doc}):\n${quote.lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n");

    // A desk call, not a webhook: the person drafting can wait for the file.
    // Two retries with up to fifteen seconds of Retry-After honoured, and then
    // the failover in chatWithFailover if a fallback provider is configured.
    // Until 6 September 2026 this was a bare fetch, so a single 429 from
    // Mistral was a 502 to the desk and no report.
    const raw = await trace.span(`chat ${prov.model}`, SpanKind.CLIENT, {
      ...providerAttrs(prov),
      "gen_ai.operation.name": "chat",
      "gen_ai.request.temperature": 0,
    }, async (s) => {
      const { provider, res: r } = await chatWithFailover(prov, {
        temperature: 0,
        // Room for a reasoning model to think and then still answer. Raised
        // from 6000 on 28 September 2026, when the deposit check grew from
        // five sections to thirteen.
        max_tokens: 12000,
        messages: [
          { role: "system", content: systemFor(kind) },
          { role: "user", content: userBlock },
        ],
      }, { timeoutMs: 90_000, retries: 2, maxRetryWaitMs: 15_000 });
      let j: any = {};
      try { j = await r.json(); } catch (_) { /* a non-JSON body reads as an empty answer below */ }
      s.setAttributes({
        ...providerAttrs(provider),
        "http.response.status_code": r.status,
        "gen_ai.response.model": j?.model,
        "gen_ai.response.finish_reasons": j?.choices?.[0]?.finish_reason,
        "gen_ai.usage.input_tokens": j?.usage?.prompt_tokens,
        "gen_ai.usage.output_tokens": j?.usage?.completion_tokens,
      });
      if (!r.ok) {
        const msg = `yaad-report draft: ${provider.name} http ${r.status}`;
        s.recordError(msg); console.error(msg);
      }
      return j?.choices?.[0]?.message?.content ?? "";
    });

    // Thinking stripped and the first JSON object taken, since 6 September
    // 2026: MiniMax reasons in a <think> block first, and the old parse read
    // that block as the draft and refused it.
    const parsed: Record<string, any> | null = firstJsonObject(raw);
    if (!parsed) {
      console.error(`yaad-report draft: answer was not JSON: ${answerText(raw).slice(0, 300)}`);
      return fail("The agent did not return a usable draft. Try again, or write the notes more plainly.", 502);
    }

    const found: Scrub[] = [];
    const findings = (Array.isArray(parsed.findings) ? parsed.findings : [])
      .slice(0, 40)
      .map((f: Record<string, unknown>, i: number) => {
        const heading = deRate(scrub(String(f?.heading ?? "").trim(), `finding ${i + 1} heading`, found), `finding ${i + 1} heading`, found);
        const bodyText = deRate(scrub(String(f?.body ?? "").trim(), `finding ${i + 1} body`, found), `finding ${i + 1} body`, found);
        const why = deRate(scrub(String(f?.why ?? "").trim(), `finding ${i + 1} why`, found), `finding ${i + 1} why`, found);
        const action = deRate(scrub(String(f?.action ?? "").trim(), `finding ${i + 1} action`, found), `finding ${i + 1} action`, found);
        return { ord: i + 1, heading, body: bodyText, why: why || null, action: action || null };
      })
      .filter((f: { heading: string; body: string }) => f.heading && f.body);

    if (!findings.length) {
      return fail("The agent produced no usable findings from those notes.", 502);
    }

    // The deposit check's other sections, screened exactly like a finding:
    // measurements and figures scrubbed, ratings removed, and the whole lot
    // goes through the banned-language screen below with the findings. The
    // checklist keeps only a state and a note per line; the line text is
    // DEPOSIT_CHECKLIST's, never the model's. Empty object on the other
    // three services.
    const clean = (v: unknown, where: string) => deRate(scrub(String(v ?? "").trim(), where, found), where, found);
    const list = (v: unknown, where: string, n: number) =>
      (Array.isArray(v) ? v : []).slice(0, n).map((x, i) => clean(x, `${where} ${i + 1}`)).filter(Boolean);
    let sections: Record<string, unknown> = {};
    if (kind === "deposit_check") {
      const sx = (parsed.sections && typeof parsed.sections === "object") ? parsed.sections as Record<string, unknown> : {};
      const stages = (Array.isArray(sx.payment_stages) ? sx.payment_stages : []).slice(0, 8)
        .map((st: Record<string, unknown>, i: number) => ({
          stage: clean(st?.stage, `payment stage ${i + 1}`),
          when: clean(st?.when, `payment stage ${i + 1} when`),
          evidence: clean(st?.evidence, `payment stage ${i + 1} evidence`),
        })).filter((st: { stage: string; when: string }) => st.stage && st.when);
      const states = Array.isArray(sx.checklist) ? sx.checklist : [];
      const checklist = DEPOSIT_CHECKLIST.map((row, i) => {
        const st = (states[i] && typeof states[i] === "object") ? states[i] as Record<string, unknown> : {};
        const state = CHECK_STATES.has(String(st.state)) ? String(st.state) : "not_provided";
        return { item: row.item, group: row.group, why: row.why, state, note: clean(st.note, `checklist ${i + 1} note`) || null };
      });
      const obj = (v: unknown) => (v && typeof v === "object" ? v as Record<string, unknown> : {});
      const arr = (v: unknown, n: number) => (Array.isArray(v) ? v : []).slice(0, n).map(obj);
      const nLines = quote ? quote.lines.length : 0;
      const refs = arr(sx.finding_refs, 40);
      const finding_refs = findings.map((f: { ord: number }, i: number) => ({
        ord: f.ord,
        source: clean(refs[i]?.source, `finding ${f.ord} source`) || null,
        lines: (Array.isArray(refs[i]?.lines) ? refs[i].lines as unknown[] : [])
          .map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= nLines).slice(0, 10),
      }));
      const g = obj(sx.glance);
      const proposed = arr(sx.payment_terms, PAYMENT_TERMS.length);
      const payment_terms = PAYMENT_TERMS.map((t, i) => ({
        term: t.term,
        proposed: clean(proposed[i]?.proposed, `payment term ${i + 1}`) || "Not stated",
        source: clean(proposed[i]?.source, `payment term ${i + 1} source`) || null,
        instead: t.instead,
        why: t.why,
      }));
      const ords = new Set(findings.map((f: { ord: number }) => f.ord));
      sections = {
        finding_refs,
        glance: {
          proposed: clean(g.proposed, "at a glance, as proposed"),
          proposed_detail: clean(g.proposed_detail, "at a glance, as proposed, detail"),
          ours: clean(g.ours, "at a glance, as recommended"),
          ours_detail: clean(g.ours_detail, "at a glance, as recommended, detail"),
        },
        documents: arr(sx.documents, 20).map((d, i) => ({
          what: clean(d.what, `document ${i + 1}`), dated: clean(d.dated, `document ${i + 1} date`), form: clean(d.form, `document ${i + 1} form`),
        })).filter((d) => d.what),
        checked: clean(sx.checked, "checked independently"),
        next_payment: clean(sx.next_payment, "next payment asked for"),
        get_before_paying: arr(sx.get_before_paying, 12).map((d, i) => ({
          document: clean(d.document, `document to get ${i + 1}`),
          finding: ords.has(Number(d.finding)) ? Number(d.finding) : null,
        })).filter((d) => d.document),
        next_steps: arr(sx.next_steps, 8).map((st, i) => ({
          step: clean(st.step, `next step ${i + 1}`), who: clean(st.who, `next step ${i + 1} who`), when: clean(st.when, `next step ${i + 1} when`),
        })).filter((st) => st.step),
        payment_terms,
        scope_included: list(sx.scope_included, "scope included", 20),
        scope_not_stated: list(sx.scope_not_stated, "scope not stated", 30),
        payment_stages: stages,
        ask_the_builder: clean(sx.ask_the_builder, "message to the builder").slice(0, 6000),
        checklist,
      };
    }
    const sectionsText = JSON.stringify(sections);
    // Added after the screen, not before: the quote is the builder's words,
    // figures and all, and screening it would either refuse the draft over a
    // sum the builder wrote or scrub the one place the document is meant to
    // show exactly what was quoted.
    if (quote) sections.quote = quote;

    // The banned-language screen, on everything a client would read. A hit is
    // reported rather than silently rewritten, because the desk needs to know
    // the model reached for that word at all.
    const blob = findings.map((f: { heading: string; body: string; why: string | null; action: string | null }) =>
      `${f.heading}\n${f.body}\n${f.why ?? ""}\n${f.action ?? ""}`).join("\n\n") + "\n\n" + sectionsText;
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
        // Kept, not just returned. Until 25 September 2026 these two lived
        // only in the HTTP response, so rule 5's referrals to an attorney or a
        // PERB registered engineer survived exactly as long as the browser tab
        // that asked for the draft. 20260925220000 added the columns.
        omitted: Array.isArray(parsed.omitted) ? parsed.omitted.slice(0, 20) : [],
        questions: Array.isArray(parsed.questions) ? parsed.questions.slice(0, 20) : [],
        source_text: sourceText,
        sections,
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
      sections: Object.keys(sections),
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
