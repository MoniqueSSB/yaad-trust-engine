/* ── promises.ts ──────────────────────────────────────────────────────────
 *
 * Strip anything the model tacked on that Yaadly cannot stand behind.
 *
 * Pulled out of index.ts on 4 September 2026 for the same reason job-match.ts,
 * approval-match.ts and price-figures.ts already live in their own files:
 * index.ts calls Deno.serve() at module load, so importing it for a test would
 * start a live server. This file has no such side effect and carries its own
 * test.
 *
 * WHY IT EXISTS AT ALL. The prompt tells the assistant not to say what happens
 * next, not to promise a date and not to promise the work will be good. It
 * complies most of the time and then slips one in anyway. A prompt is a strong
 * preference, never a guarantee, and the sentences this business cannot afford
 * a model to improvise are the ones about what it will do, when, and how well.
 * So they live in code.
 *
 * Two passes, deliberately different shapes:
 *
 *   1. The tail pass, unchanged since it was written. A forward-looking
 *      sentence at the END of a reply is the model adding its own "what
 *      happens next" after the useful part. The system appends that sentence
 *      itself, word for word, every time, so the model's version is always
 *      surplus and always the one that is wrong.
 *
 *   2. The whole-reply pass, added 4 September 2026. A commitment to a DATE or
 *      to the QUALITY of the work is not surplus, it is a liability, and it
 *      does not politely wait until the end of the paragraph. "Someone will be
 *      out to you tomorrow" in the middle of an otherwise good reply is worse
 *      than the same sentence at the end, because the tail pass never looked
 *      there.
 *
 * The whole-reply pass is deliberately narrow, and the narrowness is the
 * design. It fires only on a sentence that has BOTH an actor Yaadly is
 * answerable for AND a commitment. It does not fire on a bare timescale,
 * because urgency is one of the things intake exists to collect, and cutting
 * "you need the back bedroom painted this week" out of a read-back would
 * damage the thing the read-back is for. The client's own words about their
 * own deadline are not a promise Yaadly made.
 */

/** A forward-looking sentence: the model writing its own "what happens next". */
const TAIL_PROMISE =
  /^\s*(i|we|somebody|someone|yaadly)\s*('?ll\b|will\b|am going to\b|are going to\b|gone\b)|^\s*let me (pass|send|forward|put)\b|^\s*(this|it) (will|'ll) be\b/i;

/** Somebody Yaadly is answerable for. Never "you": the client committing to
 *  their own deadline is information, not a promise. */
const ACTOR =
  /\b(?:i|we|yaadly|somebody|someone|a worker|the worker|a tradesperson|the tradesperson|a plumber|an electrician|they|he|she)\b/i;

/** A commitment to when. Bare dates and durations both count. */
const WHEN =
  /\b(?:today|tonight|tomorrow|this (?:week|morning|afternoon|evening)|next (?:week|month|day)|first thing|straight away|right away|immediately|same day|within (?:a|an|\d+)\s*(?:hour|day|week|month|working day)|in (?:a|an|\d+)\s*(?:hour|day|week|month)|\d+\s*(?:hours?|days?|weeks?|months?)|by (?:mon|tues?|wed|thur?s?|fri|sat|sun)\w*)\b/i;

/** A commitment to how well, or to cover. None of these are Yaadly's to make
 *  in a chat message: the workmanship guarantee is deliberately unstated until
 *  it is insured for a stated length (DECISIONS.md, 3 Sep 2026), and no
 *  insurance claim belongs in an intake reply. "Guarantee and Support fee" is
 *  excluded by name, because that is the published name of a real charge. */
const QUALITY =
  /\bguarantee(?!\s+and\s+support)\w*\b|\bwarrant(?:y|ies|ed)\b|\bi promise\b|\bwe promise\b|\brest assured\b|\byou can be sure\b|\bfully insured\b|\bcovered by insurance\b|\bno risk\b|\brisk[- ]free\b/i;

/** Does this one sentence commit Yaadly to a date, or to how good the work
 *  will be? Exported so the test can name the sentence that failed. */
export function isUnkeepable(sentence: string): boolean {
  if (QUALITY.test(sentence)) return true;
  return ACTOR.test(sentence) && WHEN.test(sentence);
}

/** The reply with the model's own promises removed.
 *
 *  Never returns empty. If every sentence was a promise the first one is kept,
 *  because on WhatsApp an empty reply is indistinguishable from being ignored,
 *  and the callers downstream (the price guard, then the banned-language
 *  screen) each have their own honest fallback for a reply that ends up with
 *  nothing worth sending. */
export function stripPromises(reply: string): string {
  const parts = String(reply ?? "").split(/(?<=[.!?])\s+/).filter(Boolean);
  if (!parts.length) return "";

  // Pass 1: the tail.
  while (parts.length > 1 && TAIL_PROMISE.test(parts[parts.length - 1])) parts.pop();

  // Pass 2: anywhere.
  const kept = parts.filter((s) => !isUnkeepable(s));
  return (kept.length ? kept : [parts[0]]).join(" ").trim();
}

/** Every sentence pass 2 would remove. For the log line, so a cut is visible
 *  rather than silent, the same way priceFigureGuard reports what it cut. */
export function unkeepableSentences(reply: string): string[] {
  return String(reply ?? "")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .filter(isUnkeepable);
}
