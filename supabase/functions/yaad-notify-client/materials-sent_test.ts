// The worker hears about materials money only once a person has sent it.
//
// A wiring test, in the shape approve-button_test.ts uses. The risk is not a
// broken function. It is somebody later moving this message to the release,
// "so the worker hears sooner", and telling a worker money is on its way when
// nobody has sent it; or putting a bank account in the text, when Yaadly
// stores no worker bank details (founder, 14 Sep 2026). 20260914190000.
//
// Run: deno test --allow-read supabase/functions/

import { assert } from "jsr:@std/assert@1";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

const block = src.slice(
  src.indexOf('} else if (kind === "materials_sent_worker")'),
  src.indexOf('} else if (kind === "evidence_landed")'),
);

Deno.test("materials_sent_worker is a kind, and it goes to the worker's phone", () => {
  assert(/"materials_sent_worker"/.test(src.slice(src.indexOf("const KINDS"), src.indexOf("type Kind"))), "not in KINDS");
  const routing = src.slice(src.indexOf('recipientEmail = "";') - 400, src.indexOf('recipientEmail = "";'));
  assert(routing.includes('kind === "materials_sent_worker"'), "not routed to the worker's phone");
});

Deno.test("it says nothing unless the release is marked sent on this job", () => {
  assert(block.length > 400, "the materials_sent_worker branch is gone or renamed");
  assert(block.includes('.from("materials_releases")'), "the message no longer reads the release itself");
  assert(block.includes('.eq("job_id", jobId)'), "a release on another job could be announced here");
  assert(/if \(!rel\?\.sent_at\)\s*\{[\s\S]{0,200}return json\(/.test(block), "it no longer stops when the money is not marked sent");
});

Deno.test("it names no bank account and promises nothing about timing", () => {
  const text = block.slice(block.indexOf("line = "));
  assert(!/account|ending|\bNCB\b|\bJN\b|Scotia/i.test(text), "the message now names a bank account");
  assert(!/today|tomorrow|within|working day/i.test(text), "the message now promises when the money lands");
});
