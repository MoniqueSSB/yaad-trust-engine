/**
 * The independent check a client can add to a job at sign-off.
 *
 * PORTALS-BUILD-SPEC section 5.11 draws a picker: no reviewer (included), or
 * somebody independent attends the finished stage. This module decides what
 * the picker is allowed to show, and it mirrors the two Postgres functions
 * that actually hold the line, choose_job_check() and job_check_locked()
 * (20260909180000). If the screen and the database ever disagree about
 * whether the choice is still open, the database is right and this file is
 * the bug.
 *
 * The rule, in words. The choice is offered once a worker is on the job (the
 * scope is agreed) and stays open until somebody files evidence on the FINAL
 * stage. After that it locks: the spec's standing warning is "Visits not
 * agreed at the start are chargeable", so a late request goes to a person
 * over WhatsApp rather than quietly onto the bill.
 *
 * What this is not. A check is a record, not a ruling. Nothing here is read
 * by the Approve button, and choosing a check changes who attends, never who
 * approves.
 */

export type CheckLevel = "visual" | "technical";

export const CHECK_CATALOGUE_ID: Record<CheckLevel, string> = {
  visual: "job-visual-check",
  technical: "job-technical-check",
};

export const CHECK_LABEL: Record<CheckLevel, string> = {
  visual: "Visual Check",
  technical: "Technical Sign-off",
};

/** What the picker should show for this job, for this reader. */
export type CheckState =
  /** No worker yet, so no scope to check against. The panel stays away. */
  | "not_yet"
  /** Nothing chosen and the choice is still open. */
  | "open"
  /** A check is chosen. It may or may not still be changeable, see canChange. */
  | "chosen"
  /** Nothing chosen and final evidence is already in. Too late for the portal. */
  | "locked";

export type CheckInput = {
  workerEmail: string | null | undefined;
  status: string | null | undefined;
  checkLevel: string | null | undefined;
  /** How many payment stages the job has. Never below 1. */
  finalStageCount: number;
  /** The stage number on every evidence item filed so far (null reads as 1). */
  evidenceStages: (number | null | undefined)[];
};

/** Same reading as job_final_stage_count(): a pack's stage count, else one. */
export function finalStageCountFrom(packStageCount: number): number {
  return Math.max(1, Math.floor(packStageCount || 0));
}

/** Same test as job_check_locked(): evidence on the final stage, or the job
 *  is finished or cancelled. */
export function isCheckLocked(input: Pick<CheckInput, "status" | "finalStageCount" | "evidenceStages">): boolean {
  if (input.status === "complete" || input.status === "cancelled") return true;
  const last = finalStageCountFrom(input.finalStageCount);
  return input.evidenceStages.some((s) => (s ?? 1) >= last);
}

export function isCheckLevel(x: unknown): x is CheckLevel {
  return x === "visual" || x === "technical";
}

export function jobCheckState(input: CheckInput): { state: CheckState; canChange: boolean } {
  const level = isCheckLevel(input.checkLevel) ? input.checkLevel : null;
  if (!input.workerEmail) {
    /* A check set by the desk on a job that somehow lost its worker is still
       a fact worth showing; an empty picker before scope agreed is not. */
    return { state: level ? "chosen" : "not_yet", canChange: false };
  }
  const locked = isCheckLocked(input);
  if (level) return { state: "chosen", canChange: !locked };
  return { state: locked ? "locked" : "open", canChange: !locked };
}
