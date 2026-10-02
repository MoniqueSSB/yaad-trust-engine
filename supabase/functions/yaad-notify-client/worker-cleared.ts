// What a worker is told the moment a person at the desk publishes them.
//
// Until 30 Sep 2026 nothing was sent. The thank you screen on the site said
// they would hear back, the desk published them, and the next thing they
// heard was a job, if they had joined the alert list, or nothing. Founder:
// "Nothing tells them they are cleared", "fix this all".
//
// Fired by trg_worker_cleared on worker_profiles (20260930100000) when
// `active` flips to true, which only happens after trg_profile_publish_checks
// has let it: the ID check approved, the TRN approved, an email on file. So
// this message is only ever true. It names the portal, because nothing on
// the joining path did, and says what happens now in short lines. It promises
// no work and no dates.

export function workerClearedText(name: string, email: string, appUrl: string): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  // One phone screen, founder 30 Sep 2026.
  return [
    `You are cleared${first ? `, ${first}` : ""}. Welcome to Yaadly.`,
    ``,
    `Jobs are on the board: ${appUrl}/portal/sign-in`,
    `Log in with ${email || "your email"}. We send you a code.`,
    ``,
    `Pay: bank transfer within 7 days of sign off. Never cash.`,
    ``,
    // An invitation, never an alert: new jobs only come on WhatsApp to
    // somebody who asked (the ALERTS lane records their consent). Founder,
    // 30 Sep 2026, "fix these also": published workers were never told the
    // list existed, and sending to them without asking is not ours to do.
    `Want new jobs sent here? Reply ALERTS.`,
  ].join("\n");
}

export const WORKER_CLEARED_SUBJECT = "You are cleared. Welcome to Yaadly.";

/** The reminder to finish the check, 30 Sep 2026. Founder, on "nothing
 *  automatic reminds them": "yes fix this". Sent by remind_unfinished_
 *  applications() (20260930110000) at day 3 and day 10 after applying, to
 *  anybody not yet published, and never a third time. Says what is left and
 *  what it unlocks, and nothing about how the decision will go. The link is
 *  the same one the six questions hand out, built here because this
 *  function cannot import from yaad-inbound. Referees are optional, founder
 *  2 Oct 2026: without them, a video of the worker talking through their
 *  skills. */
export function checkReminderText(name: string, link: string, nth: number): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return [
    `Hi${first ? ` ${first}` : ""}, it is Yaadly.`,
    ``,
    nth >= 2 ? `Last reminder from us. Your check is still waiting.` : `Your check is still waiting.`,
    `Your ID. Your TRN. Sign the Guidelines.`,
    `Three people who can vouch for you are optional.`,
    `Without them, a short video of you talking through your skills gets you on the board.`,
    `Referees are still needed before jobs over £500.`,
    `About ten minutes, on your phone:`,
    link,
    ``,
    `Until it is done you cannot quote on jobs.`,
    `Questions? Ask here.`,
  ].join("\n");
}

export const CHECK_REMINDER_SUBJECT = "Your Yaadly check is waiting";

export function applyLink(appUrl: string, applicationId: string, uploadToken: string, reference: string): string {
  const u = new URL("/apply", appUrl);
  u.searchParams.set("app", applicationId);
  u.searchParams.set("token", uploadToken);
  u.searchParams.set("ref", reference);
  return u.toString();
}

/** The worker's side of job_delayed, 30 Sep 2026. The client is told the job
 *  has gone quiet and that the worker has been checked in with; this is that
 *  check-in. Supportive, not a warning, and it says what happens next: a reply
 *  reaches a person. */
export function jobDelayedWorkerText(jobId: string, title: string): string {
  return `${jobId}${title ? ` (${title})` : ""}: the client has been told the job is running late. Is anything holding you up? Reply here and a person will help.`;
}
