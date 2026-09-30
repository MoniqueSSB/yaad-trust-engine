import { assert } from "jsr:@std/assert@1";
import { applyLink, checkReminderText, WORKER_CLEARED_SUBJECT, workerClearedText } from "./worker-cleared.ts";

Deno.test("the cleared message is short lines, names the portal, and promises nothing", () => {
  const t = workerClearedText("Marcus Brown", "marcus@example.com", "https://app.yaadly.co.uk");
  assert(t.startsWith("You are cleared, Marcus."));
  assert(t.includes("https://app.yaadly.co.uk/portal/sign-in"), "the portal door is not named");
  assert(t.includes("marcus@example.com"), "which email to sign in with is not said");
  assert(/How you get paid:/.test(t) && /bank transfer within 7 days/.test(t) && /when the money is sent/.test(t), "when they are paid and what happens then is said at clearing");
  for (const line of t.split("\n")) assert(line.length <= 100, `long line: ${line}`);
  assert(/on the board in your portal/.test(t) && /sent here too/.test(t), "the board and the alerts are both named");
  assert(!/[–—]/.test(t) && !/[–—]/.test(WORKER_CLEARED_SUBJECT), "no dashes in worker copy");
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
