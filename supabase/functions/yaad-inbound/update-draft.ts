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
  // One thing a line, 29 Sep 2026. Founder: "it is a whole paragraph", "the
  // sentences cant be long". The words and the gate are the same as before.
  const carry = joinsBatch ? "" : `\nPhotos you send next carry these words.`;
  return `${where}\n"${clip(text, 600)}"\n\n` +
    `Reply 1: put it on the job.\nReply no: drop it.\nOr send new words.\n\n` +
    `Nothing is filed until you reply 1.${carry}`;
}

export const DRAFT_STILL_WAITING = "Your update is still waiting.\n\nReply 1: put it on the job.\nReply no: drop it.\nOr send new words.";

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
  // One thing at a time, founder 30 Sep 2026: "two things are being asked
  // at once". How to answer the draft is said by the draft when it arrives.
  "Next: a draft for the client comes here in a few minutes.\nNothing goes to the client until you say so.";

/** The two buttons under the read-back, 29 Sep 2026. See content.ts in
 *  yaad-twilio-setup, which holds the ids these are read against.
 *
 *  A tap arrives as text, the button's id and the job's code. It is turned
 *  into the reply a worker would have typed, "1" or "no", and goes through
 *  readDraftReply() like any other. Nothing here files anything. */
export type UpdateTap = { kind: "file" | "drop" | "change"; jobId: string };

export function readUpdateTap(text: unknown): UpdateTap | null {
  const m = /^(UPDATEFILE|UPDATEDROP|UPDATECHANGE)\s+(\S+)$/i.exec(String(text ?? "").trim());
  if (!m) return null;
  const kinds: Record<string, UpdateTap["kind"]> = { UPDATEFILE: "file", UPDATEDROP: "drop", UPDATECHANGE: "change" };
  return { kind: kinds[m[1].toUpperCase()], jobId: m[2] };
}

/** Whether a tap belongs to the update that is actually waiting. */
export function tapMatchesUpdate(tap: UpdateTap, waitingJobId: unknown): boolean {
  const w = String(waitingJobId ?? "").trim();
  return w !== "" && w.toLowerCase() === tap.jobId.toLowerCase();
}

/** What the tap stands for, as typed. Change my words stands for nothing
 *  typed: it asks for the new words and the update stays waiting, so the
 *  caller answers it before this is reached. */
export function tapAsTyped(tap: UpdateTap): string {
  return tap.kind === "file" ? "1" : tap.kind === "drop" ? "no" : "";
}

export const TYPE_YOUR_NEW_WORDS = "Type your new words here.\nThey replace this update.";

/** One line, bounded, never empty: what a template variable has to be. */
export function oneLine(s: unknown, max: number): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "-";
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/** The variables for the read-back with buttons. Says the same things the
 *  typed read-back says: which job, the words, and where photographs stand. */
export function readBackVars(jobId: string, title: string, text: string, joinsBatch = false): Record<string, string> {
  return {
    "1": oneLine(`${jobId} (${title})`, 120),
    "2": oneLine(text, 600),
    "3": joinsBatch
      ? "These go with the photos you just sent."
      : "Photos you send next carry these words.",
    "4": jobId,
  };
}
