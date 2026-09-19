/* ── job-match.ts ─────────────────────────────────────────────────────────
 *
 * Pulled out of index.ts so this one function can be exercised by a
 * permanent test. index.ts calls Deno.serve() at module load, so importing
 * it directly for a test would start a live server; this file has no such
 * side effect.
 */

export type JobChoice = { id: string; title: string; stage: number };

/** A yes that points at the job, when only one job was put to them.
 *
 *  19 September 2026. The founder sent a photo, was asked "This looks like
 *  it is for JOB-WEB-1789253807959 (Carpentry & Joinery job, Kingston).
 *  Reply with the code ... to confirm", answered "Yes for that job", and was
 *  told it did not match a job. It did. The question named one job and one
 *  only, and a yes that says which job it means is the answer to it.
 *
 *  A BARE "yes" IS STILL NOT ENOUGH, and that is deliberate, not an
 *  oversight. It was ruled out on 15 September (DECISIONS.md, and the test
 *  next to this file holds it) because a stray yes in a chat is the one way
 *  a photograph lands on a job nobody meant. So the reply has to do two
 *  things: open with an affirmative, and refer to the job. "Yes for that
 *  job", "yes that one", "correct" confirm. "Yes", "yes please", "ok" do
 *  not, and get the code prompt again.
 *
 *  Only ever consulted when there is exactly one choice. With two jobs on
 *  the table no yes means anything, whatever it points at, and the code is
 *  still the only answer. */
const YES_OPENER = /^(?:yes|yeah|yeh|yep|yup|ya|yah|yea)\b/i;
// An opener that already names the job on its own. No tail needed.
const POINTS_ON_ITS_OWN = /^(?:correct|confirm(?:ed)?|(?:that|dat|same|this) one|thats? the one|that's the one)\b/i;
// The words that make a yes point somewhere.
const REFERRING = /^(?:that|thats|that's|this|dat|same|one|job|it|right|correct)$/i;
// Filler that may sit around them without changing the meaning.
const HARMLESS = /^(?:yes|yeh|man|sir|please|pls|thanks|thank|you|the|for|to|is|sure|ok|okay|a)$/i;
const NEGATION = /\b(?:no|nah|nope|not|dont|don't|wrong|other|another|different|else|mistake)\b/i;

export function readsAsYes(text: string): boolean {
  const t = String(text ?? "").trim().replace(/[.!,]+$/, "");
  if (!t) return false;
  const words = t.split(/\s+/).map((w) => w.replace(/[^\w']/g, "")).filter(Boolean);
  if (!words.length || words.length > 6) return false;
  if (NEGATION.test(t)) return false;
  if (POINTS_ON_ITS_OWN.test(t)) return true;
  if (!YES_OPENER.test(t)) return false;
  const tail = words.slice(1);
  // Every word after the yes has to be either a pointer at the job or
  // harmless filler. A real word in there makes it a sentence, and a
  // sentence may be saying something this function cannot read.
  if (!tail.every((w) => REFERRING.test(w) || HARMLESS.test(w))) return false;
  return tail.some((w) => REFERRING.test(w));
}

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

  if (choices.length === 1 && readsAsYes(t)) return choices[0];

  const n = parseInt(t.replace(/\D/g, ""), 10);
  if (Number.isFinite(n) && n >= 1 && n <= choices.length) return choices[n - 1];

  const hits = choices.filter((c) => c.title.toLowerCase().includes(t));
  return hits.length === 1 ? hits[0] : null;
}
