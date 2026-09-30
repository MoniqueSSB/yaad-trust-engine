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
    `1. Jobs in your trades and parishes come to you here.`,
    `2. Quote in writing. Always free.`,
    `3. Win a quote and we walk you through the job.`,
    ``,
    `Your portal: ${appUrl}/portal/sign-in`,
    `Sign in with ${email || "your email"}. A code comes to you.`,
    ``,
    `Any questions, just ask here.`,
  ].join("\n");
}

export const WORKER_CLEARED_SUBJECT = "You are cleared. Welcome to Yaadly.";
