import { assert } from "jsr:@std/assert@1";
import { applyLink, checkReminderText, WORKER_CLEARED_SUBJECT, workerClearedText } from "./worker-cleared.ts";

Deno.test("the cleared message fits one phone screen, names the board and the pay, and promises nothing", () => {
  const t = workerClearedText("Marcus Brown", "marcus@example.com", "https://app.yaadly.co.uk");
  assert(t.startsWith("You are cleared, Marcus."));
  assert(t.includes("https://app.yaadly.co.uk/portal/sign-in"), "the board is not linked");
  assert(t.includes("marcus@example.com"), "which email to sign in with is not said");
  // No alert promise until the send is wired: the list fills and nothing goes out (job-alerts.ts).
  assert(!/come here too|are sent here/.test(t), "the message must not promise alerts that are not sent");
  assert(/^Pay: /m.test(t) && /bank transfer within 7 days/.test(t), "how pay works is not said");
  assert(t.split("\n").length <= 8, "one phone screen");
  for (const line of t.split("\n")) assert(line.length <= 80, `long line: ${line}`);
  assert(!/[\u2013\u2014]/.test(t) && !/[\u2013\u2014]/.test(WORKER_CLEARED_SUBJECT), "no dashes in worker copy");
  assert(!/guarantee|100%|escrow|you will get|today|tomorrow/i.test(t), t);
  assert(workerClearedText("", "", "https://app.yaadly.co.uk").includes("Log in with your email"));
});

Deno.test("the kind exists, is fired only on publish, and never loads a job", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(src.includes('"worker_cleared"'), "worker_cleared is not a kind");
  const at = src.indexOf('kind === "worker_cleared"');
  const jobLoad = src.indexOf('.select("id, title, parish, stage, status, portal_code, client_email, client_phone, worker_email")');
  assert(at > 0 && at < jobLoad, "worker_cleared must be answered before the job is loaded, it has none");
  const mig = await Deno.readTextFile(new URL("../../migrations/20260930100000_the_worker_hears_when_they_are_cleared.sql", import.meta.url));
  assert(mig.includes("new.active is true") && mig.includes("old.active is distinct from new.active"), "the trigger must fire only when active flips on");
  assert(mig.includes("'kind', 'worker_cleared'") && mig.includes("'workerEmail', new.worker_email"), "the trigger must send the kind and the email");
  assert(mig.includes("after update on public.worker_profiles"), "it must run after the publish gate, never before it");
});

Deno.test("the check reminder says what is left, twice at most, and promises nothing", async () => {
  const link = applyLink("https://app.yaadly.co.uk", "11111111-2222-3333-4444-555555555555", "aaaa", "APP-ABC123");
  const first = checkReminderText("Marcus Brown", link, 1);
  const second = checkReminderText("Marcus Brown", link, 2);
  for (const t of [first, second]) {
    assert(t.includes(link) && t.includes("cannot quote"), t);
    for (const line of t.split("\n")) assert(line.length <= 110, `long line: ${line}`);
    assert(!/[–—]/.test(t), "no dashes");
    assert(!/approved|accepted|guarantee|you will get|deadline|removed|deleted/i.test(t), t);
  }
  assert(second.includes("Last reminder"), "the second must say it is the last");
  const mig = await Deno.readTextFile(new URL("../../migrations/20260930110000_a_worker_is_reminded_to_finish_the_check.sql", import.meta.url));
  assert(mig.includes("check_reminders < 2"), "never a third reminder");
  assert(mig.includes("interval '3 days'") && mig.includes("interval '7 days'"), "day 3, then a week later");
  assert(mig.includes("'kind', 'worker_check_reminder'"));
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(src.includes('"worker_check_reminder"'), "worker_check_reminder is not a kind");
});

Deno.test("the job delayed check-in is short, supportive and says a person answers", async () => {
  const { jobDelayedWorkerText } = await import("./worker-cleared.ts");
  const t = jobDelayedWorkerText("JOB-7", "");
  assert(t.startsWith("JOB-7: "), t);
  assert(t.length <= 160, "one short message");
  assert(!/[\u2013\u2014]/.test(t) && !/guarantee|escrow|100%|held/i.test(t), t);
});
