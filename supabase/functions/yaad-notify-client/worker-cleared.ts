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

/** Somebody opened an application, maybe uploaded documents, and never
 *  reached Send (25 Oct 2026). Sent once, 48 hours on. It names what to do
 *  and promises nothing. No link with a token: the first sitting lives in
 *  the browser it was started in, and a token link would open the second
 *  sitting instead, which they have not earned yet. Same phone, same page. */
export function sendReminderText(name: string, appUrl: string): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  const url = new URL("/apply", appUrl).toString();
  return [
    `Hi${first ? ` ${first}` : ""}, it is Yaadly.`,
    ``,
    `You started an application with us and it was never sent.`,
    `If that was our form going wrong, sorry. It is working now.`,
    `Open this on the same phone and it picks up where you left off:`,
    url,
    `Then tap Send my application.`,
    ``,
    `Nothing you entered is lost. If you have changed your mind, ignore this.`,
    `Questions? Ask here.`,
  ].join("\n");
}

export const SEND_REMINDER_SUBJECT = "Your Yaadly application was not sent";

/** The link that opens an application on the site, carrying the same claim
 *  the site keeps in its own storage: the application id and its upload
 *  token (JoinFlow.tsx reads them off the address bar and cleans it).
 *
 *  `phase`, added 25 Oct 2026 for "Continue on another device". Without it
 *  the page opens the second sitting (the check), which is right for an
 *  application that has been sent. An application still `started` has never
 *  sent Phase 1, so its link carries phase=1 and the page reopens at "Your
 *  trades" with the claim attached, and the Send button lands on the row that
 *  already exists rather than opening a second one. The check reminder never
 *  passes a phase: it is only ever sent to a received application. */
export function applyLink(appUrl: string, applicationId: string, uploadToken: string, reference: string, phase?: 1 | 2): string {
  const u = new URL("/apply", appUrl);
  u.searchParams.set("app", applicationId);
  u.searchParams.set("token", uploadToken);
  u.searchParams.set("ref", reference);
  if (phase === 1) u.searchParams.set("phase", "1");
  return u.toString();
}

/** Which sitting a "Continue on another device" link reopens, or null when
 *  there is nothing for the applicant to come back to. The one place this is
 *  decided: yaad-apply-link hands every real reference here and this rules.
 *
 *  `started` is Phase 1 never sent. `received` is sent and waiting on the
 *  check. Until 25 Oct 2026 that was the whole list, and it stranded APP-DFDA56:
 *  passed at the desk before the ID check was ever started, with no TRN and no
 *  signature, so the publish gate (20260830c) could never let the profile out,
 *  the portal would not open an account without one, and the link refused
 *  because the row no longer read received. Founder: "yes do it".
 *
 *  So `passed` and `gap` also get the check back, but only while the
 *  applicant still owes a piece of it themselves: the ID check not approved,
 *  no TRN typed (or one the desk rejected), or the guidelines not signed. A
 *  TRN that is `pending` is the desk's to check, not theirs to redo. Blocked
 *  and test rows never get a link. Sending the check sets the row back to
 *  received (yaad-vetting-upload, submit), so it comes back to the desk to be
 *  decided again with the ID in front of a person. Nothing here passes,
 *  publishes or decides anything. */
export function applyLinkPhase(app: {
  status?: unknown; persona_status?: unknown; trn_status?: unknown; signed_at?: unknown;
}): 1 | 2 | null {
  const status = String(app.status ?? "");
  if (status === "started") return 1;
  if (status === "received") return 2;
  if (status !== "passed" && status !== "gap") return null;
  const idDone = ["approved", "completed"].includes(String(app.persona_status ?? ""));
  const trnDone = ["pending", "approved"].includes(String(app.trn_status ?? ""));
  const signed = Boolean(app.signed_at);
  return idDone && trnDone && signed ? null : 2;
}

/** The message that carries the link when the applicant asked for it from
 *  the box on /apply (yaad-apply-link, 25 Oct 2026). It says what the link
 *  is, which application it opens, and that it is theirs alone. It says
 *  nothing about how the application is going, because this is sent to
 *  whoever typed the reference's contact details in, and the only thing it
 *  may reveal is what the applicant already has: a way back in. */
export function applyLinkText(name: string, reference: string, link: string, phase: 1 | 2): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return [
    `Hi${first ? ` ${first}` : ""}, it is Yaadly.`,
    ``,
    phase === 1
      ? `Here is your link to carry on with your application ${reference}:`
      : `Here is your link to carry on with your check for ${reference}:`,
    link,
    ``,
    `It opens your application on whichever phone or computer you tap it on.`,
    `It is yours alone. Do not forward it.`,
    `If you did not ask for this, ignore it. Nothing changes.`,
  ].join("\n");
}

export const APPLY_LINK_SUBJECT = "Your Yaadly application link";

/** The worker's side of job_delayed, 30 Sep 2026. The client is told the job
 *  has gone quiet and that the worker has been checked in with; this is that
 *  check-in. Supportive, not a warning, and it says what happens next: a reply
 *  reaches a person. */
export function jobDelayedWorkerText(jobId: string, title: string): string {
  return `${jobId}${title ? ` (${title})` : ""}: the client has been told the job is running late. Is anything holding you up? Reply here and a person will help.`;
}

/** What a worker is told the moment a person at the desk passes them,
 *  25 Oct 2026. Until then Pass sent nothing: the desk recorded the decision
 *  and the worker heard nothing until the profile was published, which can be
 *  days later and waits on an ID check and a TRN they may not know are
 *  outstanding. Founder: "when i press pass does an email go to them". No.
 *  Now it does, by WhatsApp or text and by email. It promises no work, no
 *  dates, and does not say the profile is live, because it is not yet. */
export function workerPassedText(name: string): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return [
    `Good news${first ? `, ${first}` : ""}. It is Yaadly.`,
    ``,
    `A person has checked your application and you are through.`,
    `Your profile is being set up now. You will hear on this number when it is live and you can quote.`,
    ``,
    `If anything is still needed from you, Monique will message you here to say what.`,
    `Questions? Reply here.`,
  ].join("\n");
}

export const WORKER_PASSED_SUBJECT = "You are through. Yaadly is setting up your profile.";
