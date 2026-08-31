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
