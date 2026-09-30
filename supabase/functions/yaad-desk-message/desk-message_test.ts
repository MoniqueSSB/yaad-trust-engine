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
