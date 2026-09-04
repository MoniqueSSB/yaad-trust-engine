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
  pins?: PinRow[];
  parish?: string | null;
};

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
  const { stage, evidence, arrivals, checklist } = input;
  const out: Check[] = [];

  // ── 1. CHECKLIST ─────────────────────────────────────────────────────
  // The spine, and the only check that knows what THIS job actually agreed,
  // because it reads the pack the client and the worker both confirmed.
  //
  // Counts, and lists what the pack asks for. It deliberately does NOT claim
  // to know WHICH item is missing: matching a filed photograph to a checklist
  // line means guessing from a free-text label, which is the same unreliable
  // move the dropped before-and-after check was. Showing the list and the
  // count lets the worker do the matching, which he can do and this cannot.
  const group = Array.isArray(checklist) ? checklist[stage - 1] : null;
  const wanted = (group?.items ?? []).map((i) => String(i?.item ?? "").trim()).filter(Boolean);
  if (wanted.length) {
    const filed = evidence.length;
    out.push({
      name: "Checklist",
      passed: filed >= wanted.length,
      detail: filed >= wanted.length
        ? `Stage ${stage} asks for ${wanted.length} thing${wanted.length === 1 ? "" : "s"} and ${filed} ${filed === 1 ? "is" : "are"} filed.`
        : `Stage ${stage} asks for ${wanted.length} thing${wanted.length === 1 ? "" : "s"} and ${filed} ${filed === 1 ? "is" : "are"} filed. `
          + `The pack asks for: ${wanted.join("; ")}.`,
      severity: "gap",
      audience: "worker",
    });
  } else {
    out.push({
      name: "Checklist",
      passed: true,
      detail: "No approved Kickoff Pack checklist for this stage, so there is nothing to check the filing against.",
      severity: "note",
      audience: "desk",
    });
  }

  // ── 2. ARRIVAL ───────────────────────────────────────────────────────
  const arrived = arrivals.length > 0;
  out.push({
    name: "Arrival",
    passed: arrived,
    detail: arrived
      ? "An arrival is logged against this stage."
      : "No arrival tap on this stage, so the record does not show anybody on site.",
    severity: "gap",
    audience: "worker",
  });

  // ── 3. SEQUENCE ──────────────────────────────────────────────────────
  // Timestamps only, no interpretation. Uses captured_at where the file
  // carried one and falls back to created_at, which is when it was filed.
  const arrivalTimes = arrivals.map((a) => ts(a.arrived_at)).filter((n): n is number => n !== null);
  const evidenceTimes = evidence.map((e) => ts(e.captured_at) ?? ts(e.created_at)).filter((n): n is number => n !== null);
  if (arrivalTimes.length && evidenceTimes.length) {
    const ordered = Math.min(...arrivalTimes) <= Math.min(...evidenceTimes);
    out.push({
      name: "Sequence",
      passed: ordered,
      detail: ordered
        ? "The arrival comes before the evidence, which is the order it should be in."
        : "Evidence on this stage is timestamped before the arrival tap. That ordering does not hold.",
      severity: "gap",
      audience: "worker",
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
  const arrivalDay = arrivals.map((a) => a.arrived_on).find(Boolean);
  const lastFiled = evidenceTimes.length ? Math.max(...evidenceTimes) : null;
  if (arrivalDay && lastFiled !== null) {
    const dayMs = 86_400_000;
    const days = Math.floor((lastFiled - Date.parse(String(arrivalDay))) / dayMs);
    out.push({
      name: "Same day",
      passed: days <= 0,
      detail: days <= 0
        ? "Filed the same day as the arrival."
        : `Filed ${days} day${days === 1 ? "" : "s"} after the arrival tap.`,
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
  const pins = input.pins ?? [];
  out.push({
    name: "Location pin",
    passed: pins.length > 0,
    detail: pins.length > 0
      ? `A location was shared with this stage${pins[0]?.address ? ` (${pins[0].address})` : ""}, which strengthens the pack.`
      : "No location shared on this stage. Sending your location on WhatsApp puts on record that you were there, which makes the pack harder to argue with. Entirely up to you and nothing waits on it.",
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
      detail: `A shared location on this stage sits over 30km from ${input.parish || "the job parish"}. `
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
      detail: `The arrival tap was over 30km from ${input.parish || "the job parish"}. `
        + "A materials run, a parish border or a bad GPS fix all raise this the same way a wrong site would, "
        + "so it is worth a glance and nothing more on its own.",
      severity: "note",
      audience: "desk",
    });
  } else if (noFix) {
    out.push({
      name: "Site",
      passed: true,
      detail: "No location on the arrival tap, so the site was not checked. Declining the prompt never blocks a check-in.",
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
