// Worker WhatsApp fixes, 30 Sep 2026 ("fix the issues", after the review of
// every worker message). Read against the source, because the send path is
// one long handler that cannot be run without Twilio and a database.
//
// Run: deno test --allow-read --allow-env supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { hasWorkerTemplateDecision, workerTemplateSummary } from "./worker-template.ts";
import { jobDelayedWorkerText } from "./worker-cleared.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const branch = (kind: string) => {
  const at = src.indexOf(`} else if (kind === "${kind}") {`);
  assert(at > 0, `${kind} branch is gone`);
  const next = src.indexOf("} else if (kind ===", at + 10);
  return src.slice(at, next > 0 ? next : at + 4000);
};

Deno.test("follow-ups go after any first message sent as WhatsApp free text, not only the draft", () => {
  const at = src.indexOf("for (const more of waFollowUps)");
  const gate = src.slice(src.lastIndexOf("if (", at), at);
  assert(!gate.includes("waLine"), "the bank details ask is dead again: follow-ups gated on waLine");
  assert(gate.includes("!firstTemplate") && gate.includes('wa.via === "twilio whatsapp"'), "follow-ups must only follow a free text WhatsApp send");
  // The draft still travels alone as the first message.
  assert(src.includes("waLine || line"), "the draft is no longer the first message on its own");
});

Deno.test("a bank details ask WhatsApp could not carry goes by email and shows as not sent", () => {
  assert(src.includes("if (bankAsk && !bankAskSent)"), "the bank ask has no fallback when a template went first");
  for (const k of ["booked_worker", "stage_released_worker", "stage_signed_off_worker"]) {
    assert(branch(k).includes("bankAsk = bankDetailsAsk("), `${k} no longer asks for bank details`);
  }
});

Deno.test("a stage signed off tells the worker, after the approval, and moves nothing", () => {
  assert(src.includes('"stage_signed_off_worker"'), "not a kind");
  assert(hasWorkerTemplateDecision("stage_signed_off_worker"));
  const b = branch("stage_signed_off_worker");
  assert(b.includes('from("stage_approvals")'), "must read the recorded approval, never assume one");
  assert(b.includes('job.status === "complete"'), "the last stage is stage_released_worker's to say");
  assert(/within 7 days/.test(b) && /bank transfer/.test(b) && /Never cash/.test(b), "must say how and when pay comes");
  assert(/Do not start it yet/.test(b), "a by-stage job must not be told to start an unpaid stage");
  assert(!/\.rpc\(|\.update\(|\.insert\(/.test(b), "a notice must never write anything");
  const summary = workerTemplateSummary("stage_signed_off_worker")!;
  assert(!/[\u2013\u2014]/.test(summary) && !/\.$/.test(summary), summary);
});

Deno.test("signed off no longer counts materials twice and says the 7 days", () => {
  const b = branch("stage_released_worker").replace(/\/\/.*$/gm, "");
  assert(!/owes you your labour and materials/.test(b), "materials already sent read as owed again");
  assert(/within 7 days/.test(b), b);
});

Deno.test("outside the window with no fitting template, WhatsApp is not tried and the desk can see it", () => {
  assert(src.includes("workerHeldBack = true"), "held back is never set");
  assert(/if \(workerHeldBack\) \{\s*\n\s*await recordNotSent\(/.test(src), "a held back message is not recorded as not sent");
  assert(src.includes("workerHeldBack ? { sent: false } : await sendMetaWhatsApp"), "Meta has the same window and must not be tried");
  for (const k of ["worker_cleared", "worker_check_reminder"]) {
    const at = src.indexOf(`if (kind === "${k}") {`);
    const b = src.slice(at, at + 2500);
    assert(b.includes("sendToWorker("), `${k} still sends free text without reading the window`);
  }
});

Deno.test("the client's delay message is only true once the worker has been asked", () => {
  const b = src.slice(src.indexOf('} else if (kind === "job_delayed") {'), src.indexOf('} else if (kind.startsWith("addon_")) {'));
  const sendAt = b.indexOf("sendToWorker(");
  const lineAt = b.indexOf("line = ");
  assert(sendAt > 0 && sendAt < lineAt, "the worker must be messaged before the client is told so");
  assert(b.includes("workerReached ?"), "the client wording must follow what actually happened");
  const t = jobDelayedWorkerText("JOB-1", "Roof");
  assert(t.startsWith("JOB-1 (Roof): ") && /Reply here and a person will help\.$/.test(t), t);
  assert(!/[\u2013\u2014]/.test(t) && !/late fee|penalt|warning/i.test(t), t);
});

Deno.test("worker copy says client, never owner, and the add-on is approved by the client", () => {
  const cr = branch("completion_report_worker");
  assert(!/\bowner\b/.test(cr.replace(/\/\/.*$/gm, "")), "owner in worker copy");
  assert(/goes to the client only when you sign/.test(cr));
  assert(/hasSignButtons \? `Use the buttons below/.test(cr), "the buttons are named even when there are none");
  const at = src.indexOf('} else if (kind === "addon_paid_worker") {');
  const addon = src.slice(at, at + 900).replace(/\/\/.*$/gm, "");
  assert(/The client approves it/.test(addon) && !/Yaadly signs it off/.test(addon), addon);
});

Deno.test("the dead worker-confirm kind is gone", () => {
  assert(!src.includes('"quote_awaiting_worker_confirm"'), "the removed worker confirm step is still a kind");
  assertEquals(workerTemplateSummary("quote_awaiting_worker_confirm"), null);
});

Deno.test("the check-in is asked only where it applies, and never as a gate", () => {
  for (const k of ["booked_worker", "job_live_worker"]) {
    const b = branch(k);
    assert(b.includes("checkInAsked(admin, jobId)"), `${k} asks everybody to check in`);
    assert(!/check in first/.test(b), `${k} still reads as a gate`);
    assert(/voice note/.test(b), `${k} does not say the words can be a voice note`);
  }
});
