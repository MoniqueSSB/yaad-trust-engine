/**
 * When each stage of a job actually happened, for the calendar.
 *
 * Founder's instruction, 13 Sep 2026: the calendar on the client and worker
 * portals should track when each stage took place. The dates already exist,
 * scattered over five tables (the arrival log, evidence, stage approvals,
 * paid invoices, materials releases, plus the Kickoff Pack confirmation).
 * This module only reads them into one dated list. It decides nothing and
 * writes nothing: a date here is a record of a step a person already took.
 *
 * Every date is the Jamaica calendar day, fixed UTC-5 with no daylight
 * saving, the same rule log_arrival() uses for arrived_on. An approval given
 * at 11pm in London is still the same day in Portmore, and the calendar must
 * agree with the arrival log about which day that was.
 *
 * Pure on purpose, so the day grouping can be tested without a database.
 */

export type StageEventKind =
  | "agreed"
  | "arrived"
  | "evidence"
  | "approved"
  | "paid"
  | "materials";

export type StageEvent = {
  /** YYYY-MM-DD, Jamaica */
  day: string;
  /** "9:14 am", Jamaica; null where the record only carries a day */
  time: string | null;
  /** the underlying timestamp, for ordering */
  at: string;
  kind: StageEventKind;
  stage: number | null;
  /** evidence items filed against this stage on this day */
  count?: number;
};

type Row<K extends string> = { stage?: number | null } & { [P in K]?: string | null };

export type TimelineRows = {
  /** kickoff_packs.both_confirmed_at, on the approved pack only */
  agreedAt?: string | null;
  arrivals?: (Row<"arrived_at"> & { arrived_on?: string | null })[];
  evidence?: Row<"created_at">[];
  approvals?: Row<"approved_at">[];
  /** already filtered to the viewer's own side of the invoicing */
  paidInvoices?: (Row<"paid_at"> & { status?: string | null })[];
  materials?: Row<"released_at">[];
};

const JAMAICA_OFFSET_MS = 5 * 3600_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KIND_ORDER: StageEventKind[] = ["agreed", "arrived", "evidence", "approved", "paid", "materials"];

function shifted(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : new Date(t - JAMAICA_OFFSET_MS);
}

/** The Jamaica calendar day a timestamp fell on, as YYYY-MM-DD. */
export function jamaicaDay(iso: string | null | undefined): string | null {
  const d = shifted(iso);
  return d ? d.toISOString().slice(0, 10) : null;
}

/** The Jamaica clock time, "9:14 am". Read off the shifted UTC fields, so it
 *  does not depend on the server's own time zone. */
export function jamaicaTime(iso: string | null | undefined): string | null {
  const d = shifted(iso);
  if (!d) return null;
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "am" : "pm"}`;
}

/** "3 Sep 2026" from a YYYY-MM-DD day, the same shape as lib/date.ts. */
export function shortDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function stageOf(v: number | null | undefined): number | null {
  return typeof v === "number" && v > 0 ? v : null;
}

export function buildStageEvents(rows: TimelineRows): StageEvent[] {
  const out: StageEvent[] = [];
  const push = (at: string | null | undefined, kind: StageEventKind, stage: number | null, dayOverride?: string | null) => {
    const day = dayOverride || jamaicaDay(at);
    if (!day || !at) return;
    out.push({ day, time: jamaicaTime(at), at, kind, stage });
  };

  push(rows.agreedAt, "agreed", null);

  /* One arrival per stage per day. A worker who checks in twice on the same
     day was on site that day; the calendar says so once, at the first time. */
  const arrivedSeen = new Map<string, StageEvent>();
  for (const a of rows.arrivals ?? []) {
    const day = a.arrived_on || jamaicaDay(a.arrived_at);
    if (!day || !a.arrived_at) continue;
    const key = day + "|" + stageOf(a.stage);
    const prior = arrivedSeen.get(key);
    if (!prior || a.arrived_at < prior.at) {
      arrivedSeen.set(key, { day, time: jamaicaTime(a.arrived_at), at: a.arrived_at, kind: "arrived", stage: stageOf(a.stage) });
    }
  }
  out.push(...arrivedSeen.values());

  /* Evidence is filed item by item, often a dozen in an evening. The
     calendar wants one line per stage per day with the count. */
  const evid = new Map<string, StageEvent>();
  for (const e of rows.evidence ?? []) {
    const day = jamaicaDay(e.created_at);
    if (!day || !e.created_at) continue;
    const key = day + "|" + stageOf(e.stage);
    const prior = evid.get(key);
    if (prior) {
      prior.count = (prior.count ?? 1) + 1;
      if (e.created_at < prior.at) {
        prior.at = e.created_at;
        prior.time = jamaicaTime(e.created_at);
      }
    } else {
      evid.set(key, { day, time: jamaicaTime(e.created_at), at: e.created_at, kind: "evidence", stage: stageOf(e.stage), count: 1 });
    }
  }
  out.push(...evid.values());

  for (const a of rows.approvals ?? []) push(a.approved_at, "approved", stageOf(a.stage));

  /* A void invoice was never paid, whatever its paid_at says. A stage-less
     invoice is the agency fee or a one-off, not a stage, so it is left off
     rather than filed against a stage it does not belong to. */
  for (const i of rows.paidInvoices ?? []) {
    if (i.status === "void" || stageOf(i.stage) == null) continue;
    push(i.paid_at, "paid", stageOf(i.stage));
  }

  for (const m of rows.materials ?? []) push(m.released_at, "materials", stageOf(m.stage));

  return out.sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
}

export function eventsByDay(events: StageEvent[]): Map<string, StageEvent[]> {
  const map = new Map<string, StageEvent[]>();
  for (const e of events) {
    const list = map.get(e.day) ?? [];
    list.push(e);
    map.set(e.day, list);
  }
  return map;
}

/** Plain words for one event, from the viewer's side. */
export function eventLabel(e: StageEvent, side: "client" | "worker"): string {
  const s = e.stage != null ? `Stage ${e.stage} · ` : "";
  switch (e.kind) {
    case "agreed":
      return "Kickoff Pack confirmed by both sides";
    case "arrived":
      return s + (side === "worker" ? "you arrived on site" : "worker arrived on site");
    case "evidence": {
      const n = e.count ?? 1;
      return s + `${n} evidence item${n === 1 ? "" : "s"} filed`;
    }
    case "approved":
      return s + "approved";
    case "paid":
      return s + (side === "worker" ? "your pay invoice paid" : "invoice paid");
    case "materials":
      return s + "materials released";
  }
}

export type StageHistoryRow = {
  stage: number;
  name: string | null;
  /** the first time each kind of thing happened on this stage */
  firsts: Partial<Record<Exclude<StageEventKind, "agreed">, StageEvent>>;
};

/**
 * One row per stage, with the first date of each kind of event on it.
 * Stages come from the agreed pack's own list where there is one, plus any
 * stage number an event carries, so a stage with history never disappears
 * just because the pack could not be read.
 */
export function stageHistory(events: StageEvent[], stageNames: string[]): StageHistoryRow[] {
  const nums = new Set<number>(stageNames.map((_, k) => k + 1));
  for (const e of events) if (e.stage != null) nums.add(e.stage);
  return [...nums]
    .sort((a, b) => a - b)
    .map((stage) => {
      const firsts: StageHistoryRow["firsts"] = {};
      for (const e of events) {
        if (e.stage !== stage || e.kind === "agreed") continue;
        if (!firsts[e.kind]) firsts[e.kind] = e;
      }
      return { stage, name: stageNames[stage - 1] ?? null, firsts };
    });
}
