/* ── job-match.ts ─────────────────────────────────────────────────────────
 *
 * Pulled out of index.ts so this one function can be exercised by a
 * permanent test. index.ts calls Deno.serve() at module load, so importing
 * it directly for a test would start a live server; this file has no such
 * side effect.
 */

export type JobChoice = { id: string; title: string; stage: number };

// The job's own code is the primary way a worker confirms which job a
// photo belongs to, founder's own requirement, 31 Aug 2026: "confirmation
// of the job and the confirmation of the code... that photo will link to
// the correct evidence." A number or a title match are still accepted, as
// a convenience, but the code is what every prompt leads with and the code
// is checked first, because it is the one answer that cannot be given by
// accident.
export function pickJobChoice(text: string, choices: JobChoice[]): JobChoice | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;

  const byCode = choices.filter((c) => t.includes(c.id.toLowerCase()));
  if (byCode.length === 1) return byCode[0];

  const n = parseInt(t.replace(/\D/g, ""), 10);
  if (Number.isFinite(n) && n >= 1 && n <= choices.length) return choices[n - 1];

  const hits = choices.filter((c) => c.title.toLowerCase().includes(t));
  return hits.length === 1 ? hits[0] : null;
}
