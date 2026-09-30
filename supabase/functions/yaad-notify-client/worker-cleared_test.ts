import { assert } from "jsr:@std/assert@1";
import { WORKER_CLEARED_SUBJECT, workerClearedText } from "./worker-cleared.ts";

Deno.test("the cleared message is short lines, names the portal, and promises nothing", () => {
  const t = workerClearedText("Marcus Brown", "marcus@example.com", "https://app.yaadly.co.uk");
  assert(t.startsWith("You are cleared, Marcus."));
  assert(t.includes("https://app.yaadly.co.uk/portal/sign-in"), "the portal door is not named");
  assert(t.includes("marcus@example.com"), "which email to sign in with is not said");
  for (const line of t.split("\n")) assert(line.length <= 80, `long line: ${line}`);
  assert(!/[–—]/.test(t) && !/[–—]/.test(WORKER_CLEARED_SUBJECT), "no dashes in worker copy");
  assert(!/guarantee|100%|escrow|you will get|within \d+ (days|hours)|today|tomorrow/i.test(t), t);
  assert(workerClearedText("", "", "https://app.yaadly.co.uk").includes("Sign in with your email"));
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
