/** A worker's typed update waits to be confirmed before it goes on the job.
 *
 *  Until 17 September 2026 any plain message from a worker with one live job
 *  was filed as evidence the moment it arrived. The founder's own test job
 *  came out with "done", "no", "share location" and "1" on its record, each
 *  one a line of chat, none of them meant as proof of anything. Her
 *  instruction: the record shows only what the person sending it approved.
 *
 *  So the words are read back and held, and only a reply of 1 files them.
 *  Anything else the worker types in the meantime replaces the draft rather
 *  than piling up next to it, which is what keeps chat off the record: a
 *  stray message only ever becomes the next thing read back, never a filing.
 *
 *  Pure on purpose, so the rule is tested without a webhook. */

import { alsoPressed, pressDoubledLetters } from "./worker-question.ts";

export type DraftReply = "file" | "discard" | "keep" | "replace";

const DISCARD = /^(?:no|nah|nope|cancel|delete|drop it|don'?t|do not|stop|scrap it|leave it)[.!]*$/i;
// "nno" and "noo" are a no, 29 Sep 2026. See pressDoubledLetters.
const DISCARD_PRESSED = alsoPressed(DISCARD);

/** Not an update on its own, whether or not a draft is waiting: a lone
 *  character, a number, punctuation. "1" arriving after a report prompt has
 *  already closed was filed as evidence on 15 September 2026. */
export function tooShortToBeAnUpdate(text: string): boolean {
  const t = String(text ?? "").trim();
  return t.length <= 1 || /^[\d\W]+$/.test(t);
}

/** Do these words say what a photograph shows?
 *
 *  A "1" went on JOB-WEB-1789253807959 as the description of a photograph on
 *  29 September 2026: the worker had just been told to reply 1 for the job,
 *  and the next thing asked was what the picture showed. A lone character, a
 *  number or an "ok" is an answer to some other question, never a caption, so
 *  the photograph is treated as having none and the question is asked. */
export function saysWhatItShows(text: string, isAcknowledgement: (t: string) => boolean): boolean {
  const t = String(text ?? "").trim();
  return !!t && !tooShortToBeAnUpdate(t) && !isAcknowledgement(t);
}

/** What a plain text reply means while an update is waiting.
 *  Questions are not decided here: the caller answers them first and keeps
 *  the draft, the same order every other worker lane uses. */
export function readDraftReply(text: string, isAcknowledgement: (t: string) => boolean): DraftReply {
  const t = String(text ?? "").trim();
  if (t === "1") return "file";
  if (DISCARD.test(t) || DISCARD_PRESSED.test(pressDoubledLetters(t))) return "discard";
  if (tooShortToBeAnUpdate(t) || isAcknowledgement(t)) return "keep";
  return "replace";
}

function clip(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

/** The read-back. Says the whole of what would be filed, where, and the one
 *  reply that files it.
 *
 *  `joinsBatch` is a note answering the invitation on a filing confirmation,
 *  20 Sep 2026: the worker has just sent photographs and these words are
 *  about those, so they are filed sharing their batch_id and the portal draws
 *  the lot as one update rather than as words standing on their own beside
 *  pictures nobody connected them to.
 *
 *  The last sentence is dropped in that case because it would be a lie: the
 *  words are already attached backwards, to photographs already filed, and
 *  telling a worker that the NEXT photographs will carry them too would
 *  promise a link this does not make.
 *
 *  The gate does not move. A note is read back and waits for a 1 exactly as
 *  any other typed update does, which is the 17 September rule and is not
 *  something being invited to comment buys a way around. */
export function draftReadBack(jobId: string, title: string, text: string, joinsBatch = false): string {
  const where = joinsBatch
    ? `Ready to go on ${jobId} (${title}), with the photos you just sent:`
    : `Ready to go on ${jobId} (${title}):`;
  const carry = joinsBatch ? "" : ` Photos you send next carry these words with them.`;
  return `${where}\n"${clip(text, 600)}"\n\n` +
    `Reply 1 to put it on the job. Send different words to replace it, or reply no to drop it. Nothing is filed until you reply 1.${carry}`;
}

export const DRAFT_STILL_WAITING = "Your update is still waiting. Reply 1 to put it on the job, send different words to replace it, or reply no to drop it.";

/** What a worker is told after anything goes on the job.
 *
 *  Founder, 29 September 2026: "a worker should never have to think what to
 *  do next, it should be clear." The confirmation used to end "The client
 *  hears about it once it is drafted", which names something that will
 *  happen and nothing the worker will see or do. This names both: what
 *  arrives, where, and the one reply that moves it on.
 *
 *  "In a few minutes" is the 90 second quiet timer plus a check that runs
 *  once a minute. No hour, no day, and nothing about the client's answer or
 *  about pay, which are not this message's to promise. */
export const WHAT_HAPPENS_NEXT =
  "Next: a draft of what the client will be told comes to you here in a few minutes. Reply 1 to send it, or send your own words instead. Nothing goes to the client until you do.";
