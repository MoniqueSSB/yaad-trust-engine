// The worker hears their pay has gone only once a person has marked it sent.
//
// A wiring test, the same shape as materials-sent_test.ts. The risk is not a
// broken function. It is somebody later firing this message on stage approval,
// "so the worker hears sooner", and telling a worker money is on its way when
// nobody has sent it; or putting bank details in the text, when Yaadly stores
// none for a worker (founder, 14 Sep 2026). 20260914230000.
//
// Run: deno test --allow-read supabase/functions/

import { assert } from "jsr:@std/assert@1";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

const start = src.indexOf('} else if (kind === "worker_paid")');
const block = src.slice(start, src.indexOf('} else if (kind === "materials_sent_worker")'));

Deno.test("worker_paid is a kind, and it goes to the worker's phone", () => {
  assert(/"worker_paid"/.test(src.slice(src.indexOf("const KINDS"), src.indexOf("type Kind"))), "not in KINDS");
  const routing = src.slice(src.indexOf('recipientEmail = "";') - 400, src.indexOf('recipientEmail = "";'));
  assert(routing.includes('kind === "worker_paid"'), "not routed to the worker's phone");
});

Deno.test("it says nothing unless the pay invoice is marked paid on this job", () => {
  assert(start > 0 && block.length > 400, "the worker_paid branch is gone, renamed or moved");
  assert(block.includes('.from("invoices")'), "the message no longer reads the invoice itself");
  assert(block.includes('.eq("job_id", jobId)'), "an invoice on another job could be announced here");
  assert(block.includes('.eq("payable_to", "worker")'), "a client's bill could be announced to the worker");
  assert(/if \(inv\?\.status !== "paid"\)\s*\{[\s\S]{0,200}return json\(/.test(block), "it no longer stops when the pay is not marked paid");
});

Deno.test("it names no bank account and promises nothing about timing", () => {
  const text = block.slice(block.indexOf("line = "));
  assert(!/account|ending|\bNCB\b|\bJN\b|Scotia/i.test(text), "the message now names a bank account");
  assert(!/today|tomorrow|within|working day/i.test(text), "the message now promises when the money lands");
});
