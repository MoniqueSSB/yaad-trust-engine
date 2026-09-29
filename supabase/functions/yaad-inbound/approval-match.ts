/* ── approval-match.ts ────────────────────────────────────────────────────
 *
 * Pulled out of index.ts for the same reason job-match.ts and
 * twilio-signature.ts were: a permanent test needs to run this without
 * starting index.ts's own live server.
 *
 * Deliberately narrower than job-match.ts's pickJobChoice(): no ordinal
 * number, no title guess. Those are safe conveniences inside a session
 * that is already known to be a worker mid "which job" answer; a client's
 * WhatsApp approval reply has no such session; every plain text message a
 * client ever sends passes through this check, so only an exact match on
 * the job's own code, the one thing that cannot appear in ordinary
 * conversation by coincidence, is trusted. A stray "1" in an unrelated
 * sentence must never approve anything.
 */

export type ApprovableJob = { id: string; title: string; stage: number };

/** The only words that may sit beside the code in a message that approves.
 *
 *  29 September 2026. Until then the match was `said.includes(code)`, so the
 *  code anywhere in a message was consent. "don't approve JOB-WEB-1 yet, the
 *  crack is back" approved the stage and raised the worker's pay. The header
 *  above calls the code "the one thing that cannot appear in ordinary
 *  conversation by coincidence", and that is true of a stranger. It is not
 *  true of a client, who was sent the code in the message they are replying
 *  to and will quote it back when they are unhappy.
 *
 *  So the code is necessary and no longer enough. Everything else in the
 *  message has to be a word of agreement or a courtesy. One word outside this
 *  list, "not", "yet", "but", "when", anything about the work, and nothing is
 *  approved: the message is read as what it is, something the client wanted
 *  to say.
 *
 *  An allowlist and never a blocklist of negatives. A list of ways to say no
 *  is never finished, in English or in Patois, and the one that was missed
 *  moves money. */
const AGREES = new Set([
  "yes", "yeah", "yep", "ya", "yah", "ok", "okay", "k", "sure", "fine", "great", "good", "perfect", "lovely", "nice",
  "approve", "approved", "approving", "accept", "accepted", "confirm", "confirmed", "agree", "agreed", "book", "booked", "sign", "signed",
  "i", "we", "it", "this", "that", "the", "a", "is", "am", "are", "all", "my", "me", "job", "stage", "work", "code", "here", "for", "to", "with",
  "happy", "satisfied", "pleased", "go", "ahead", "please", "pls", "thanks", "thank", "you", "thx", "cheers", "bless", "respect",
  "looks", "look", "very", "so", "and", "done", "reply",
]);

/** True when the message is the code and, at most, words of agreement. */
export function isCleanApproval(text: string, jobId: string): boolean {
  const said = String(text ?? "").trim().toLowerCase();
  const code = jobId.toLowerCase();
  if (!said.includes(code)) return false;
  const rest = said.split(code).join(" ");
  // A question mark is a question, whatever the words around it are.
  if (rest.includes("?")) return false;
  const words = rest.split(/[^a-z0-9']+/).filter(Boolean);
  return words.every((w) => AGREES.has(w));
}

export function matchApprovingJob(text: string, jobs: ApprovableJob[]): ApprovableJob | null {
  const said = text.trim().toLowerCase();
  if (!said) return null;
  const hits = jobs.filter((j) => said.includes(j.id.toLowerCase()));
  if (hits.length !== 1) return null;
  return isCleanApproval(said, hits[0].id) ? hits[0] : null;
}

/** The job a message names WITHOUT approving it: the code is there, and so
 *  is something that is not agreement. The caller says plainly that nothing
 *  was approved, because a client who quoted the code may believe it was. */
export function namesWithoutApproving(text: string, jobs: ApprovableJob[]): ApprovableJob | null {
  const said = String(text ?? "").trim().toLowerCase();
  if (!said) return null;
  const hits = jobs.filter((j) => said.includes(j.id.toLowerCase()));
  if (hits.length !== 1) return null;
  return isCleanApproval(said, hits[0].id) ? null : hits[0];
}
