// The six services other than the Deposit Protection Check, drafted into the
// layout of their blank templates (scripts/report-templates/services).
//
// Added 28 September 2026 on Monique's instruction: every service has a
// template, and the agent drafts into it once the service is booked. The
// Deposit Protection Check stays in index.ts where it was built.
//
// What each brief may and may not ask for. Every brief sits under the same
// rules in SYSTEM (no rating, no verdict, no measurement, no figure, nothing
// the notes did not record), and nothing here loosens one. On top of that:
//
//   * The Visual Check and Property Care are records. The agent writes no
//     "why" and, on the Visual Check, no "action" either: services.html says
//     "They record. They do not rate or advise." A rating on either is refused
//     by the database (20260928230000).
//   * A result (released, complete) and a status (on track, at risk) are
//     judgements. They are typed at the desk into reports.human, never here.
//   * Money appears in no brief. On the oversight report and the stage record
//     it is typed by hand, into reports.human, and nowhere else.
//
// Every enum below is checked on the way out, and anything the model sends
// that is not on the list becomes the neutral value, never a guess.

export const EXTRA_KINDS = ["property_care", "oversight", "pm_stage"] as const;

export const NOTES_LABEL_EXTRA: Record<string, string> = {
  property_care: "VISITOR'S NOTES FROM THE PROPERTY CARE VISIT",
  oversight: "NOTES FROM THIS MONTH: SITE VISITS, MESSAGES, THE MONTHLY CALL",
  pm_stage: "INSPECTOR'S NOTES FROM THE STAGE INSPECTION",
};

export const ELEMENTS = ["roof", "structure", "water", "electrics", "drainage", "termites", "security", "external"] as const;
const AREAS_VC = ["client", "outside", "inside", "services"] as const;
const STATES_VC = ["recorded", "part", "no_access"] as const;
const PC_STATE = ["nothing_noted", "noted", "called_on_site", "no_access", "not_recorded"] as const;
const PC_SINCE = ["new", "same", "worse", "resolved", ""] as const;
const CHANGE_STATE = ["asked", "priced", "agreed", "turned_down", "withdrawn", ""] as const;
const ACTION_STATE = ["done", "open", "blocked", "dropped", ""] as const;

// The Property Care house checklist. Same list on every visit, so a line
// that was fine is still on the page and "since last visit" means something.
// The model supplies a state and a note per line; the line text is fixed here.
export const PROPERTY_CARE_CHECKLIST: { item: string; group: string }[] = [
  ["Gate, padlock and entrance", "outside"],
  ["Boundary wall or fence, all sides", "outside"],
  ["Yard, driveway and paths", "outside"],
  ["Trees and vegetation near the house or the roof", "outside"],
  ["Roof, as seen from the ground", "outside"],
  ["Gutters and downpipes", "outside"],
  ["External walls, all sides", "outside"],
  ["Windows, grilles and burglar bars", "outside"],
  ["External doors and locks", "outside"],
  ["Outside lights", "outside"],
  ["Post, flyers or notices left at the gate", "outside"],
  ["Signs of entry, damage or somebody staying", "outside"],
  ["Ceilings, for stains", "inside"],
  ["Walls and floors", "inside"],
  ["Windows and locks, from inside", "inside"],
  ["Smell, damp or mould", "inside"],
  ["Water supply on, or left off as agreed", "water, power and drains"],
  ["Taps run, hot and cold", "water, power and drains"],
  ["Toilets flushed and drains run", "water, power and drains"],
  ["Under sinks, around toilets and the water heater, for leaks", "water, power and drains"],
  ["Water tank, lid, overflow and pump", "water, power and drains"],
  ["Electricity on, board checked for tripped switches", "water, power and drains"],
  ["Lights or timers as agreed", "water, power and drains"],
  ["Septic tank or absorption pit cover", "water, power and drains"],
  ["Termite signs: mud tubes, droppings, soft or hollow wood", "pests, damp and storm"],
  ["Rodent signs", "pests, damp and storm"],
  ["Insects, wasp or bee nests", "pests, damp and storm"],
  ["Standing water outside", "pests, damp and storm"],
  ["Loose items that would move in a strong wind", "pests, damp and storm"],
].map(([item, group]) => ({ item, group }));

const numbered = (rows: { item: string }[]) => rows.map((r, i) => `  ${i + 1} ${r.item}`).join("\n");

export const BRIEFS_EXTRA: Record<string, string> = {
  condition: `SERVICE BRIEF: Condition Report.

This is a record of the condition of a property, gathered on site by the person named in the notes, often not the person who will rate it. Your source material is what was recorded on the visit and the photograph captions with it. The report is written for a project manager to rate; it is not a building survey, and you must not write as if it were one.

Your findings are about the condition of what was seen, each one its own finding, described as recorded, with where it is. Electrics, termites and structure are recorded as seen and never judged: "the board cover is cracked and a cable runs loose beside it" is a finding, "the wiring is unsafe" is not. What was not looked at, or could not be reached or seen, goes in "omitted".

IN ADDITION, return a top-level "sections" object beside "findings", exactly this shape:
{"sections":{"finding_refs":[{"element":"","where":""}],"limits":{"roof":{"seen":"","not_seen":""}},"property":{"type":"","age":"","storeys":"","walls":"","roof":"","floors":"","water":"","waste":"","power":""},"visit":{"weather":"","occupied":"","access":"","present":""},"documents_to_get":[{"document":"","from":"","why":""}]}}

- "finding_refs": one entry per finding, in the same order. "element" is exactly one of: ${ELEMENTS.join(", ")}. "where" is the place in the property, in words.
- "limits": one entry per element the notes say anything about, keyed by the element name. "seen" says how it was seen ("from the ground", "from inside the roof space"); "not_seen" says what could not be seen and why. Only what the notes record.
- "property": what the notes say the property is. Empty strings where they do not say. Never guess an age.
- "visit": the weather, whether it was occupied or furnished, how access was gained, and who was present, as recorded.
- "documents_to_get": documents the client should ask for because of a finding (an electrical certificate, a pest control report, a roof warranty), who from, and why. Only where a finding supports it.
- "questions" starts each entry with the profession and a colon: "Licensed electrician: ...", "Pest control operator: ...", "Structural engineer: ...".`,

  technical_signoff: `SERVICE BRIEF: Technical Sign-off.

This is an inspection of one stage of work by a qualified trade inspector, who is named in the notes and is never the person who did the work. Your source material is the inspector's notes: what the work was checked against, what was checked, and what was found.

Your findings are the things found that do not match what was agreed or specified: each one a fact, where it is, and what was supposed to be there. They become the put right list. Whether the stage is released is the result, and it is typed by a person; it is not yours to write or imply.

IN ADDITION, return a top-level "sections" object beside "findings", exactly this shape:
{"sections":{"stage":{"stage":"","trade":"","work_by":""},"standard":[{"document":"","reference":""}],"checks":[{"what":"","pass_mark":"","how":"","found":""}],"finding_refs":[{"where":"","check":0}]}}

- "stage": the stage inspected, the trade, and who carried out the work, as the notes name them.
- "standard": what the work was checked against, as the notes record it (the scope of work, drawings, the manufacturer's instructions), with any date or version given. Never add one the notes do not name.
- "checks": every check the notes record, in order. "what" is what was checked; "pass_mark" is what had to be true, only as the notes state it, in words and never as a tolerance or size; "how" is seen or tested; "found" is what was actually there, in words. Leave "pass_mark" empty rather than supply one.
- "finding_refs": one per finding, in order: "where" in words, and "check", the number of the check it came from, or 0.`,

  visual_check: `SERVICE BRIEF: Visual Check.

This is a photographic record taken by a checker against a checklist agreed with the client. It records what was there. It does not rate, judge or advise, and the client was sold exactly that.

Each finding is one item on the record: "heading" names the item, "body" says plainly what the photographs show and where, as a description of what is in the frame. Leave "why" and "action" empty on every finding. Never say whether anything is a problem, serious, fine, normal or worth doing something about. Keep it as thin as the notes are.

IN ADDITION, return a top-level "sections" object beside "findings", exactly this shape:
{"sections":{"finding_refs":[{"area":"","state":"","photos":""}],"visit":{"scheduled":"","time_in":"","time_out":"","weather":"","access":""}}}

- "finding_refs": one per finding, in order. "area" is exactly one of: client (an item the client asked for by name), outside, inside, services. "state" is exactly one of: recorded, part (only part could be photographed), no_access. "photos" is the photograph numbers the notes give, or empty.
- "visit": as the notes record it. Empty strings where they do not.`,

  property_care: `SERVICE BRIEF: Property Care visit.

This is a routine visit to an empty, rented or elder occupied home, run against the same checklist every time. The visitor records what is seen and passes messages on. The visitor gives no personal or medical care and no opinion on anybody's health.

Each finding is something the notes record as needing the owner's decision: "heading" names it, "body" says what was seen and where, and "action" may suggest the next step in one sentence (watch it next visit, a closer look, a trade to quote) because the owner decides. Leave "why" empty.

IN ADDITION, return a top-level "sections" object beside "findings", exactly this shape:
{"sections":{"visit":{"plan":"","home":"","visit_number":"","time_in":"","time_out":"","weather":"","access":"","alarm_in":"","alarm_out":""},"readings":[{"reading":"","value":""}],"checklist":[{"state":"","since":"","note":""}],"resident":{"seen":"","spoke":"","passed_on":""},"carried_forward":[{"item":"","first_noted":"","status":""}],"next_visit":""}}

- "readings": meter readings, the tank level and similar, exactly as the notes give them. Write a meter reading as plain digits with no commas.
- "checklist": exactly ${PROPERTY_CARE_CHECKLIST.length} entries, in this order, one per line below. "state" is exactly one of: ${PC_STATE.join(", ")}. Use called_on_site only when the notes record that the owner was called or messaged during the visit, and not_recorded when the notes say nothing about the line. "since" is exactly one of: new, same, worse, resolved, or empty, only where the notes compare with the last visit. Do not repeat the line text; the order is the key.
${numbered(PROPERTY_CARE_CHECKLIST)}
- "resident": only if somebody lives there. What was seen and said, and what they asked to be passed on in their own words. Never a remark about their health.
- "carried_forward": items the notes say are still open from an earlier visit.`,

  oversight: `SERVICE BRIEF: Oversight Retainer, the monthly report.

This is the monthly report to a client whose build is being overseen: the site visits made this month, by the people named in the notes, and what the builder and the client said in writing. Yaadly observes and reports. It does not instruct the builder, certify the work or estimate cost.

Your findings are the issues and risks of the month: each one what happened or what could go wrong, why it matters, and what could be done. The status of the month (on track, at risk, off track) and every sum of money are typed by a person; write neither and imply neither.

IN ADDITION, return a top-level "sections" object beside "findings", exactly this shape:
{"sections":{"attendance":[{"date":"","attended_by":"","builder_on_site":"","workers":"","weather":""}],"done":[],"next":[],"milestones":[{"milestone":"","agreed":"","forecast":""}],"changes":[{"change":"","asked_by":"","time_effect":"","state":""}],"quality":[{"seen":"","where":"","raised_with":"","on":""}],"insurance_seen":"","decisions":[{"decision":"","options":"","needed_by":"","if_missed":""}],"escalations":[{"when":"","raised_by":"","what":"","done":""}],"call":{"date":"","attendees":"","points":[]},"actions":[{"action":"","owner":"","due":"","state":""}]}}

- "attendance": every site visit this month, as recorded.
- "done" and "next": work done this month as seen on site, and work planned for next month as the builder has stated it, one line each.
- "milestones": dates only as the notes give them. Never work out whether something is late.
- "changes": every change to the agreed scope. "state" is exactly one of: asked, priced, agreed, turned_down, withdrawn. Never the price of a change.
- "insurance_seen": yes, no, or not_recorded.
- "actions": from the monthly call. "state" is exactly one of: done, open, blocked, dropped.`,

  pm_stage: `SERVICE BRIEF: Full Project Management, the stage completion record.

This is Yaadly's record of one stage of a build it manages, checked against the agreed scope by somebody who did not do the work. It is a project record between Yaadly and the client. It is not a certificate issued under any law, building code or professional scheme, and you must never call it one.

Your findings are the items still open at this stage: each one a fact, where it is, and what has to happen before it closes. Whether the stage is complete is the result, typed by a person. Its value is money, typed by a person. Write neither and imply neither.

IN ADDITION, return a top-level "sections" object beside "findings", exactly this shape:
{"sections":{"stage":{"stage":"","trade":"","inspected_by":""},"checks":[{"scope_item":"","pass_mark":"","found":""}],"finding_refs":[{"where":"","close_by":""}]}}

- "checks": every scope item the notes record checking, with the pass mark only as the notes state it, in words, and what was found, in words.
- "finding_refs": one per finding, in order: where, and the date or stage it must close by, only as the notes give it.`,
};

type Clean = (v: unknown, where: string) => string;
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const arr = (v: unknown, n: number) => (Array.isArray(v) ? v : []).slice(0, n).map(obj);
const pick = <T extends readonly string[]>(v: unknown, allowed: T, fallback: T[number]): T[number] =>
  (allowed as readonly string[]).includes(String(v)) ? String(v) as T[number] : fallback;

// Turns what the model sent into the sections a kind stores, screened the
// same way as a finding. Returns the sections, and the findings with any
// field that kind may not carry emptied.
export function sectionsFor(
  kind: string,
  parsed: Record<string, unknown>,
  findings: { ord: number; heading: string; body: string; why: string | null; action: string | null }[],
  clean: Clean,
): Record<string, unknown> {
  const sx = obj(parsed.sections);
  const rows = (v: unknown, n: number, fields: string[], where: string) =>
    arr(v, n).map((r, i) => Object.fromEntries(fields.map((f) => [f, clean(r[f], `${where} ${i + 1} ${f}`)])))
      .filter((r) => Object.values(r).some(Boolean));
  const lines = (v: unknown, n: number, where: string) =>
    (Array.isArray(v) ? v : []).slice(0, n).map((x, i) => clean(x, `${where} ${i + 1}`)).filter(Boolean);
  const one = (v: unknown, fields: string[], where: string) => {
    const o = obj(v);
    return Object.fromEntries(fields.map((f) => [f, clean(o[f], `${where} ${f}`)]));
  };
  const refs = arr(sx.finding_refs, 40);

  if (kind === "condition") {
    const limits: Record<string, unknown> = {};
    const l = obj(sx.limits);
    for (const e of ELEMENTS) if (l[e]) limits[e] = one(l[e], ["seen", "not_seen"], `limits ${e}`);
    return {
      finding_refs: findings.map((f, i) => ({ ord: f.ord, element: pick(refs[i]?.element, ELEMENTS, "external"), where: clean(refs[i]?.where, `finding ${f.ord} where`) })),
      limits,
      property: one(sx.property, ["type", "age", "storeys", "walls", "roof", "floors", "water", "waste", "power"], "property"),
      visit: one(sx.visit, ["weather", "occupied", "access", "present"], "visit"),
      documents_to_get: rows(sx.documents_to_get, 10, ["document", "from", "why"], "document to get"),
    };
  }
  if (kind === "technical_signoff") {
    const checks = rows(sx.checks, 30, ["what", "pass_mark", "how", "found"], "check");
    return {
      stage: one(sx.stage, ["stage", "trade", "work_by"], "stage"),
      standard: rows(sx.standard, 10, ["document", "reference"], "standard"),
      checks,
      finding_refs: findings.map((f, i) => {
        const n = Number(refs[i]?.check);
        return { ord: f.ord, where: clean(refs[i]?.where, `finding ${f.ord} where`), check: Number.isInteger(n) && n >= 1 && n <= checks.length ? n : null };
      }),
    };
  }
  if (kind === "visual_check") {
    for (const f of findings) { f.why = null; f.action = null; }
    return {
      finding_refs: findings.map((f, i) => ({
        ord: f.ord,
        area: pick(refs[i]?.area, AREAS_VC, "outside"),
        state: pick(refs[i]?.state, STATES_VC, "recorded"),
        photos: clean(refs[i]?.photos, `finding ${f.ord} photos`),
      })),
      visit: one(sx.visit, ["scheduled", "time_in", "time_out", "weather", "access"], "visit"),
    };
  }
  if (kind === "property_care") {
    for (const f of findings) f.why = null;
    const states = Array.isArray(sx.checklist) ? sx.checklist : [];
    return {
      visit: one(sx.visit, ["plan", "home", "visit_number", "time_in", "time_out", "weather", "access", "alarm_in", "alarm_out"], "visit"),
      readings: rows(sx.readings, 10, ["reading", "value"], "reading"),
      checklist: PROPERTY_CARE_CHECKLIST.map((row, i) => {
        const st = obj(states[i]);
        return { item: row.item, group: row.group, state: pick(st.state, PC_STATE, "not_recorded"), since: pick(st.since, PC_SINCE, ""), note: clean(st.note, `checklist ${i + 1} note`) || null };
      }),
      resident: one(sx.resident, ["seen", "spoke", "passed_on"], "resident"),
      carried_forward: rows(sx.carried_forward, 12, ["item", "first_noted", "status"], "carried forward"),
      next_visit: clean(sx.next_visit, "next visit"),
    };
  }
  if (kind === "oversight") {
    const call = obj(sx.call);
    return {
      attendance: rows(sx.attendance, 12, ["date", "attended_by", "builder_on_site", "workers", "weather"], "visit"),
      done: lines(sx.done, 15, "done this month"),
      next: lines(sx.next, 15, "planned next month"),
      milestones: rows(sx.milestones, 15, ["milestone", "agreed", "forecast"], "milestone"),
      changes: arr(sx.changes, 15).map((c, i) => ({
        change: clean(c.change, `change ${i + 1}`), asked_by: clean(c.asked_by, `change ${i + 1} asked by`),
        time_effect: clean(c.time_effect, `change ${i + 1} time`), state: pick(c.state, CHANGE_STATE, ""),
      })).filter((c) => c.change),
      quality: rows(sx.quality, 12, ["seen", "where", "raised_with", "on"], "quality"),
      insurance_seen: pick(sx.insurance_seen, ["yes", "no", "not_recorded"] as const, "not_recorded"),
      decisions: rows(sx.decisions, 10, ["decision", "options", "needed_by", "if_missed"], "decision"),
      escalations: rows(sx.escalations, 15, ["when", "raised_by", "what", "done"], "escalation"),
      call: { date: clean(call.date, "call date"), attendees: clean(call.attendees, "call attendees"), points: lines(call.points, 12, "call point") },
      actions: arr(sx.actions, 15).map((a, i) => ({
        action: clean(a.action, `action ${i + 1}`), owner: clean(a.owner, `action ${i + 1} owner`),
        due: clean(a.due, `action ${i + 1} due`), state: pick(a.state, ACTION_STATE, "open"),
      })).filter((a) => a.action),
    };
  }
  if (kind === "pm_stage") {
    return {
      stage: one(sx.stage, ["stage", "trade", "inspected_by"], "stage"),
      checks: rows(sx.checks, 30, ["scope_item", "pass_mark", "found"], "check"),
      finding_refs: findings.map((f, i) => ({ ord: f.ord, where: clean(refs[i]?.where, `finding ${f.ord} where`), close_by: clean(refs[i]?.close_by, `finding ${f.ord} close by`) })),
    };
  }
  return {};
}
