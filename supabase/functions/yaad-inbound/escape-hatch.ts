/* ── escape-hatch.ts ──────────────────────────────────────────────────────
 *
 * Two ways out of a lane that has decided what your message is about.
 *
 * WHY. yaad-inbound is a series of lanes, and two of them are greedy on
 * purpose. If exactly one of a client's jobs is waiting on their review, any
 * message that is not a job code is filed as a comment on that job's evidence
 * and pushed to the worker's phone. If a worker's number has exactly one
 * active job, any text or voice note is filed into that job's evidence and
 * becomes the basis of a drafted report to the client.
 *
 * Both behaviours are right, and both were trapping people. A client whose
 * kitchen tap starts leaking while a roof job is mid review had no way to say
 * so: "the tap at my mother's place is leaking now" became a complaint about
 * the roof. A worker had no way to ask a question, flag a locked gate, or say
 * anything at all that was not evidence, and WhatsApp is a worker's entire
 * surface by design (CLAUDE.md section 9), which makes it worse rather than
 * better.
 *
 * So each greedy lane checks here first. Neither of these is a command
 * language and neither needs learning: they are the words somebody would use
 * anyway, and the replies that lead into those lanes now say so out loud.
 *
 * WHAT HAPPENS AFTER A MATCH is deliberately nothing clever. The message falls
 * through to the ordinary intake pipeline at the bottom of the function, which
 * already saves what they said, already pushes to Monique's phone, and already
 * hands the thread over when somebody asks for a person. Building a third path
 * would mean a second copy of all of that, free to drift from the first.
 */

/** "This is a different job." The client's way out of the comment lane.
 *
 *  Anchored on job, property, house, place or problem, so it cannot fire on
 *  an ordinary sentence about the work in hand. "The new tiles look good" is
 *  a comment on the evidence and must stay one. */
const FRESH_JOB =
  /\b(?:a\s+)?(?:new|another|different|second|separate|other)\s+(?:job|property|house|home|place|address|problem|issue|repair)\b|\bnothing to do with (?:this|that) (?:job|one)\b|\bdifferent (?:one|thing) altogether\b/i;

/** "Get me a person." Lifted out of index.ts so both sides can use it.
 *
 *  It was already the client's backstop under the model's own wants_human
 *  flag, for the evening a model call failed outright on "Can I talk to a real
 *  person please" and the person who asked got the generic opener instead. A
 *  worker had no equivalent at all, which is the asymmetry the Mirror Rule
 *  exists to catch: a way out that protects only one side is not finished. */
const A_PERSON =
  /\b(?:speak|talk|chat|deal)\s+(?:to|with)\s+(?:a\s+|an\s+)?(?:real\s+|actual\s+|live\s+)?(?:person|human|someone|somebody|monique|agent|operator)\b|\b(?:real|actual|live)\s+(?:person|human)\b|\b(?:are you|is this) a (?:bot|robot|machine)\b/i;

export function wantsFreshJob(text: string): boolean {
  return FRESH_JOB.test(String(text ?? ""));
}

export function wantsAPerson(text: string): boolean {
  return A_PERSON.test(String(text ?? ""));
}

/** Should a greedy lane let this message past instead of filing it?
 *  True means: this is not what the lane assumed, hand it to the pipeline. */
export function shouldEscapeLane(text: string): boolean {
  return wantsFreshJob(text) || wantsAPerson(text);
}
