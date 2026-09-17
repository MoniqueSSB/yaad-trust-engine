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

export type DraftReply = "file" | "discard" | "keep" | "replace";

const DISCARD = /^(?:no|nah|nope|cancel|delete|drop it|don'?t|do not|stop|scrap it|leave it)[.!]*$/i;

/** Not an update on its own, whether or not a draft is waiting: a lone
 *  character, a number, punctuation. "1" arriving after a report prompt has
 *  already closed was filed as evidence on 15 September 2026. */
export function tooShortToBeAnUpdate(text: string): boolean {
  const t = String(text ?? "").trim();
  return t.length <= 1 || /^[\d\W]+$/.test(t);
}

/** What a plain text reply means while an update is waiting.
 *  Questions are not decided here: the caller answers them first and keeps
 *  the draft, the same order every other worker lane uses. */
export function readDraftReply(text: string, isAcknowledgement: (t: string) => boolean): DraftReply {
  const t = String(text ?? "").trim();
  if (t === "1") return "file";
  if (DISCARD.test(t)) return "discard";
  if (tooShortToBeAnUpdate(t) || isAcknowledgement(t)) return "keep";
  return "replace";
}

function clip(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

/** The read-back. Says the whole of what would be filed, where, and the one
 *  reply that files it. */
export function draftReadBack(jobId: string, title: string, text: string): string {
  return `Ready to go on ${jobId} (${title}):\n"${clip(text, 600)}"\n\n` +
    `Reply 1 to put it on the job. Send different words to replace it, or reply no to drop it. Nothing is filed until you reply 1. ` +
    `Photos you send next carry these words with them.`;
}

export const DRAFT_STILL_WAITING = "Your update is still waiting. Reply 1 to put it on the job, send different words to replace it, or reply no to drop it.";
