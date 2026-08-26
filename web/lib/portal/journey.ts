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
const JOB_STATUS_STAGE: Record<string, number> = {
  awaiting_client_setup: 0,
  draft: 0,
  open: 0,
  quoted: 2,
  scope_agreed: 3,
  confirmed: 4,
  kickoff: 5,
  in_progress: 6,
  evidence: 7,
  released: 8,
  complete: 11,
  reviewed: 12,
};

export function jobStage(status: string | null): number {
  return JOB_STATUS_STAGE[status ?? ""] ?? 0;
}

/** services.stage is already an index in the live table. */
export function svcStage(stage: number | null): number {
  return Math.max(0, Math.min(stage ?? 0, STAGES_SVC.length - 1));
}
