/* ── worker-reply.ts ──────────────────────────────────────────────────────
 *
 * Three small rules about a worker's own words, 30 Sep 2026, after a review
 * of every WhatsApp message a worker gets.
 *
 * 1. WHEN A CLIENT'S NOTE IS WAITING, WHICH WORDS ARE THE ANSWER TO IT.
 *    Until today any text at all from a worker whose job had a client note
 *    newest went straight to the client: "how do I share my location", a bare
 *    "ok", and ordinary site updates that should have been read back and
 *    confirmed with a 1 first. Now only words that read as an answer to the
 *    client go to them. A question, an acknowledgement or an update is left to
 *    the lanes that already handle those, and when it is unclear it is
 *    treated as an update, which is read back and waits for the worker's 1.
 *    Unclear goes the safe way: the read-back is a gate, a relay is not.
 *
 * 2. SCREEN THE SYSTEM'S WORDS, NOT THE WORKER'S QUOTE OF HIS OWN.
 *    twiml() screens every reply for banned words. A reply that quotes the
 *    worker back ("Ready to go on JOB-1: "wall 100% done"") failed the screen
 *    on HIS words and he got the holding reply, while the desk was told a
 *    client was waiting. systemWords() takes his quoted words out before the
 *    reply is screened. Words of his that go ON to a client are screened on
 *    their own, by own-words.ts, which is what that module is for.
 *
 * 3. A DATABASE REFUSAL, SAID IN PLAIN WORDS.
 *    The SQL functions a WhatsApp reply calls raise messages written for
 *    people ("That number is not the worker on this job."). Postgres itself
 *    raises messages that are not ("permission denied for function ..."), and
 *    both were shown word for word. plainRefusal() passes the first kind on
 *    and replaces the second with a plain sentence.
 *
 * Pure on purpose, so each rule is tested without a webhook.
 */

import { isBareAcknowledgement, looksLikeQuestion, wantsHelpWith } from "./worker-question.ts";
import { tooShortToBeAnUpdate } from "./update-draft.ts";

export type ReplyKind = "question" | "acknowledgement" | "reply" | "update";

/** Words that open an answer to somebody. "Yes I will fix it", "sorry about
 *  that", "I will come back Tuesday". Not "I did the first coat" or "it is
 *  done", which are how an update starts. */
const REPLY_OPENER =
  /^(?:yes|yeah|yea|sorry|soh?rry|sure|noted|understood|agreed|fair|true|will do|i will|i'?ll|i can|i could|mi wi|mi will|mi a go|me will|we will|we'?ll|no problem|not a problem|no worries|the reason|because|cause|thanks for|thank you for|ok,|okay,|ok i|okay i)\b/i;

/** Speaking to the client: you, your, and the Patois forms. */
const TO_THEM = /\b(?:you|your|yours|yuh|unu|yu)\b/i;

/** What a worker's message is, while a client's note on his job is waiting.
 *  `namesAnItem` is true when it names a photo code on the stage ("P2 is
 *  done now"), which is an answer to a point about that photo. */
export function readWhileNoteWaits(text: string, namesAnItem = false): ReplyKind {
  const t = String(text ?? "").trim();
  if (looksLikeQuestion(t) || wantsHelpWith(t)) return "question";
  if (!t || isBareAcknowledgement(t) || tooShortToBeAnUpdate(t)) return "acknowledgement";
  if (namesAnItem || TO_THEM.test(t) || REPLY_OPENER.test(t)) return "reply";
  return "update";
}

/** The reply with the worker's own quoted words taken out, for screening.
 *  Each quote may have been clipped by the reply that carries it (600, 599
 *  or 300 characters), so the clipped forms are tried too, longest first. */
export function systemWords(reply: string, own: unknown[]): string {
  let out = String(reply ?? "");
  for (const w of own) {
    const t = String(w ?? "").trim();
    if (!t) continue;
    for (const n of [t.length, 600, 599, 300, 299]) {
      const p = t.slice(0, n).trimEnd();
      if (p && out.includes(p)) { out = out.split(p).join(" "); break; }
    }
  }
  return out;
}

/** Postgres and the API layer, never a sentence written for a person. */
const INTERNAL =
  /\b(?:permission denied|violates|constraint|duplicate key|null value|syntax error|relation|column|schema|function|operator|jwt|pgrst|rpc|timeout|timed out|fetch failed|connection|internal|unexpected|undefined|invalid input|could not recover|could not extract)\b|_|%|\b[a-z]+\.[a-z]+\(|"public\./i;

export type Refusal = { text: string; internal: boolean };

/** What the person is told when a database call refuses. A message the SQL
 *  wrote for people is passed on with the next step after it. Anything else
 *  becomes a plain sentence, and `internal` tells the caller to log it and
 *  tell the desk. */
export function plainRefusal(message: unknown, next: string): Refusal {
  const m = String(message ?? "").replace(/\s+/g, " ").trim();
  const forPeople = /^[A-Z][^\n]{3,300}[.?!]$/.test(m) && !INTERNAL.test(m);
  if (forPeople) return { text: `${m} ${next}`.trim(), internal: false };
  return { text: `That did not go through at our end. ${next}`.trim(), internal: true };
}

/** A way out of the joining questions. "stop" or "cancel" ends it. */
const STOP_JOINING = /^(?:stop|cancel|quit|exit|end|leave it|forget it)[.!]*$/i;

export function wantsToStopJoining(text: string): boolean {
  return STOP_JOINING.test(String(text ?? "").trim());
}

/** The draft report, shown on the worker's first reply after it was only
 *  announced. 30 Sep 2026: outside WhatsApp's 24 hour window the draft cannot
 *  be sent as free text, so a template says one is waiting and asks for any
 *  reply. That reply used to be read as the answer to a draft nobody had
 *  seen: an "ok" got "Nothing sent", and real words went to the client as
 *  his own report. Now the first reply gets the draft itself, and the usual
 *  answers work from the next message. */
export function draftShownLate(jobId: string, draft: string): string {
  const d = String(draft ?? "").trim();
  const clipped = d.length > 1200 ? d.slice(0, 1199).trimEnd() + "…" : d;
  return [
    `Here is the draft report for the client on ${jobId}:`,
    `"${clipped}"`,
    ``,
    `Reply 1 to send it as written.`,
    `Or type your own words and those go instead.`,
    `Nothing goes to the client until you choose.`,
  ].join("\n");
}
