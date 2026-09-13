/* ── quote-pack-verdict ────────────────────────────────────────────────────
 *
 * What the guardrail says about a quote pack's contents.
 *
 * WHY THIS IS SHARED. Two things now decide whether a pack is clean: the
 * drafter (yaad-quote-pack), which scans what the model produced, and the
 * rescan door (yaad-quote-pack-rescan), which scans what a person corrected.
 * If those two ever computed the verdict differently, correcting a pack could
 * clear a flag the drafter would still have raised, and the flag would stop
 * meaning anything. One function, used by both, so that cannot happen.
 *
 * THE SCANNER IS PASSED IN rather than imported, and that is not style. Both
 * sync-shared.sh and the CI drift check decide what to copy by reading which
 * shared files an index.ts imports, so a shared file importing another shared
 * file would have the second one deleted as an orphan. Taking `scan` as an
 * argument keeps both imports honest and visible in each function's index.ts.
 *
 * IT DECIDES NOTHING. It reports. Nothing here approves a pack, and a dirty
 * verdict is still refused by approve_quote_pack_draft() in Postgres.
 */

/** Every section a finished pack must carry. The drafter fails without them. */
export const REQUIRED_SECTIONS = [
  "scope_summary",
  "included",
  "excluded",
  "rough_timeline",
  "payment_stages",
] as const;

export type Verdict = {
  price_language_detected: boolean;
  samples: string[];
  banned_language_detected: boolean;
  banned_samples: string[];
};

/** Sections a pack is missing, in the order they are required. */
export function missingSections(docs: Record<string, unknown>): string[] {
  return REQUIRED_SECTIONS.filter((k) => !(k in docs));
}

/**
 * The guardrail verdict on a pack.
 *
 * `scan` is guardrails.scan. The price patterns are the drafter's own, moved
 * here verbatim so the two callers cannot drift: a pack must never carry a
 * figure, because the worker prices the job and Yaadly does not.
 */
export function verdictFor(
  docs: Record<string, unknown>,
  scan: (text: string) => Array<{ term: string }>,
): Verdict {
  const blob = JSON.stringify(docs);
  const priceHits = [
    ...(blob.match(/(?:J?\$|£|€|USD|JMD|GBP)\s?[\d,]+(?:\.\d+)?/gi) ?? []),
    ...(blob.match(/\b\d[\d,]{2,}(?:\.\d{2})?\s?(?:dollars|pounds|JMD|USD|GBP)\b/gi) ?? []),
  ];
  const bannedHits = scan(blob);
  return {
    price_language_detected: priceHits.length > 0,
    samples: priceHits.slice(0, 5),
    banned_language_detected: bannedHits.length > 0,
    banned_samples: [...new Set(bannedHits.map((f) => f.term))].slice(0, 5),
  };
}
