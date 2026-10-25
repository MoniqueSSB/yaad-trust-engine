// Her name is an internal record only, never on client or worker output
// (founder rule). The desk email used to be from "Monique at Yaadly" and signed
// "Monique". 30 Sep 2026.
import { assert } from "jsr:@std/assert@1";

Deno.test("the desk email is from and signed by Yaadly, never a person", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const at = src.indexOf("async function sendEmail(");
  const send = src.slice(at, src.indexOf("Deno.serve(", at)).replace(/\/\/.*$/gm, "");
  assert(send.includes("from: `Yaadly <${FROM_EMAIL}>`"), "the sender name is not Yaadly");
  assert(!/Monique/.test(send), "her name is on the email a client or worker receives");
});

// The applicant path, 25 Oct 2026. The address is read off the applications
// row under the caller's token; the page sends an id and words. If a future
// edit lets the body carry a number or an address, the Yaadly number becomes
// a way to message anybody at all, so this reads the source for that too.
Deno.test("an applicant message reads the address off the application row, never the request", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const at = src.indexOf("async function sendToApplicant(");
  assert(at > 0, "there is no applicant path");
  const fn = src.slice(at, src.indexOf("Deno.serve(", at)).replace(/\/\/.*$/gm, "");
  assert(fn.includes("applications?id=eq."), "the applicant is not looked up by application id");
  assert(fn.includes("select=id,app_id,name,phone,email"), "the row read does not carry the contact columns");
  assert(fn.includes("rpc/record_desk_applicant_message"), "the send is not written to the ledger");
  assert(!/\b(b|body|req)\.(phone|email|to_addr|address|number)\b/.test(fn), "an address is taken from the request body");
  assert(!/textmodel|complete\(|chat\(/.test(fn), "a model call has appeared in a path that sends her typed words");
});

Deno.test("the applicant email is also from and signed by Yaadly", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const at = src.indexOf("async function sendToApplicant(");
  const fn = src.slice(at, src.indexOf("Deno.serve(", at)).replace(/\/\/.*$/gm, "");
  assert(!/Monique/.test(fn), "her name is on the message an applicant receives");
});
