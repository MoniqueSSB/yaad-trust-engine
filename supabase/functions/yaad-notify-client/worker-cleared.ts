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
  return [
    `You are cleared${first ? `, ${first}` : ""}. Welcome to Yaadly.`,
    ``,
    `What happens now:`,
    `1. Jobs are on the board in your portal. New jobs in your trades and parishes are sent here too.`,
    `2. Say your price in writing. It is free.`,
    `3. Win a job and we show you how it runs.`,
    ``,
    `Pay: bank transfer within 7 days of sign off. Never cash.`,
    ``,
    `Your portal: ${appUrl}/portal/sign-in`,
    `Log in with ${email || "your email"}. We send you a code.`,
    ``,
    `Questions? Ask here.`,
  ].join("\n");
}

export const WORKER_CLEARED_SUBJECT = "You are cleared. Welcome to Yaadly.";

/** The reminder to finish the check, 30 Sep 2026. Founder, on "nothing
 *  automatic reminds them": "yes fix this". Sent by remind_unfinished_
 *  applications() (20260930110000) at day 3 and day 10 after applying, to
 *  anybody not yet published, and never a third time. Says what is left and
 *  what it unlocks, and nothing about how the decision will go. The link is
 *  the same one the six questions hand out, built here because this
 *  function cannot import from yaad-inbound. */
export function checkReminderText(name: string, link: string, nth: number): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return [
    `Hi${first ? ` ${first}` : ""}, it is Yaadly.`,
    ``,
    nth >= 2 ? `Last reminder from us. Your check is still waiting.` : `Your check is still waiting.`,
    `Your ID. Your TRN. Three people who can vouch for you. Sign the Guidelines.`,
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
