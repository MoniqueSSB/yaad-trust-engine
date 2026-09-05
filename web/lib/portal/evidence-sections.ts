/**
 * The sections a job's evidence is read in, defined once.
 *
 * Four of them are declared on `evidence.phase` by whoever filed the item, in
 * answer to a direct question, and are never read out of the label. The fifth,
 * materials, is not a phase at all: it lives on `evidence.kind` and has since
 * 20260828c, because filing it is what moves the risk in the materials to the
 * client. It is refused a phase by the database constraint. Grouping it here
 * with the other four is a display decision, not a schema one.
 *
 * This file holds the words and the grouping, so neither drifts. The same five
 * sections, in the same order, are read by the client on their job page,
 * printed on the Completion Report, and named to the worker on the upload
 * forms. Three copies of "Problems found" that slowly become three different
 * phrases is how a client ends up asking what the difference is between an
 * issue and a problem.
 *
 * The stored value for a problem is 'issue', and that word is never shown to
 * anybody. A worker on site says problem. So does a client.
 *
 * Order is deliberate and is the order of the work, not alphabetical: what it
 * was, what happened, what was found, what it became, and what was bought for
 * it. Anything nobody marked comes last, under a heading that says so rather
 * than one that quietly implies it was ordinary.
 */

export type EvidencePhase = "before" | "during" | "issue" | "after";

export const EVIDENCE_PHASES: EvidencePhase[] = ["before", "during", "issue", "after"];

/** The short word on a badge, next to a photograph. */
export const PHASE_BADGE: Record<EvidencePhase, string> = {
  before: "Before",
  during: "During",
  issue: "Problem",
  after: "After",
};

/** The heading over a group of them. */
export const PHASE_HEADING: Record<EvidencePhase, string> = {
  before: "Before",
  during: "During the work",
  issue: "Problems found",
  after: "After",
};

/** What the worker picks from on an upload form. */
export const PHASE_OPTION: Record<EvidencePhase, string> = {
  before: "Before",
  during: "During the work",
  issue: "A problem found",
  after: "After",
};

/** One line under a heading, for a client who has not seen this before. */
export const PHASE_NOTE: Record<EvidencePhase, string> = {
  before: "How it was before anybody touched it.",
  during: "The work in progress.",
  issue: "Found on site, and not part of what was originally quoted. Anything that changes the price or the timeline is agreed with you in writing before it happens.",
  after: "How it was when this stage was finished.",
};

export const MATERIALS_HEADING = "Materials on site";
export const MATERIALS_NOTE =
  "The receipt and the materials in the place you nominated. Filing this is what passes the risk in them across.";

export const UNMARKED_HEADING = "Not marked";
export const UNMARKED_NOTE =
  "Filed without saying which part of the job it belongs to. Everything filed before 5 September 2026 sits here, because nothing recorded it then.";

export function isPhase(v: unknown): v is EvidencePhase {
  return typeof v === "string" && (EVIDENCE_PHASES as string[]).includes(v);
}

/** The badge word, or null when there is nothing to show. */
export function phaseBadge(phase: unknown, kind?: unknown): string | null {
  if (kind === "materials") return "Materials";
  return isPhase(phase) ? PHASE_BADGE[phase] : null;
}

/**
 * Split a stage's items into the sections a client reads them in, dropping any
 * that are empty. Materials is not a phase and never was: it is read off kind,
 * and the database refuses a phase on it, so kind is checked first and an item
 * can only ever land in one section. Anything nobody marked lands in the last
 * group under a heading that says exactly that, rather than being folded into
 * a real one and quietly overstating the record.
 *
 * Generic over the item so the ledger keeps its own richer type, and a plain
 * function here rather than in the component so it can be tested without a
 * JSX loader. The component draws these sections; it does not decide them.
 */
export function sectionsOf<T extends { phase?: string | null; kind?: string | null }>(
  items: T[],
): { key: string; heading: string; note: string; items: T[] }[] {
  const out: { key: string; heading: string; note: string; items: T[] }[] = [];

  for (const ph of EVIDENCE_PHASES) {
    const mine = items.filter((e) => e.kind !== "materials" && e.phase === ph);
    if (mine.length)
      out.push({
        key: ph,
        heading: PHASE_HEADING[ph],
        note: PHASE_NOTE[ph],
        items: mine,
      });
  }

  const materials = items.filter((e) => e.kind === "materials");
  if (materials.length)
    out.push({
      key: "materials",
      heading: MATERIALS_HEADING,
      note: MATERIALS_NOTE,
      items: materials,
    });

  const unmarked = items.filter(
    (e) => e.kind !== "materials" && !isPhase(e.phase),
  );
  if (unmarked.length)
    out.push({
      key: "unmarked",
      heading: UNMARKED_HEADING,
      note: UNMARKED_NOTE,
      items: unmarked,
    });

  return out;
}
