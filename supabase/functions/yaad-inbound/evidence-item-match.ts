/* ── evidence-item-match.ts ───────────────────────────────────────────────
 *
 * Pulled out the same way job-match.ts and approval-match.ts already are:
 * index.ts calls Deno.serve() at module load, so a permanent test needs
 * this logic in its own file with no such side effect.
 *
 * Founder's own finding, 31 Aug 2026: a stage with more than one item has
 * no way to say which comment belongs to which. Evidence codes (P1, P2, ...,
 * 20260831zzzz2) exist so a WhatsApp comment CAN name one, but only when it
 * actually does. A plain comment with no code still means "about this stage,"
 * as it always has: this only ever narrows to one item, never guesses one.
 */

export type EvidenceItem = { id: string; item_code: string | null };

// A bare "p1" or "P1" inside a longer sentence, word-boundary on the digits
// so "p12" is not read as containing "p1". Case-insensitive: a phone
// keyboard capitalises the first letter of a sentence without being asked.
const CODE_RE = /\bp(\d+)\b/i;

export function pickEvidenceItem(text: string, items: EvidenceItem[]): EvidenceItem | null {
  const m = text.match(CODE_RE);
  if (!m) return null;
  const code = `P${m[1]}`;
  const hit = items.find((e) => (e.item_code ?? "").toLowerCase() === code.toLowerCase());
  return hit ?? null;
}
