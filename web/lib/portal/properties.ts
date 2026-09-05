/**
 * Grouping a client's jobs into properties.
 *
 * ── Why this is grouping and not a table ──
 *
 * Yaadly has no properties table, and adding one was not the right first move.
 * A property is currently whatever somebody typed into `jobs.addr`, and on
 * 4 September 2026 only 5 of 40 jobs had one at all; 33 had a parish. So a
 * properties table would have started life 88% empty, and a portfolio built on
 * an empty table is a screen that says "no properties" to somebody who owns
 * four.
 *
 * Grouping what is there does two useful things instead. It works today, on
 * the addresses that exist. And it makes the gap VISIBLE to the person who can
 * close it: a client looking at "Address not given, 3 jobs" is being shown,
 * without being told off, the one thing that would turn this page into a real
 * portfolio. The data improves because the page exists, which is the opposite
 * of a table that stays empty because nobody has a reason to fill it.
 *
 * The monthly PDF comes later and renders from this same grouping. It needs
 * property identity to be trustworthy first, which is exactly what this is for.
 *
 * ── How two jobs end up at the same property ──
 *
 * By normalised address: lowercased, punctuation dropped, runs of whitespace
 * collapsed. "12 Barbican Rd." and "12 Barbican Road" do NOT group, and that
 * is deliberate rather than a limitation worth hiding. Guessing that two
 * addresses are the same place is how one client's job appears under another
 * client's property, and the fix for a near-miss is a person correcting the
 * address, not a fuzzy match nobody can audit.
 */

export type PropertyJob = {
  id: string;
  title: string | null;
  trade: string | null;
  parish: string | null;
  addr: string | null;
  stage: number | null;
  status: string | null;
  open: boolean | null;
  updated_at: string | null;
};

export type Property = {
  /** Stable key for React and for a later PDF section id. */
  key: string;
  /** What to show as the heading. */
  label: string;
  /** True when there is no address and this is a fallback grouping. */
  unidentified: boolean;
  parish: string | null;
  jobs: PropertyJob[];
  openJobs: number;
  /** Most recent activity across the property's jobs, for ordering. */
  lastActivity: string | null;
};

/** Lowercase, strip punctuation, collapse whitespace. Nothing cleverer. */
export function addressKey(addr: string | null | undefined): string {
  return String(addr ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A job counts as open when it is live and not cancelled or closed. */
export function isOpenJob(j: PropertyJob): boolean {
  if (j.status === "cancelled" || j.status === "closed") return false;
  return j.open === true || (j.stage ?? 0) > 0;
}

/**
 * Group jobs into properties, newest activity first.
 *
 * Jobs with no address fall into ONE bucket per parish rather than one bucket
 * overall. A client with a house in Portmore and a shop in St Ann, neither
 * addressed, sees two rows that are at least honestly separate, instead of one
 * row implying they are the same building.
 */
export function groupIntoProperties(jobs: PropertyJob[]): Property[] {
  const byKey = new Map<string, Property>();

  for (const j of jobs) {
    const addr = String(j.addr ?? "").trim();
    const ak = addressKey(addr);
    const parish = String(j.parish ?? "").trim() || null;
    const unidentified = ak === "";
    const key = unidentified ? `parish:${(parish ?? "unknown").toLowerCase()}` : `addr:${ak}`;

    let p = byKey.get(key);
    if (!p) {
      p = {
        key,
        label: unidentified ? (parish ? `Address not given, ${parish}` : "Address not given") : addr,
        unidentified,
        parish,
        jobs: [],
        openJobs: 0,
        lastActivity: null,
      };
      byKey.set(key, p);
    }
    p.jobs.push(j);
    if (isOpenJob(j)) p.openJobs += 1;
    // Keep the parish if the first job into this bucket did not carry one.
    if (!p.parish && parish) p.parish = parish;
    if (j.updated_at && (!p.lastActivity || j.updated_at > p.lastActivity)) {
      p.lastActivity = j.updated_at;
    }
  }

  const out = [...byKey.values()];
  for (const p of out) {
    p.jobs.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
  }
  // Something happening beats something quiet; then most recent; then named
  // properties ahead of the unidentified ones, which are a prompt rather than
  // a place and should not sit at the top of somebody's portfolio.
  out.sort((a, b) =>
    (b.openJobs > 0 ? 1 : 0) - (a.openJobs > 0 ? 1 : 0) ||
    String(b.lastActivity ?? "").localeCompare(String(a.lastActivity ?? "")) ||
    (a.unidentified ? 1 : 0) - (b.unidentified ? 1 : 0)
  );
  return out;
}

/** One line for the top of the page. Counts only, no judgements. */
export function portfolioSummary(props: Property[]): {
  properties: number;
  identified: number;
  openJobs: number;
  jobs: number;
} {
  return {
    properties: props.length,
    identified: props.filter((p) => !p.unidentified).length,
    openJobs: props.reduce((n, p) => n + p.openJobs, 0),
    jobs: props.reduce((n, p) => n + p.jobs.length, 0),
  };
}
