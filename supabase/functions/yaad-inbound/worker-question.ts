/* ── worker-question.ts ───────────────────────────────────────────────────
 *
 * A worker asking a question, at a moment the assistant was waiting for
 * something else.
 *
 * WHY. Four of the worker prompts are greedy by design: "reply 1 to send this
 * report or send your own words", "what does this show?", "which section is
 * this?", and the plain update lane that files whatever a worker on one live
 * job says. Each one has a right answer and treats every other reply as a
 * version of that answer. On 15 September 2026 the founder, testing as the
 * worker, answered the report prompt with "how do i share my location" and
 * the assistant sent that sentence to the client as her status report. A
 * worker will always have questions mid-job, about the app and about the job,
 * and a question is never a report and never evidence.
 *
 * WHAT THIS DOES. Recognises a question, answers the handful the app can
 * answer itself (how to share a location, how to send a video), and leaves
 * everything else for a person. The prompt that was waiting stays waiting:
 * the session is kept, nothing is sent, nothing is filed, and the reply says
 * so and repeats what is still wanted.
 *
 * WHAT IT DOES NOT DO. It never routes a question to a model. The canned
 * answers are fixed strings about WhatsApp itself; a question about the job,
 * the money or the client goes to the desk as a high-priority note and is
 * answered by a named human. It also never hands the thread over: holding a
 * number silences every worker lane on it (see the human_handling branch in
 * index.ts), which is the wrong price for asking how to send a video.
 *
 * THE NEGATIVE HALF MATTERS MOST. "was able to complete stage one but have
 * some issues" is a report. "done" is a report. "A" is a section answer.
 * "1" is an acceptance. None of these may read as a question, or a worker's
 * real update quietly stops reaching the client.
 */

/** Does this read as a question rather than an answer or an update?
 *
 *  A trailing question mark, or an opening question word, in English or the
 *  Patois forms a worker on WhatsApp actually types ("weh", "wha", "how mi",
 *  "can mi"). Anchored at the start so "done, how does it look" is not
 *  caught while "how does it look, done" is; the first word is what a person
 *  leads with when they are asking. Single letters and digits never match,
 *  because those are the answers the section and report prompts ask for.
 *
 *  An auxiliary verb (can, do, is, was, will...) only counts when a subject
 *  follows it. "Can I send it tomorrow" asks; "was able to complete stage
 *  one" reports, and it was the first real update this file was tested
 *  against. */
const QUESTION_WORD =
  /^(?:how|what|wha|whe|weh|where|when|why|which|who|whose|any idea|anybody know|anyone know|ah wha|a wha|mi (?:can|fi)|me (?:can|fi))\b/i;
const PRONOUN = "i|mi|me|we|you|yuh|unu|it|this|that|there|he|she|they|him|her|anyone|anybody|someone|somebody";
const AUXILIARY_THEN_SUBJECT = new RegExp(
  "^(?:can|could|do|does|is|are|am|should|would|will|shall|may|might)\\s+(?:" + PRONOUN + "|the|di|dis|dat|dem|my|mi own|our|your)\\b" +
  // Past and perfect forms take only a pronoun. "Is the client happy" asks;
  // "did the first coat today" and "have the receipt" report.
  "|^(?:did|was|were|have|has)\\s+(?:" + PRONOUN + ")\\b",
  "i",
);

export function looksLikeQuestion(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (/^[a-z0-9]$/i.test(t)) return false;
  if (/\?\s*$/.test(t)) return true;
  // "How mi share location" and "how do i share location" both start with
  // a question word; "how it went: fine" does not read as one, but a worker
  // who typed it wanted it as an update and a colon marks it as one.
  if (/:/.test(t)) return false;
  return QUESTION_WORD.test(t) || AUXILIARY_THEN_SUBJECT.test(t);
}

/** The answers the app can give itself, about WhatsApp, not about the job.
 *
 *  Fixed strings, deliberately: a worker asking how to send a clip must get
 *  the same instructions every time, and nothing here is a fact about a job,
 *  a price or a payment. Null means "not one the app answers", and the caller
 *  puts it in front of a person. */
export function answerWorkerQuestion(text: string): string | null {
  const t = String(text ?? "").toLowerCase();
  if (/\b(?:location|locashun|where i am|where mi deh|pin|gps|my position)\b/.test(t)) {
    return "To share your location on WhatsApp: tap the plus sign (or the paperclip) next to the message box, choose Location, then Send your current location. It goes on the Arrival Log for this job. Nothing waits on it.";
  }
  if (/\b(?:video|clip|record|recording|walk ?through|walkthrough)\b/.test(t)) {
    return "To send a video: tap the camera or the plus sign next to the message box and record a short clip, or pick one from your gallery. Under about a minute sends fine on WhatsApp. For anything longer, ask for the portal link and upload it there.";
  }
  return null;
}
