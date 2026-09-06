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

/** The exact sentence the "get job alerts" button puts in somebody's WhatsApp
 *  box, and the link that does it. Both live here, in one place, because the
 *  lane has to recognise this exact sentence: a page that drifts from it by a
 *  word produces a button that looks fine and silently does nothing. There is a
 *  test that reads every page carrying the button and checks it still matches.
 *
 *  Matched exactly rather than through ALERTS_PHRASE, and that distinction
 *  matters. The loose phrasings are refused from a number with a job
 *  conversation already running, which is right for a sentence somebody typed
 *  themselves and wrong for one our own button wrote: a tradesperson who posted
 *  a job from the same number last month should still be able to press it. */
export const ALERTS_OPENER = "Hello Yaadly, I am a tradesperson and I want job alerts.";

/** The Yaadly WhatsApp sender, the same number every button on the site uses. */
export const ALERTS_WA_LINK =
  "https://wa.me/447878877567?text=" + encodeURIComponent(ALERTS_OPENER);

/** Asking to join, whether or not they have a job conversation running. The
 *  keyword on its own, or the button's own sentence. */
export function alertsOpenerExact(said: string): boolean {
  const t = (said ?? "").trim();
  return ALERTS_EXACT.test(t) || t.toLowerCase() === ALERTS_OPENER.toLowerCase();
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
