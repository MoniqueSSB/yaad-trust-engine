/**
 * The journeys, verbatim from PORTAL-SPEC.md v1.0.
 * 13 stages for a job, 12 for a service. Stage count per job is NEVER fixed
 * at two; the ledger reads kickoff_packs.stages. These rails are the
 * navigation skeleton every portal page shares.
 */

export const STAGES = [
  "Job live",
  "Quote built",
  "Quotes in",
  "Scope agreed",
  "Chosen & funded",
  "Kickoff issued",
  "Stage 1 · on site",
  "Stage 1 · evidence",
  "Stage 1 · released",
  "Stage 2 · on site",
  "Stage 2 · evidence",
  "Closed & paid",
  "Reviews",
] as const;

/**
 * A professional service, six stages. Founder decision, 3 Sep 2026.
 *
 * There were two lists and one column. PORTAL-SPEC v1.0 specified the twelve
 * below, which lived here; the service page carried its own six-stage TRACK
 * with a sentence against each. Both were indexed by the SAME services.stage
 * integer, and both were rendered ON THE SAME SCREEN: the heading and the step
 * list read from the six, the progress rail and the "nearly done" check read
 * from the twelve. A booking at stage 5 therefore announced "Delivered" at the
 * top of the page and "M1 · evidence" on the rail beneath it. Two contradictory
 * statements about how far along somebody's money was, on one page.
 *
 * The six won because it is the one a client has actually been reading, it is
 * the one whose wording was written for them rather than for the spec, and
 * every stage carries a sentence saying what it means. The twelve was a
 * milestone breakdown that describes a job, not a piece of desk work.
 *
 * Safe to change on 3 Sep because `select stage, count(*) from services` came
 * back empty: there is no live booking whose progress could be misreported by
 * the renumbering. It would not have been safe a month from now.
 *
 * The detail sentences live here with the names, rather than beside them in a
 * page, because splitting them is how the two lists came apart in the first
 * place.
 */
export const SERVICE_TRACK = [
  { name: "Booked and paid", detail: "Portal link and code sent the moment payment cleared" },
  { name: "Intake", detail: "What is needed from you before the clock starts" },
  { name: "Documents received", detail: "The desk work starts here, not at payment" },
  { name: "Desk work", detail: "Checked against real material costs and day rates" },
  { name: "Draft with you", detail: "You read it first. A wrong fact gets fixed before it is final" },
  { name: "Delivered", detail: "PDF, signed, yours to keep" },
] as const;

/** The rail's names only. Derived, never restated, so it cannot drift again. */
export const STAGES_SVC = SERVICE_TRACK.map((s) => s.name);

export type Side = "client" | "worker" | "service";

/**
 * jobs.status to rail position. The statuses come from the live table, not
 * from imagination; anything unknown lands at the start rather than lying
 * about progress.
 */
// The real vocabulary, read from the jobs_status_check constraint on 26
// Aug rather than assumed: draft, awaiting_client_setup, open_for_quotes,
// quoted, in_progress, complete, disputed, cancelled. The first mapping
// here guessed at statuses that do not exist.
const JOB_STATUS_STAGE: Record<string, number> = {
  draft: 0,
  awaiting_client_setup: 0,
  open_for_quotes: 0,
  quoted: 2,
  // "Chosen & funded" is the rail's own name for this exact wait: a worker
  // is chosen, the agency fee invoice is the one thing left before the job
  // goes live. Added 2 Sep 2026 alongside the payment gate itself.
  awaiting_payment: 4,
  in_progress: 6,
  disputed: 7,
  complete: 11,
  cancelled: 0,
};

export function jobStage(status: string | null): number {
  return JOB_STATUS_STAGE[status ?? ""] ?? 0;
}

/** services.stage is already an index in the live table. */
export function svcStage(stage: number | null): number {
  return Math.max(0, Math.min(stage ?? 0, STAGES_SVC.length - 1));
}

/**
 * One payment stage from an approved Kickoff Pack's payment_schedule, read
 * off production shape (docs.payment_schedule.stages), not assumed.
 */
export type PackStage = {
  stage: string;
  proportion_percent?: number;
  release_condition?: string;
  evidence_required?: string[];
};

export function packPaymentStages(docs: unknown): PackStage[] {
  const raw = (docs as { payment_schedule?: { stages?: unknown } } | null)
    ?.payment_schedule?.stages;
  return Array.isArray(raw)
    ? (raw as PackStage[]).filter((s) => s && typeof s.stage === "string")
    : [];
}

/**
 * The same list, off a Quote Pack instead.
 *
 * A job reaches its payment stages down one of two routes, not one
 * (20260902d): the original Kickoff Pack, or the lighter Quote Pack the
 * worker and client agree between them. The founder's own words for why
 * the second exists: "they dont have to use it, the kick off pack, if they
 * are happy with the agreement they already have."
 *
 * The two store the same idea in different places. A Kickoff Pack nests
 * its stages at docs.payment_schedule.stages; a Quote Pack keeps a plain
 * array at docs.payment_stages and calls the release wording evidence_note
 * rather than release_condition. sync_job_status() already had to learn
 * both shapes (20260902g) after a job's stage count was read from the
 * wrong one and three parts of the product disagreed about how many stages
 * it had. This is that same lookup, for the screens.
 */
export function quotePackPaymentStages(docs: unknown): PackStage[] {
  const raw = (docs as { payment_stages?: unknown } | null)?.payment_stages;
  if (!Array.isArray(raw)) return [];
  return (raw as { stage?: unknown; proportion_percent?: number; evidence_note?: string }[])
    .filter((s) => s && typeof s.stage === "string")
    .map((s) => ({
      stage: s.stage as string,
      proportion_percent: s.proportion_percent,
      release_condition: s.evidence_note,
    }));
}

const PRE_WORK_STAGES = STAGES.slice(0, 6); // "Job live" .. "Kickoff issued"
const POST_WORK_TAIL = ["Closed & paid", "Reviews"];
const NOT_YET_STARTED = new Set([
  "draft", "awaiting_client_setup", "open_for_quotes", "quoted", "awaiting_payment",
]);

/**
 * The rail a client actually signs stages off against. Founder's
 * instruction, 31 Aug 2026: once a worker is chosen the generic "Stage 1 ·
 * on site / evidence / released" placeholders give way to the approved
 * pack's own stage names, the same names the money is actually released
 * against, so a client approving "Stage 2" is approving the thing the pack
 * called Stage 2, not a label invented separately from it.
 *
 * A job with no pack, or one still in draft, falls through to the original
 * fixed rail exactly as before. Nothing about this changes for a job that
 * never gets a Kickoff Pack.
 */
export function jobStages(
  status: string | null,
  stage: number | null,
  pack: PackStage[],
): { stages: string[]; current: number } {
  const started = (stage ?? 0) > 0 && !NOT_YET_STARTED.has(status ?? "");
  if (!started || pack.length === 0) {
    return { stages: [...STAGES], current: jobStage(status) };
  }
  const names = [...PRE_WORK_STAGES, ...pack.map((p) => p.stage), ...POST_WORK_TAIL];
  const current = status === "complete"
    ? names.length - 2
    : PRE_WORK_STAGES.length + Math.max(0, (stage ?? 1) - 1);
  return { stages: names, current: Math.min(current, names.length - 1) };
}
