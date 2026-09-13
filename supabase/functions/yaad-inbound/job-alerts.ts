// The job alert list, the parts of it that can be tested without a database:
// what counts as asking to join, what counts as asking to stop, the consent
// version and the sentence it refers to, and how a list of trades is read back
// to somebody in words.
//
// WHAT THE LIST IS. Anybody may ask to be told when a job opens. Only a vetted
// worker may quote. Founder's decision, 6 September 2026, and the reason the
// list is a table of its own (job_alert_subscribers) rather than a flag on
// worker_profiles: being on it is permission to be told, never permission to
// take work. Somebody on it who has not finished being checked is a lead, and
// the joining reply says so to their face rather than letting them find out
// when a job they cannot take arrives.
//
// WHY JOINING HAPPENS OVER WHATSAPP AND NOT IN A FORM ON THE SITE. A message
// they send us proves three things at once that a typed box proves none of:
// the number really is theirs, they asked for this in their own words, and
// WhatsApp's 24 hour window is open, so the replies are ordinary messages
// rather than approved templates. Meta wants to see opt-in of exactly this
// shape, and the sender it would otherwise flag is the same number the whole
// evidence pipeline runs on.
//
// NOTHING HERE, OR IN THE LANE IN index.ts, SENDS AN ALERT. Joining is built
// cold on purpose so a mistake in matching cannot message the whole list while
// it is still being found. Alerting is yaad-match's job and is not wired up.

/** Bump this whenever the wording of ALERT_TERMS changes. A consent is worth
 *  exactly what the sentence that earned it said, so an old version must never
 *  be read as agreement to a newer or a broader one. Same rule, and the same
 *  reasoning, as AI_CONSENT_VERSION in web/app/apply/JoinFlow.tsx.
 *
 *  alerts-v1, 6 Sep 2026: told over WhatsApp when a job opens in the trades and
 *  parishes they name, quoting free, vetting still required before they can
 *  quote, STOP at any time. */
export const ALERT_CONSENT_VERSION = "alerts-v1";

/** The sentence ALERT_CONSENT_VERSION refers to. Said at the moment somebody
 *  joins, so what they agreed to is a thing they actually read rather than a
 *  policy page nobody opened. */
export const ALERT_TERMS =
  "We will message this number when a job opens in your trades and parishes. Quoting is free and always will be. Send STOP any time and it ends.";

/** "ALERTS" on its own, and the openers a click-to-WhatsApp link puts in
 *  somebody's box. Always read as joining. */
export const ALERTS_EXACT = /^(alerts?|job alerts?|start alerts?|subscribe)[.!]*$/i;

/** The looser phrasings. Only read as joining from a number with no job
 *  conversation already running, so a client writing "can you send me alerts
 *  about my job" is never dragged into the worker lane and away from their own
 *  job. That second condition lives in index.ts, where the prior thread is. */
export const ALERTS_PHRASE = /\b(?:want|get|join|for)\s+(?:the\s+)?(?:job\s+)?alerts?\b/i;

/** The sentence the board's "Put me on the list" button puts in somebody's
 *  WhatsApp box. Main's wording, not mine, and deliberately: Monique approved
 *  it on 6 September for the "Launching soon" panel, and that panel's own
 *  runbook entry says "when the alerts are actually built, the prefilled
 *  wording is the spec." This is the build. Reconciled 13 September 2026, when
 *  two sessions turned out to have shipped two different sentences for the
 *  same button and the lane recognised only one of them.
 *
 *  It ENDS WITH A PROMPT, "My trades and parishes are:", so plenty of people
 *  will type their answer on the end before pressing send. That is why it is
 *  matched as a prefix rather than exactly, and why alertsOpenerRemainder()
 *  exists: what they typed is read, not thrown away and asked for again.
 *
 *  web/lib/alerts.ts and docs/marketplace.html carry copies, because neither a
 *  Next.js build nor a page with no build step can import this file. The test
 *  beside this file reads both and fails if either drifts, because a button
 *  whose sentence the lane does not recognise opens WhatsApp, sends, and puts
 *  nobody on the list, with no error anywhere. */
const ALERTS_OPENER_CORE = "Hello Yaadly, I am a worker and I want WhatsApp job alerts";
export const ALERTS_OPENER = ALERTS_OPENER_CORE + ". My trades and parishes are:";

/** The Yaadly WhatsApp sender, the same number every button on the site uses. */
export const ALERTS_WA_LINK =
  "https://wa.me/447878877567?text=" + encodeURIComponent(ALERTS_OPENER);

const squash = (x: string) => (x ?? "").replace(/\s+/g, " ").trim();

/** Asking to join, whether or not they have a job conversation running: the
 *  keyword on its own, or anything that starts with the button's sentence.
 *  Deleting the "My trades and parishes are:" prompt before sending still
 *  counts; only the first sentence has to survive. */
export function alertsOpenerExact(said: string): boolean {
  const t = squash(said);
  return ALERTS_EXACT.test(t) || t.toLowerCase().startsWith(ALERTS_OPENER_CORE.toLowerCase());
}

/** Whatever they typed after the button's sentence, with the prompt itself
 *  taken off. "" when there was nothing, or when this was not the opener. */
export function alertsOpenerRemainder(said: string): string {
  const t = squash(said);
  if (!t.toLowerCase().startsWith(ALERTS_OPENER_CORE.toLowerCase())) return "";
  return t.slice(ALERTS_OPENER_CORE.length)
    .replace(/^[.!]?\s*(my trades and parishes are\s*:?)?/i, "")
    .trim();
}

/** A word that set_job_alert_parishes() reads as "every parish". Safe in the
 *  parishes question, where "all" can only mean all of them. NOT safe in a
 *  sentence that mixes trades and parishes: "I do all kinds of plumbing,
 *  Portmore" would put somebody on the list for the whole island. So when the
 *  opener's remainder contains one of these, the lane does not read parishes
 *  from it and asks the parishes question on its own instead. */
export const ANYWHERE_WORD = /\b(all|anywhere|island ?wide|whole island|everywhere)\b/i;

/** The words in a mixed answer that NEITHER side could place. Trades and
 *  parishes are read from the same text, so each side's unmatched list is full
 *  of the other side's words: "Portmore" is not a trade and "plumbing" is not a
 *  parish. Only a word both sides rejected is genuinely unplaced, and only that
 *  is worth saying back to the person. */
export function neitherPlaced(tradesUnmatched: string[], parishesUnmatched: string[]): string[] {
  const other = new Set((parishesUnmatched ?? []).map((w) => w.toLowerCase()));
  return (tradesUnmatched ?? []).filter((w) => other.has(w.toLowerCase()));
}

/** Coming off the list. Answered with or without a session open: somebody who
 *  wants out must never have to be in the middle of something to say so. */
export const ALERTS_STOP = /^(stop|stop alerts?|unsubscribe|no more alerts?)[.!]*$/i;

/** Two goes at each question, then the lane lets go. An alerts session that
 *  never ended would swallow every message that number sent afterwards, a real
 *  job description included, which is a far worse failure than not capturing
 *  somebody's trades on the first try. */
export const ALERTS_MAX_TRIES = 2;

/** "plumbing, tiling and masonry". The confirmation reads their own list back
 *  to them and a comma-separated dump reads like a receipt. */
export function sayList(xs: string[]): string {
  const clean = (xs ?? []).filter((x) => String(x ?? "").trim().length > 0);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  return clean.slice(0, -1).join(", ") + " and " + clean[clean.length - 1];
}
