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

export const STAGES_SVC = [
  "Booked & paid",
  "Intake",
  "Scope agreed",
  "Kickoff issued",
  "M1 · working",
  "M1 · evidence",
  "M1 · released",
  "M2 · working",
  "M2 · evidence",
  "M3 · handover",
  "Closed & paid",
  "Review",
] as const;

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
