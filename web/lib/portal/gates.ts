import legal from "@/lib/legal-copy.json";

/**
 * What a job still needs before a tradesperson can see it.
 *
 * Lifted out of GoLive.tsx so the portal door and the job room ask the same
 * question and get the same answer. Two screens now list these, and a
 * checklist that disagrees with itself between pages is worse than no
 * checklist: the reader cannot tell which one is lying.
 *
 * Every gate is enforced in Postgres and was, until the checklist existed,
 * enforced silently. The order is the order the database applies them in, so
 * a client working top to bottom never clears a gate that a later one undoes:
 *
 *   1. client_go_live() needs auth.users.email_confirmed_at
 *   2. enforce_signed_before_open needs a doc_signatures row at the exact
 *      version in app_settings, and a client_profiles row
 *   3. enforce_store_before_open needs materials_store_nominated()
 *   4. open_jobs needs open = true, no worker, stage 0
 *
 * The split between account and job matters to the reader, not to Postgres.
 * The first two are done once and cover every job somebody has; the third is
 * per job and has to be answered again each time. Saying so is the difference
 * between "three things" and "three things, then one more per job", which is
 * the question anybody with two jobs is actually asking.
 */

export type Gate = {
  title: string;
  /** what this gate is for, in the client's terms, not the schema's */
  why: string;
  done: boolean;
  /** where to go and clear it; absent when the gate clears itself */
  href?: string;
  cta?: string;
  /** account gates are cleared once for every job; job gates are per job */
  scope: "account" | "job";
};

export type GateJob = {
  id: string;
  open?: boolean | null;
  stage?: number | null;
  worker_email?: string | null;
  status?: string | null;
  materials_store?: string | null;
  materials_store_type?: string | null;
};

export const CG_VERSION = legal.CG_VERSION;

export function storeNamed(job: GateJob): boolean {
  return (
    !!job.materials_store_type &&
    (job.materials_store_type === "none_available" ||
      (job.materials_store ?? "").trim() !== "")
  );
}

/**
 * open_jobs is open = true AND no worker AND stage 0. Past that point a job is
 * not "not live", it has moved on, and the checklist retires rather than
 * hanging around claiming there is something to do.
 */
export function onBoard(job: GateJob): boolean {
  return job.open === true && !job.worker_email && (job.stage ?? 0) === 0;
}

export function movedOn(job: GateJob): boolean {
  return (
    !!job.worker_email || (job.stage ?? 0) > 0 || job.status === "complete"
  );
}

/** True while the checklist still has something to say about this job. */
export function stillWaiting(job: GateJob): boolean {
  return !onBoard(job) && !movedOn(job);
}

export function jobGates({
  job,
  jobBase,
  emailConfirmed,
  signed,
}: {
  job: GateJob;
  /** e.g. /portal/jobs/JOB-WA-1 , used for the #materials anchor */
  jobBase: string;
  emailConfirmed: boolean;
  signed: boolean;
}): Gate[] {
  return [
    {
      scope: "account",
      title: "Confirm your email address",
      why: "Open the link Yaadly emailed you when you signed up. A job can be posted in anybody's name; a confirmed mailbox is what proves this one is yours.",
      done: emailConfirmed,
    },
    {
      scope: "account",
      title: `Sign the Client Guidelines, version ${CG_VERSION}`,
      why: "What Yaadly does, what it charges, and what happens if the work is wrong. Nothing reaches a tradesperson until you have agreed to them.",
      done: signed,
      href: "/portal/guidelines",
      cta: "Read and sign",
    },
    {
      scope: "job",
      title: "Say where materials are kept",
      why: "A worker cannot price this honestly without it. With nowhere securable he buys in drops and drives the surplus off site each night, and those trips belong in his quote.",
      done: storeNamed(job),
      href: jobBase + "#materials",
      cta: "Answer it",
    },
  ];
}
