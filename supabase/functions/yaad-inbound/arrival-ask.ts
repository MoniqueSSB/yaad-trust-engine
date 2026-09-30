/* ── arrival-ask.ts ───────────────────────────────────────────────────────
 *
 * Asking a worker to check in, at the moment they send the first evidence of
 * the day.
 *
 * WHY. Founder, 29 September 2026, after her own stage 3 came back with "No
 * arrival tap on this stage". In her words, in the order she settled them:
 *
 *   "ask them to send their location on whatsapp or through the portal to
 *    confirm they are on site that day"
 *   "let them know the message will retire in 24 hours so they reply in the
 *    appropriate time"
 *   "This arrival log is only for jobs where the client is not on site"
 *   "skip can be allowed but let them know they need to do a log before they
 *    leave site for that day, as we can still log the evidence"
 *
 * Until then a worker was told how to check in once, in the message that said
 * the job was live, and never again. Nothing asked at the moment it mattered,
 * so the Arrival Log, the first link in the evidence chain, was the link most
 * often missing.
 *
 * IT ASKS, IT DOES NOT GATE. arrival_log's own migration says GPS
 * "strengthens the record and never gates it", and that still holds. A worker
 * who replies skip has their evidence filed there and then, and is told they
 * still need to check in before they leave site. A stage with no arrival is
 * named on the evidence check, and whether it passes is a named person's
 * call, as it always was.
 *
 * WHAT WAITS AND FOR HOW LONG. The photographs are already parked while the
 * job question is open, and they stay parked while this one is. Nothing new
 * is stored. The ask stands 24 hours and says so; after that the batch is let
 * go and the sweep deletes the files on its usual clock.
 *
 * WHICH JOBS. Only where nobody at the property is watching. That rule is
 * _shared/arrival-rule.ts, because the evidence check has to agree with it.
 *
 * Pure on purpose, so the wording and the rules are tested without a webhook.
 */

/** How long the ask stands. Said to the worker in the ask, so it must stay
 *  the number the ask names. */
export const ARRIVAL_HOLD_MS = 24 * 3600_000;

export type Held = "photos" | "update";

const HOW =
  "tap the plus sign (or the paperclip) next to the message box, choose Location, then Send your current location";

/** The ask, in full. Sent once, when the job is known and nobody has checked
 *  in on it today. */
export function arrivalAsk(jobId: string, stageSaid: string, held: Held, portalLink: string | null): string {
  const kept = held === "photos"
    ? "Your photos are kept and go on the job as soon as you reply."
    : "Your update is kept and goes on the job as soon as you reply.";
  const again = held === "photos" ? "the photos are let go and you would need to send them again" : "the update is let go and you would need to send it again";
  const portal = portalLink
    ? `2. In the portal: open ${portalLink} and tap "I'm on site" on the Evidence tab, then come back here and reply done.`
    : `2. In the portal: sign in at app.yaadly.co.uk, open the job, and tap "I'm on site" on the Evidence tab, then come back here and reply done.`;
  return [
    `That is for ${jobId}, ${stageSaid}. First, confirm you are on site today. ${kept}`,
    `Two ways, either one:\n1. Here: ${HOW}.\n${portal}`,
    `Or reply skip to file now and check in later. You need to check in before you leave site today.`,
    `This waits 24 hours. After that ${again}. If you cannot share your location, say so and a person at Yaadly will help.`,
  ].join("\n\n");
}

/** The ask again, short, for a reply that was none of the answers. */
export function arrivalStillWanted(held: Held): string {
  return `Your ${held === "photos" ? "photos are" : "update is"} waiting on one reply. Send your location here (${HOW}), or check in on the portal and reply done, or reply skip to file now and check in before you leave site. If you cannot share your location, say so.`;
}

/** Said when a worker skips. The evidence is filed; the check-in is still
 *  owed, today, before they leave. */
export const CHECK_IN_BEFORE_YOU_LEAVE =
  `No check-in yet today.\nCheck in before you leave site today: ${HOW}.`;

const SKIP = /^(?:skip|skip it|later|not now|after|afterwards|file it|file now|file them|just file it)[.!]*$/i;
const DONE = /^(?:done|sent|checked in|check in done|i have|i did|did it|finished|i'?m on site|on site)[.!]*$/i;

export function isSkip(text: string): boolean {
  return SKIP.test(String(text ?? "").trim());
}

/** "done", after checking in on the portal. It is about the check-in and is
 *  never the description of a photograph or a new update. */
export function saysCheckedIn(text: string): boolean {
  return DONE.test(String(text ?? "").trim());
}

/** Has the ask lapsed? A missing or unreadable time counts as not lapsed:
 *  letting go of somebody's evidence needs a clock that was actually read. */
export function arrivalAskLapsed(askedAt: unknown, now: number = Date.now()): boolean {
  const t = Date.parse(String(askedAt ?? ""));
  return Number.isFinite(t) && now - t > ARRIVAL_HOLD_MS;
}

const CANNOT =
  /\b(?:can ?not|can'?t|cannot|cyaan|cyah|cya|caan|unable|won'?t work|not working|nah work|no work|doesn'?t work|does not work|no (?:signal|service|gps|data|location|network)|location (?:is )?(?:off|broken)|don'?t (?:want|have)|do not (?:want|have)|nuh (?:have|want)|refuse|not sharing|no smartphone)\b/i;

/** A worker saying they cannot, or will not, share where they are. Goes to a
 *  person. Never argued with and never treated as a caption. */
export function cannotCheckIn(text: string): boolean {
  return CANNOT.test(String(text ?? ""));
}

/** A real pin: both numbers present and not the 0,0 that a missing field
 *  turns into. */
export function isPin(lat: unknown, lon: unknown): boolean {
  if (lat === null || lat === undefined || lon === null || lon === undefined) return false;
  const a = Number(lat), b = Number(lon);
  return Number.isFinite(a) && Number.isFinite(b) && !(a === 0 && b === 0);
}
