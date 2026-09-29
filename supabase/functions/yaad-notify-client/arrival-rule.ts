/* ── arrival-rule.ts ──────────────────────────────────────────────────────
 *
 * Which jobs a daily check-in is asked for.
 *
 * Founder, 29 September 2026: "This arrival log is only for jobs where the
 * client is not on site so make that rule."
 *
 * The Arrival Log exists because most clients cannot see the property. It
 * stands in for the person who would otherwise have opened the door and seen
 * the worker walk in. Where somebody is at home day to day, that person is
 * the record of who turned up, and asking the worker to prove it with a pin
 * is a step with nothing behind it.
 *
 * WHAT IT READS. jobs.access_type, the answer to "who can let a worker in"
 * on the job form (web/lib/jobs/new-form.ts). Only the first of its four
 * answers says somebody is at the property every day. A key held by a
 * neighbour, outside work only, and "still to be arranged" all leave nobody
 * watching, and so does a caretaker, who opens up and is not the client.
 *
 * WHAT IT CANNOT KNOW, said plainly. The form asks who is at the house. It
 * does not ask whether that person is the client. A mother at home in
 * Portmore while her daughter pays from London reads here as somebody at
 * home, and the check-in is not asked for. If that case should be asked, the
 * form needs its own question; guessing it from this one would be inventing
 * an answer nobody gave.
 *
 * Not said at all means asked. The safe reading of a blank is that nobody
 * is there.
 *
 * Shared, because two functions must agree: yaad-inbound asks for the
 * check-in, and yaad-notify-client reports a missing one on the evidence
 * check. One asking and the other not would tell a worker two things.
 */

const SOMEBODY_AT_HOME = /\b(?:lives there|at home)\b/i;

export function checkInApplies(accessType: unknown): boolean {
  return !SOMEBODY_AT_HOME.test(String(accessType ?? ""));
}
