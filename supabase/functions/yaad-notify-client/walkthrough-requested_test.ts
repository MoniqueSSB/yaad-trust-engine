// The worker hears, by WhatsApp and email, when a client requests a video
// walkthrough.
//
// A wiring test, the same shape as worker-paid_test.ts. The risk is not a
// broken function. It is somebody later routing this to the client, or
// dropping the email half (founder, 14 Sep 2026: WhatsApp AND email), or
// letting it fire against a request the client has since cancelled or the
// worker has already confirmed. 20260915000000.
//
// Run: deno test --allow-read supabase/functions/

import { assert } from "jsr:@std/assert@1";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

const start = src.indexOf('} else if (kind === "walkthrough_requested")');
const block = src.slice(start, src.indexOf('} else if (kind === "walkthrough_notes_ready")'));

Deno.test("walkthrough_requested is a kind, and it goes to the worker's phone and email", () => {
  assert(/"walkthrough_requested"/.test(src.slice(src.indexOf("const KINDS"), src.indexOf("type Kind"))), "not in KINDS");
  const routing = src.slice(src.indexOf('recipientEmail = "";') - 500, src.indexOf('recipientEmail = "";'));
  assert(routing.includes('kind === "walkthrough_requested"'), "not routed to the worker's phone");
  assert(start > 0 && block.length > 400, "the walkthrough_requested branch is gone, renamed or moved");
  assert(block.includes("recipientEmail = String(job.worker_email"), "the email half is gone: the worker is no longer emailed");
});

Deno.test("it says nothing unless a walkthrough request is open and unconfirmed on this job", () => {
  assert(block.includes('.from("jobs")'), "the message no longer reads the job itself");
  assert(/signoff_method !== "walkthrough" \|\| w\?\.walk_link/.test(block), "it no longer stops for a cancelled or already confirmed request");
  assert(/return json\(\{ ok: true, kind, told: false/.test(block), "a closed request is no longer a quiet no-op");
});

Deno.test("it promises nothing about approval or money", () => {
  const text = block.slice(block.indexOf("line = "));
  assert(!/approved|release|paid|payment/i.test(text.replace("how the job is approved", "")), "the message now speaks to approval or money");
  assert(!/held safely|escrow/i.test(text), "banned money language");
});
