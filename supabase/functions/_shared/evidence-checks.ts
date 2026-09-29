// The evidence completeness checks, on the live side.
//
// ── Why this file exists ──
//
// `yaad/agents/verification.py` has checked an evidence chain since the engine
// was written, and CLAUDE.md §10 calls those gates the moat: they come out of
// seven years of construction project management and they are the one part an
// agent cannot supply. The agent audit of 4 September 2026 found they were
// imported by exactly two files, `run_demo.py` and `tests/`, and ran on no
// live job at all. What ran instead was a vision model describing photographs,
// which by construction cannot notice what is ABSENT. This is the port.
//
// ── The hard rule, and it is the whole design ──
//
// THIS ASSEMBLES A PACK. IT NEVER DECIDES ANYTHING.
//
// Nothing here blocks a stage, writes `evidence.ok`, touches `stage_approvals`
// or moves a job. `approve_stage()` already requires a named human and stays
// the only door. A completeness check that could block is a machine standing
// between a worker and getting paid, which is the exact shape CLAUDE.md §3
// exists to refuse. Every function below returns text for a person to read.
//
// ── What is checked, and what deliberately is not ──
//
// Five checks, on hard columns. Two Python checks could NOT be ported and are
// not faked: evidence rows carry no lat/lon (only the arrival tap does), so
// "is this photograph geotagged" is unanswerable, and there is no duration
// column, so "is the clip long enough to be usable" is unanswerable. Both need
// a schema change, which is a separate decision and not one to smuggle in.
//
// One check was DROPPED on the founder's own reading, 4 September 2026. A
// before-and-after check that reads `evidence.label` is reading text the
// worker typed, and the word "after" in a caption is not proof of an after
// shot; it misfires in both directions. Where a job genuinely needs a before
// and an after, the approved Kickoff Pack says so and CHECKLIST covers it.
// Her point, and it is the right one: a check nobody can trust is worse than
// no check, because it spends attention that the real findings need.
//
// SITE is desk-only for the same reason. `far_from_site` is 30km from a parish
// centroid, and the migration that added it says in as many words that a
// materials run, a parish border and a bad GPS fix all raise it exactly as
// loudly as a wrong site would. Putting that in front of a worker reads as an
// accusation the data cannot support. It reports the flag to the desk, with
// what else produces it said plainly, and never travels to the worker.

// ── Arrival is read by the DAY, not by the stage (founder, 29 Sep 2026) ──
//
// Until 29 September 2026 an arrival only counted for the stage it was logged
// against, and evidence timestamped before it was raised as a gap. Both were
// wrong on a real site. A worker who checks in on stage 2 and carries on into
// stage 3 the same visit was told nobody had been on site, and a worker with
// no signal until the end of the day was told his order "does not hold".
//
// Her rule, and it is a decision about what counts as verified, so it is hers:
// the check-in is asked once a day on site, it covers every stage worked that
// day, and it may be sent before or after the work. The photographs and the
// clip are what show the work, and a person reviews those. The order is kept
// as a quiet note for the desk and is never shown to a worker.
//
// The 30km distance flag is unchanged and matters more now: with no order
// required, distance is the one thing that tells a pin sent from site apart
// from a pin sent from home. It stays desk-only, a glance and never a finding.
//
// "Day" is the Jamaica local day, the same one arrival_log.arrived_on uses.

export type EvidenceRow = {
  label?: string | null;
  mime?: string | null;
  captured_at?: string | null;
  created_at?: string | null;
  kind?: string | null;
  item_code?: string | null;
};

export type ArrivalRow = {
  arrived_at?: string | null;
  arrived_on?: string | null;
  lat?: number | null;
  far_from_site?: boolean | null;
};

/** One entry of the approved pack's evidence_checklist, for one stage. */
export type ChecklistGroup = { stage?: string; items?: { item?: string; type?: string; why?: string }[] };

export type Check = {
  /** Short name, for the desk pack and for telemetry. */
  name: string;
  passed: boolean;
  /** The sentence a person reads. Written for a phone screen. */
  detail: string;
  /** "gap" is something missing. "note" is context, never a criticism. */
  severity: "gap" | "note";
  /** Who this is for. SITE is desk-only, see the header. */
  audience: "worker" | "desk";
};

/** A deliberate WhatsApp location share by the worker, from work_log_pins. */
export type PinRow = { shared_at?: string | null; far_from_site?: boolean | null; address?: string | null };

export type ChecksInput = {
  stage: number;
  evidence: EvidenceRow[];
  arrivals: ArrivalRow[];
  /** docs.evidence_checklist from the job's approved Kickoff Pack, if it has one. */
  checklist: ChecklistGroup[] | null;
  /** docs.payment_stages from the job's approved Quote Pack. Used only when
   *  there is no Kickoff Pack, which since 4 Sep 2026 is the ordinary case. */
  quoteStages?: { stage?: string; evidence_note?: string }[] | null;
  pins?: PinRow[];
  parish?: string | null;
  /** False where somebody is at home at the property day to day, and no
   *  check-in is asked for (arrival-rule.ts, 29 Sep 2026). Left out means
   *  expected, which is what every caller before that date meant. */
  arrivalExpected?: boolean;
};

/** Jamaica keeps UTC-5 all year, no daylight saving. */
const JAMAICA_OFFSET_MS = 5 * 3_600_000;

/** The Jamaica local date of a timestamp, as YYYY-MM-DD, or null. */
export function jamaicaDay(v: unknown): string | null {
  if (!v) return null;
  const n = Date.parse(String(v));
  if (!Number.isFinite(n)) return null;
  return new Date(n - JAMAICA_OFFSET_MS).toISOString().slice(0, 10);
}

const ts = (v: unknown): number | null => {
  if (!v) return null;
  const n = Date.parse(String(v));
  return Number.isFinite(n) ? n : null;
};

/**
 * The checks. Deterministic, no model, no network. Returns everything it
 * looked at, passes included, because a pack that only lists problems cannot
 * be told apart from a pack that never ran.
 */
export function runEvidenceChecks(input: ChecksInput): Check[] {
  const { stage, evidence, checklist } = input;
  const out: Check[] = [];

  // The days this stage's evidence belongs to: the day each item was taken
  // and the day it was filed. Arrivals and pins are given for the WHOLE JOB
  // and narrowed to these days here, so a check-in logged against another
  // stage on the same day still counts. With no usable timestamp on any
  // evidence there is no day to narrow to, and nothing is filtered out.
  const workDays = new Set<string>();
  for (const e of evidence) {
    for (const d of [jamaicaDay(e.captured_at), jamaicaDay(e.created_at)]) if (d) workDays.add(d);
  }
  const onWorkDay = (day: string | null) => workDays.size === 0 || (day !== null && workDays.has(day));
  const allArrivals = input.arrivals ?? [];
  const arrivals = allArrivals.filter((a) => onWorkDay(String(a.arrived_on ?? "") || jamaicaDay(a.arrived_at)));

  // ── 1. CHECKLIST ─────────────────────────────────────────────────────
  // The spine, and the only check that knows what THIS job actually agreed,
  // because it reads the pack the client and the worker both confirmed.
  //
  // Counts, and lists what the pack asks for. It deliberately does NOT claim
  // to know WHICH item is missing: matching a filed photograph to a checklist
  // line means guessing from a free-text label, which is the same unreliable
  // move the dropped before-and-after check was. Showing the list and the
  // count lets the worker do the matching, which he can do and this cannot.
  // Falls back to the QUOTE pack's own stage evidence note when there is no
  // Kickoff Pack. Added 4 September 2026, the same day the Kickoff Pack came
  // out of the default booking flow on the founder's instruction: most jobs
  // will not have one from now on, and without this fallback the spine of
  // these checks would have gone quiet on almost every job the day after it
  // was built. The quote pack carries one evidence_note per payment stage
  // rather than a list of items, so it is a thinner source, and a thinner
  // source is worth far more here than none.
  const group = Array.isArray(checklist) ? checklist[stage - 1] : null;
  let wanted = (group?.items ?? []).map((i) => String(i?.item ?? "").trim()).filter(Boolean);
  let wantedFrom = "the Kickoff Pack";
  if (!wanted.length && Array.isArray(input.quoteStages)) {
    const qs = input.quoteStages[stage - 1];
    const note = String(qs?.evidence_note ?? "").trim();
    if (note) { wanted = [note]; wantedFrom = "the quote"; }
  }
  if (wanted.length) {
    const filed = evidence.length;
    out.push({
      name: "Checklist",
      passed: filed >= wanted.length,
      detail: filed >= wanted.length
        ? `Stage ${stage} asks for ${wanted.length} thing${wanted.length === 1 ? "" : "s"} and ${filed} ${filed === 1 ? "is" : "are"} filed.`
        : `Stage ${stage} asks for ${wanted.length} thing${wanted.length === 1 ? "" : "s"} and ${filed} ${filed === 1 ? "is" : "are"} filed. `
          + `What ${wantedFrom} asks for: ${wanted.join("; ")}.`,
      severity: "gap",
      audience: "worker",
    });
  } else {
    out.push({
      name: "Checklist",
      passed: true,
      detail: "No Kickoff Pack checklist and no quote stage note for this stage, so there is nothing to check the filing against.",
      severity: "note",
      audience: "desk",
    });
  }

  // ── 2. ARRIVAL ───────────────────────────────────────────────────────
  const arrived = arrivals.length > 0;
  if (input.arrivalExpected === false && !arrived) {
    // Somebody is at home at the property, so the worker was never asked to
    // check in and a missing arrival is not something they left undone. It
    // is still written down, as a note for the desk, because a pack that
    // drops a check without saying so cannot be told from one that never ran.
    out.push({
      name: "Arrival",
      passed: true,
      detail: "No check-in asked for on this job: somebody is at home at the property day to day.",
      severity: "note",
      audience: "desk",
    });
  } else {
    out.push({
      name: "Arrival",
      passed: arrived,
      detail: arrived
        ? "A check-in is logged for the day this work was filed."
        : "No check-in for the day this was filed, so the record does not show anybody on site. One check-in a day covers every stage, and it can be sent before or after the work.",
      severity: "gap",
      audience: "worker",
    });
  }

  // ── 3. SEQUENCE ──────────────────────────────────────────────────────
  // Timestamps only, no interpretation. Uses captured_at where the file
  // carried one and falls back to created_at, which is when it was filed.
  //
  // A NOTE FOR THE DESK, never a gap and never shown to a worker, since 29
  // September 2026. A check-in may come before or after the work. The order
  // is still worth a glance to the person reading the pack, and that is all.
  const arrivalTimes = arrivals.map((a) => ts(a.arrived_at)).filter((n): n is number => n !== null);
  const evidenceTimes = evidence.map((e) => ts(e.captured_at) ?? ts(e.created_at)).filter((n): n is number => n !== null);
  if (arrivalTimes.length && evidenceTimes.length) {
    const ordered = Math.min(...arrivalTimes) <= Math.min(...evidenceTimes);
    out.push({
      name: "Sequence",
      passed: ordered,
      detail: ordered
        ? "The check-in comes before the evidence."
        : "The check-in was sent after the first evidence on this stage. That is allowed, a check-in may come before or after the work.",
      severity: "note",
      audience: "desk",
    });
  } else {
    out.push({
      name: "Sequence",
      passed: true,
      detail: "Not enough timestamps to check the order of things.",
      severity: "note",
      audience: "desk",
    });
  }

  // ── 4. CLIP ──────────────────────────────────────────────────────────
  // Reads mime, which comes off the uploaded file, NOT off anything typed.
  // That is the whole reason this check survived the 4 Sep cull and the
  // before-and-after one did not.
  const clips = evidence.filter((e) => String(e.mime ?? "").startsWith("video/"));
  out.push({
    name: "Clip",
    passed: clips.length > 0,
    detail: clips.length > 0
      ? `${clips.length} clip${clips.length === 1 ? "" : "s"} on this stage.`
      : "Photographs only on this stage, no clip. A short walk-through shows things a still cannot.",
    severity: "gap",
    audience: "worker",
  });

  // ── 5. SAME DAY ──────────────────────────────────────────────────────
  // A note, never a gap. Filing late is worth knowing and is not misconduct:
  // signal is bad on plenty of Jamaican sites and the work still happened.
  //
  // Reads EVERY check-in on the job, not only the ones on a work day, because
  // its whole purpose is to say how far the nearest earlier one is when there
  // is none on the day itself.
  const lastFiled = evidenceTimes.length ? Math.max(...evidenceTimes) : null;
  const lastFiledDay = lastFiled !== null ? jamaicaDay(new Date(lastFiled).toISOString()) : null;
  const arrivalDay = allArrivals
    .map((a) => String(a.arrived_on ?? "") || jamaicaDay(a.arrived_at) || "")
    .filter((d) => d && (!lastFiledDay || d <= lastFiledDay))
    .sort().pop();
  if (arrivalDay && lastFiledDay) {
    const dayMs = 86_400_000;
    const days = Math.round((Date.parse(lastFiledDay) - Date.parse(arrivalDay)) / dayMs);
    out.push({
      name: "Same day",
      passed: days <= 0,
      detail: days <= 0
        ? "Filed the same day as a check-in."
        : `Filed ${days} day${days === 1 ? "" : "s"} after the last check-in on this job.`,
      severity: "note",
      audience: "desk",
    });
  }

  // ── 6. PIN ───────────────────────────────────────────────────────────
  // The Python engine's "live pin on work log", finally answerable. It could
  // not be ported on 4 Sep because evidence rows carry no lat/lon, and reading
  // a photograph's EXIF was never an option: WhatsApp discards it on send and
  // this project's portal path strips it deliberately.
  //
  // A WhatsApp location share replaces it and is stronger. It is an act
  // performed now, where a photograph's metadata can come from a picture taken
  // last week at a different house.
  //
  // It is a NOTE and never a gap, and that is the whole point. `arrival_log`'s
  // own migration says GPS "strengthens the record, it never gates it"; the
  // same holds here without exception. A worker who shares nothing is not
  // penalised, delayed or blocked, and the wording below says what a pin is
  // FOR rather than telling anyone off for the absence of one.
  // Read by the day too, since 29 September 2026: one location shared that
  // day covers every stage worked that day, so the offer is not repeated.
  const pins = (input.pins ?? []).filter((p) => onWorkDay(jamaicaDay(p.shared_at)));
  out.push({
    name: "Location pin",
    passed: pins.length > 0,
    detail: pins.length > 0
      ? `A location was shared that day${pins[0]?.address ? ` (${pins[0].address})` : ""}, which strengthens the pack.`
      : "No location shared that day. Sending your location on WhatsApp puts on record that you were there, which makes the pack harder to argue with. Entirely up to you and nothing waits on it.",
    severity: "note",
    audience: "worker",
  });

  // A pin far from the parish is the desk's business, on exactly the same
  // terms as the arrival tap's own flag: a glance, never a finding.
  const farPin = pins.find((p) => p.far_from_site === true);
  if (farPin) {
    out.push({
      name: "Pin distance",
      passed: false,
      detail: `A location shared that day sits over 30km from ${input.parish || "the job parish"}. `
        + "A materials run, a parish border or a bad fix all look identical to this, so it is worth a glance and nothing more on its own.",
      severity: "note",
      audience: "desk",
    });
  }

  // ── 7. SITE ──────────────────────────────────────────────────────────
  // DESK ONLY. See the header. Reports what raised it and what else raises
  // the same flag, so it reads as the coarse sanity signal it actually is
  // rather than as an accusation the data cannot support.
  const far = arrivals.find((a) => a.far_from_site === true);
  const noFix = arrivals.length > 0 && arrivals.every((a) => a.lat == null);
  if (far) {
    out.push({
      name: "Site",
      passed: false,
      detail: `The check-in was over 30km from ${input.parish || "the job parish"}. `
        + "A materials run, a parish border or a bad GPS fix all raise this the same way a wrong site would, "
        + "so it is worth a glance and nothing more on its own.",
      severity: "note",
      audience: "desk",
    });
  } else if (noFix) {
    out.push({
      name: "Site",
      passed: true,
      detail: "No location on the check-in, so the site was not checked. Declining the prompt never blocks a check-in.",
      severity: "note",
      audience: "desk",
    });
  }

  return out;
}

/** The gaps a worker should see, and nothing else. Desk-only checks never
 *  appear here, passes never appear here, and notes never appear here: a
 *  worker mid-job needs the short list of what is missing, not a report. */
export function workerGaps(checks: Check[]): string[] {
  return checks
    .filter((c) => c.audience === "worker" && !c.passed && c.severity === "gap")
    .map((c) => c.detail);
}

/** Worker-facing NOTES, which are offers rather than demands and are kept
 *  apart from gaps for exactly that reason. The location pin lives here: it
 *  strengthens a pack and is never required, so putting it in the same list
 *  as a missing clip would misdescribe it and would quietly turn a voluntary
 *  thing into an obligation. */
export function workerNotes(checks: Check[]): string[] {
  return checks
    .filter((c) => c.audience === "worker" && !c.passed && c.severity === "note")
    .map((c) => c.detail);
}

/** Everything, for a person. Passes included, so a quiet pack is visibly a
 *  pack that ran rather than one that failed silently. */
export function deskPack(checks: Check[]): string {
  if (!checks.length) return "";
  const line = (c: Check) => `${c.passed ? "ok  " : (c.severity === "gap" ? "GAP " : "note")} ${c.name}: ${c.detail}`;
  const gaps = checks.filter((c) => !c.passed && c.severity === "gap").length;
  return [
    `Evidence check, stage pack. ${gaps === 0 ? "Nothing missing." : `${gaps} thing${gaps === 1 ? "" : "s"} missing.`}`,
    ...checks.map(line),
    "This is a pack for you to read. Nothing here approves, blocks or pays anything.",
  ].join("\n");
}

/** Bounded span attributes. Counts only, never the detail text, which can
 *  carry a worker's own words. Same reasoning as guardrails.screenAttrs. */
export function checkAttrs(checks: Check[]): Record<string, string | number> {
  return {
    "yaadly.evidence.checks_run": checks.length,
    "yaadly.evidence.gaps": checks.filter((c) => !c.passed && c.severity === "gap").length,
    "yaadly.evidence.notes": checks.filter((c) => !c.passed && c.severity === "note").length,
    "yaadly.evidence.failed": [...new Set(checks.filter((c) => !c.passed).map((c) => c.name))].sort().join(","),
  };
}
