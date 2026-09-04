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

export function matchApprovingJob(text: string, jobs: ApprovableJob[]): ApprovableJob | null {
  const said = text.trim().toLowerCase();
  if (!said) return null;
  const hits = jobs.filter((j) => said.includes(j.id.toLowerCase()));
  return hits.length === 1 ? hits[0] : null;
}

/* ── the Approve button on the out-of-window template ─────────────────────
 *
 * A client who has not messaged in 24 hours cannot be sent free text, so
 * the evidence report reaches them as an approved WhatsApp Content
 * Template instead, carrying one quick-reply button. WhatsApp hands that
 * button back as ButtonPayload, a value fixed when Meta approved the
 * template, so unlike the free-text reply above it cannot carry the job's
 * own code. (Twilio's webhook also carries OriginalRepliedMessageSid on
 * WhatsApp, which could one day tie a tap to the exact outbound message
 * and therefore to the exact job. It would need a table mapping message
 * sids to jobs, which does not exist, so it is not what this relies on.)
 *
 * That is exactly the ambiguity matchApprovingJob() exists to refuse, and
 * approving the wrong stage is not a cosmetic error: approve_stage() fires
 * raise_worker_pay_invoice_on_stage_approval, so a wrong guess raises a
 * real payable against the wrong worker. So this never guesses either. It
 * approves only when the client has exactly ONE job waiting on their
 * review, which is the ordinary case; with more than one it asks which,
 * and the answer comes back through matchApprovingJob() as an exact code
 * like every other approval always has. The tap saves the typing in the
 * common case and changes nothing about who decides.
 */

/** The `id` set on the template's Approve button, matched exactly. Change
 *  this and the approved template has to change with it, so it does not
 *  live in an environment variable: a typo in a secret would read as an
 *  ordinary message rather than as a broken button. */
export const APPROVE_BUTTON_PAYLOAD = "yaadly_approve_stage";

export type ButtonApproval =
  | { outcome: "approve"; job: ApprovableJob }
  | { outcome: "ask_which"; jobs: ApprovableJob[] }
  | { outcome: "nothing_waiting" }
  | { outcome: "not_ours" };

/** `jobs` is already narrowed to the jobs THIS client has awaiting review.
 *  Anything that is not our own button payload returns "not_ours" and the
 *  message carries on down the ordinary pipeline untouched. */
export function matchApprovingButton(payload: string, jobs: ApprovableJob[]): ButtonApproval {
  if (payload.trim().toLowerCase() !== APPROVE_BUTTON_PAYLOAD) return { outcome: "not_ours" };
  if (jobs.length === 0) return { outcome: "nothing_waiting" };
  if (jobs.length > 1) return { outcome: "ask_which", jobs };
  return { outcome: "approve", job: jobs[0] };
}
