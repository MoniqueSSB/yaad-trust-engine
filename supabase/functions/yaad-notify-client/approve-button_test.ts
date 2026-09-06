// The approve button is an ADDITION to the report, never a replacement.
//
// This is a wiring test, in the shape _shared/guardrails_test.ts already uses,
// because the risk here is not a broken function. It is somebody later
// deciding that sending one templated message is tidier than sending a report
// and then a button, and quietly dropping the worker's own words, the AI
// notes, the item codes and the photographs in the process. This file's own
// header has warned about that trade since it was written; this makes the
// warning fail the build.
//
// Run: deno test --allow-read supabase/functions/

import { assert } from "jsr:@std/assert@1";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

// The block that builds the message asking a client to approve.
const block = src.slice(
  src.indexOf('} else if (kind === "evidence_report_confirmed")'),
  src.indexOf('} else if (kind === "dispute_raised")'),
);

Deno.test("the report still carries the worker's own words and the photographs", () => {
  assert(block.length > 400, "the evidence_report_confirmed branch is gone or renamed");
  assert(block.includes("workerSays"), "the worker's own description no longer goes to the client");
  assert(block.includes("attachPhotos = photoUrls"), "the photographs are no longer attached");
  assert(block.includes("line = [workerSays"), "the free-text report is no longer built");
});

Deno.test("the button carries the bare job code as its payload, and the title separately", () => {
  assert(block.includes("TWILIO_CONTENT_SID_APPROVE"), "the approve button is not wired");
  assert(
    /vars: \{ "1": String\(job\.title[^}]*"2": String\(job\.id\) \}/.test(block),
    "the payload variable is no longer the bare job id, which is what yaad-inbound matches on",
  );
});

// The button block alone, bounded by the line that follows it, so a widened
// slice cannot accidentally read the function's own return and pass.
const send = src.slice(src.indexOf("if (approveButton"), src.indexOf("const told = emailed"));

Deno.test("the button never replaces the report, only follows a delivered one", () => {
  assert(send.includes("wa.sent"), "the button can now be sent without the report having landed");
  assert(
    send.includes('wa.via === "twilio whatsapp"'),
    "the button is no longer restricted to a successful WhatsApp delivery, so it could follow an SMS with no report",
  );
});

Deno.test("a failed button never fails the notification", () => {
  assert(send.length > 100 && send.length < 800, `the button block is not where it was: ${send.length} chars`);
  assert(!/return json\(/.test(send), "a failed button now returns early and hides a delivered report");
  assert(send.includes("console.error"), "a failed button is no longer recorded anywhere");
});

Deno.test("it stays inert until the template exists", () => {
  // No secret, no second message, no behaviour change on the live number.
  assert(
    /const approveSid = Deno\.env\.get\("TWILIO_CONTENT_SID_APPROVE"\) \?\? "";\s*\n\s*if \(approveSid && clientPhone\)/.test(block),
    "the button is no longer gated on the secret being configured",
  );
});
