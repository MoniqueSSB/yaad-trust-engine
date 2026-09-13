// The measurement rule, written once.
//
// ── What the rule is ──
//
// A Site Sketch Pack and a drafted report may describe size in words. Neither
// may state a dimension. A phone video and a phone photograph carry no scale,
// so any number with a unit of length or area on it was invented, and
// producing measured drawings for reward is regulated work in Jamaica.
//
// Three layers enforce that: the prompt forbids it, this pattern removes
// whatever the model says anyway and reports it to the desk rather than hiding
// it, and has_measurement() in Postgres refuses to let a pack carrying one be
// approved. Layer one is the layer nobody should trust, which is the whole
// reason the other two exist.
//
// ── Why this file exists ──
//
// The pattern was typed out three times: yaad-sketch, yaad-report and the
// migration. Three hand-kept copies of one rule is two chances to fix a gap in
// one place and leave it open in the other two. The TypeScript copies now come
// from here, and measurements_test.ts reads the SQL out of the migration and
// fails if it differs by one character, so the Postgres copy cannot drift
// quietly either.
//
// ── What it deliberately does not catch ──
//
// Bare "in", because "1 in 5 tiles is cracked" is ordinary English. The
// American spellings "meter" and "meters" after a number WORD, because "two
// meters on the outside wall" is an electricity meter and a false positive
// there blocks an approval over nothing. Digits still catch "3 meters".
//
// And it will never catch "about the length of the veranda". No pattern will.
// That gap closes at the human who reads the pack, not here.
//
// ── Tested against, 5 September 2026 ──
//
// measurements_test.ts holds the case list, sixty-odd sentences of the kind a
// real condition note contains. Both the sentences that must be caught and the
// ordinary ones that must not. Add to it before you touch the pattern.

/**
 * A number, written in digits, carrying a unit of length or area.
 *
 * The separator allows a hyphen, so "a 2-metre crack" is caught. It was not,
 * until 5 September 2026, and that phrasing is exactly how a model writes the
 * sentence. An ASCII hyphen only: nothing in this system produces a typographic
 * dash, the house writing rule forbids them, and keeping the pattern to plain
 * characters is what lets this string stay byte-identical to the copy inside
 * the migration.
 */
const DIGIT_PATTERN =
  "(^|[^a-z0-9])[0-9]+([.,][0-9]+)?\\s*[-]?\\s*"
  + "(mm|cm|m|m2|m²|km|metre|metres|meter|meters|ft|ft2|foot|feet|yd|yds|yard|yards"
  + "|inch|inches|acre|acres"
  + "|sq\\.?\\s*(m|ft|yd|metre|metres|meter|meters|foot|feet|yard|yards)"
  + "|square\\s+(metre|metres|meter|meters|foot|feet|yard|yards))"
  + "([^a-z0-9]|$)";

/**
 * The same thing with the number written as a word. "twelve feet by ten feet"
 * and "half a metre" are measurements; they simply have no digit in them.
 */
const WORD_PATTERN =
  "(^|[^a-z0-9])(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve"
  + "|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty"
  + "|forty|fifty|sixty|seventy|eighty|ninety|half|quarter)"
  + "(\\s+and)?(\\s+a)?(\\s+(half|quarter))?[\\s-]+"
  + "(metre|metres|foot|feet|inch|inches|yard|yards)([^a-z0-9]|$)";

/** The canonical pattern. One string, two runtimes, no second opinion. */
export const MEASUREMENT_PATTERN = DIGIT_PATTERN + "|" + WORD_PATTERN;

/**
 * Feet and inch marks. Kept separate because it needs its own replacement:
 * the mark IS the unit, so unlike the patterns above there is no trailing word
 * to leave behind. It also has to swallow both halves of 6'6" in one bite. It
 * did not, until 5 September 2026, and left the 6' sitting in the sentence.
 */
export const MEASUREMENT_QUOTE_PATTERN =
  "[0-9]+\\s*(['\"])(\\s*[0-9]+([.,][0-9]+)?\\s*\")?(\\s|$|[.,;)])";

export const MEASUREMENT_RE = new RegExp(MEASUREMENT_PATTERN, "i");
export const MEASUREMENT_QUOTE_RE = new RegExp(MEASUREMENT_QUOTE_PATTERN, "i");

/** Both halves of the rule, as one global regex, for a caller that scrubs in a single pass. */
export function measurementRegExp(flags = "gi"): RegExp {
  return new RegExp(MEASUREMENT_PATTERN + "|" + MEASUREMENT_QUOTE_PATTERN, flags);
}

export function hasMeasurement(s: unknown): boolean {
  const t = String(s ?? "");
  return MEASUREMENT_RE.test(t) || MEASUREMENT_QUOTE_RE.test(t);
}

export const SIZE_REMOVED = "[size removed]";

// The boundary characters on each end of a match are ordinary punctuation and
// spacing belonging to the sentence, not to the measurement. Put them back, so
// what is left reads as English and the removal is visible rather than tidy.
function swapDigits(m: string): string {
  const lead = /^[^a-z0-9]/i.test(m) ? m[0] : "";
  const tail = m.length > 1 && /[^a-z0-9]$/i.test(m) ? m[m.length - 1] : "";
  return lead + SIZE_REMOVED + tail;
}

// A quote match always starts on a digit and ends either on the mark itself,
// which goes, or on the sentence's own spacing, which stays.
function swapQuotes(m: string): string {
  return SIZE_REMOVED + (/[\s.,;)]$/.test(m) ? m[m.length - 1] : "");
}

/**
 * Replace every measurement in one piece of text, recording what was there.
 * Replaced rather than deleted, so the sentence still reads and whoever checks
 * the draft can see that something was taken out of it.
 */
export function scrub(s: unknown, hits: string[]): string {
  let t = String(s ?? "");
  if (!hasMeasurement(t)) return t;
  hits.push(t.slice(0, 140));
  t = t.replace(new RegExp(MEASUREMENT_QUOTE_PATTERN, "gi"), swapQuotes);
  t = t.replace(new RegExp(MEASUREMENT_PATTERN, "gi"), swapDigits);
  return t;
}
