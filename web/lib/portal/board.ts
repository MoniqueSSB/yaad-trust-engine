/**
 * The portal stage board: which column a job sits in, and how far along the
 * job ladder it is. Client portal from 17 Sep 2026, worker portal the same
 * day. The ladder is the same statuses for both; the columns differ, because
 * "waiting on the client's payment" is still getting started for a client
 * and already won for the worker.
 *
 * Founder, 17 Sep 2026, from the Portal Overview design: a client's jobs laid
 * out in three columns by stage rather than as one long list. Kept apart from
 * the component so the grouping can be tested without rendering anything,
 * the same way lib/portal/properties.ts is.
 *
 * Two choices here are deliberate.
 *
 * ONE: a status nobody has mapped still shows. It goes in the middle column,
 * because every status the jobs table knows that is not "complete" still has
 * something outstanding about it (disputed and cancelled included), and a job
 * that silently falls off the board is worse than one in a slightly odd place.
 *
 * TWO: the step count comes from the status alone. Nothing here estimates a
 * percentage of the work done. "Step 6 of 8" says where the job is on the
 * ladder every job climbs, which is a fact; "70% complete" would be a guess.
 */

export type BoardColumnKey = "quotes" | "under_way" | "closed";
export type BoardAudience = "client" | "worker";

export const CLIENT_BOARD_COLUMNS: { key: BoardColumnKey; title: string }[] = [
  { key: "quotes", title: "Getting quotes" },
  { key: "under_way", title: "Booked and under way" },
  { key: "closed", title: "Closed" },
];

export const WORKER_BOARD_COLUMNS: { key: BoardColumnKey; title: string }[] = [
  { key: "quotes", title: "Quoting" },
  { key: "under_way", title: "Won and working" },
  { key: "closed", title: "Paid and closed" },
];

const WORKER_COLUMN_OF: Record<string, BoardColumnKey> = {
  awaiting_client_setup: "quotes",
  draft: "quotes",
  open: "quotes",
  open_for_quotes: "quotes",
  quoted: "quotes",
  awaiting_payment: "under_way",
  confirmed: "under_way",
  in_progress: "under_way",
  evidence: "under_way",
  complete: "closed",
};

const CLIENT_COLUMN_OF: Record<string, BoardColumnKey> = {
  awaiting_client_setup: "quotes",
  draft: "quotes",
  open: "quotes",
  open_for_quotes: "quotes",
  quoted: "quotes",
  awaiting_payment: "quotes",
  confirmed: "under_way",
  in_progress: "under_way",
  evidence: "under_way",
  complete: "closed",
};

/** The ladder in the order a job climbs it. Two statuses on one rung share a
 *  step because they mean the same thing to whoever is reading. */
const STEP_OF: Record<string, number> = {
  awaiting_client_setup: 1,
  draft: 1,
  open: 2,
  open_for_quotes: 2,
  quoted: 3,
  awaiting_payment: 4,
  confirmed: 5,
  in_progress: 6,
  evidence: 7,
  complete: 8,
};

export const JOB_STEPS = 8;

export function columnOf(status: string, audience: BoardAudience = "client"): BoardColumnKey {
  const map = audience === "worker" ? WORKER_COLUMN_OF : CLIENT_COLUMN_OF;
  return map[status] ?? "under_way";
}

export function columnsFor(audience: BoardAudience) {
  return audience === "worker" ? WORKER_BOARD_COLUMNS : CLIENT_BOARD_COLUMNS;
}

/** The rung a status sits on, or null for a status that is not on the ladder. */
export function stepOf(status: string): number | null {
  return STEP_OF[status] ?? null;
}

/** Jobs split into the three columns, keeping the order they came in. */
export function groupForBoard<T extends { status: string }>(
  jobs: T[],
  audience: BoardAudience = "client",
): Record<BoardColumnKey, T[]> {
  const out: Record<BoardColumnKey, T[]> = { quotes: [], under_way: [], closed: [] };
  for (const j of jobs) out[columnOf(j.status, audience)].push(j);
  return out;
}

/**
 * The one job the right-hand panel's ring is about, for either portal.
 *
 * The design showed a "Selected" job with no rule for choosing it. The rule
 * here: the first job waiting on the client, because that is the one they
 * came to act on; failing that, the first job booked and under way; failing
 * that, the first one getting quotes. Closed jobs are never chosen: a ring at
 * step 8 of 8 answers nothing. "First" is the order the page passes in, which
 * is most recently moved first.
 *
 * isWaiting is passed in rather than read from a label map so this stays a
 * pure function with nothing to render.
 */
export function pickFocusJob<T extends { status: string }>(
  jobs: T[],
  isWaiting: (j: T) => boolean,
  audience: BoardAudience = "client",
): T | null {
  const live = jobs.filter((j) => columnOf(j.status, audience) !== "closed");
  return (
    live.find(isWaiting) ??
    live.find((j) => columnOf(j.status, audience) === "under_way") ??
    live[0] ??
    null
  );
}
