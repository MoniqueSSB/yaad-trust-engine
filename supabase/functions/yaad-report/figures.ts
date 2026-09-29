// The figure rule, written once.
//
// ── What the rule is ──
//
// CLAUDE.md §5 and rule 4 of the report drafting prompt: the agent may never
// state, estimate or imply a cost, a price, a day rate or a quantity of
// materials, and it may not repeat a figure out of the notes either. Yaadly
// guarantees project management and oversight judgment. It does not guarantee
// price estimation, which is quantity surveying, and a number in a Yaadly
// document reads to a client as a number Yaadly stands behind.
//
// The person signing decides which figures go in the document. Not the model.
//
// ── Why this file exists ──
//
// On 25 September 2026 the drafter produced its first real Deposit Protection
// Check. Rule 4 had been in the prompt all along and had just been rewritten
// to forbid repeating a figure in terms. The draft came back carrying four of
// them, lifted straight out of the notes, and nothing stopped it, because
// nothing in the code was looking. The measurement scrubber only reads units
// of length, and the banned-language screen only reads words.
//
// A rule that lives only in a prompt is not a rule. It is a wish. This is the
// second layer, and has_figure() in Postgres is the third: the issue gate
// refuses a report carrying a figure, exactly as it already refuses one
// carrying a measurement.
//
// ── What it deliberately does not catch ──
//
// Percentages and the shape of an arrangement. "Most of the price is payable
// before any materials are on site", "payment is in three stages", "60 percent
// up front" are all descriptions of structure, they are what the client needs
// told, and rule 4 allows them in terms.
//
// Ordinary counting, which rule 3 already blesses: "a team of four", "two of
// the five latches", "six weeks from deposit", "three bedroom". None of these
// is a cost and none is touched.
//
// And it will never catch "he wants most of it up front in cash". No pattern
// will. That gap closes at the person who reads the draft, not here.

/** A currency marker sitting in front of a number. J$1,240,000 and £149. */
const MARKED_PATTERN =
  "(^|[^a-z0-9])(j\\$|ja\\$|us\\$|ca\\$|\\$|£|jmd|gbp|usd|cad)\\s*[0-9][0-9,.]*";

/** A number with the currency named after it instead. "700000 JMD", "149 pounds". */
const TRAILING_PATTERN =
  "(^|[^a-z0-9])[0-9][0-9,.]*\\s*"
  + "(jmd|gbp|usd|cad|dollars|dollar|pounds|pound)([^a-z0-9]|$)";

/** The same thing with the number written as a word. "fifty thousand dollars". */
const WORD_PATTERN =
  "(^|[^a-z0-9])(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve"
  + "|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)"
  + "(\\s+(hundred|thousand|million|and))*\\s+"
  + "(dollars|dollar|pounds|pound)([^a-z0-9]|$)";

/**
 * A bare number written in thousands groups, with no currency on it at all.
 *
 * "one figure of 1,240,000" is how a model writes the sentence once it has
 * been told not to write the currency, and it is still the price. A grouped
 * number in a condition note is a sum of money or a quantity of materials,
 * and rule 4 bans both. A year has no comma in it, so 2026 is safe.
 */
const GROUPED_PATTERN = "(^|[^a-z0-9])[0-9]{1,3}(,[0-9]{3})+([^0-9]|$)";

/** The canonical pattern. One string, two runtimes, no second opinion. */
export const FIGURE_PATTERN =
  MARKED_PATTERN + "|" + TRAILING_PATTERN + "|" + WORD_PATTERN + "|" + GROUPED_PATTERN;

export const FIGURE_RE = new RegExp(FIGURE_PATTERN, "i");

export function figureRegExp(flags = "gi"): RegExp {
  return new RegExp(FIGURE_PATTERN, flags);
}

export function hasFigure(s: unknown): boolean {
  return FIGURE_RE.test(String(s ?? ""));
}

export const FIGURE_REMOVED = "[figure removed]";

// The boundary characters on each end of a match belong to the sentence, not
// to the figure. Put them back, so what is left reads as English and the
// removal is visible rather than tidy.
function swap(m: string): string {
  const lead = /^[^a-z0-9]/i.test(m) ? m[0] : "";
  const tail = m.length > 1 && /[^a-z0-9]$/i.test(m) ? m[m.length - 1] : "";
  return lead + FIGURE_REMOVED + tail;
}

/**
 * Replace every figure in one piece of text, recording what was there.
 * Replaced rather than deleted, so the sentence still reads and whoever checks
 * the draft can see that something was taken out of it.
 */
export function scrub(s: unknown, hits: string[]): string {
  const t = String(s ?? "");
  if (!hasFigure(t)) return t;
  hits.push(t.slice(0, 140));
  return t.replace(figureRegExp("gi"), swap);
}
