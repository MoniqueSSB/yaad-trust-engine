import { assert, assertEquals } from "jsr:@std/assert@1";
import { acceptedForClient, acceptedForWorker, linkIn, looksLikeATime, offerForClient, offerSent, readWalkAccept } from "./walkthrough-offer.ts";
import { walkAcceptContent } from "../yaad-twilio-setup/content.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("a day and time reads as an offer, a work update does not", () => {
  for (const t of ["Saturday 10am", "tomorrow morning", "Fri 3pm works", "I can do Monday afternoon", "the 14th at 2", "sat 9 oclock"]) assert(looksLikeATime(t), t);
  for (const t of ["fitted the doors", "done", "1", "no", "the rail was rusted through", ""]) assert(!looksLikeATime(t), t);
  assertEquals(linkIn("Saturday 10am https://meet.google.com/abc-defg-hij"), "https://meet.google.com/abc-defg-hij");
  assertEquals(linkIn("Saturday 10am"), null);
});

Deno.test("the client's acceptance is the button or the words, always with the job code", () => {
  const JOB = "JOB-WEB-1789253807959";
  const btn = walkAcceptContent().types["twilio/quick-reply"].actions[0];
  assertEquals(btn.title, "Accept");
  assertEquals(readWalkAccept(btn.id.replace("{{2}}", JOB)), JOB);
  assertEquals(readWalkAccept(`ACCEPT ${JOB}`), JOB);
  assertEquals(readWalkAccept(`accept ${JOB}`), JOB);
  for (const said of ["accept", "yes", JOB, "ACCEPT", "accept the work on JOB-1 please", "ok"]) assertEquals(readWalkAccept(said), null, said);
});

Deno.test("nobody is told to arrange it with the other side, and the words are short", () => {
  const texts = [
    offerSent("Saturday 10am"),
    offerForClient("JOB-1", "Kitchen cupboards", "Saturday 10am", "Google Meet", "https://app.yaadly.co.uk/portal/jobs/JOB-1"),
    acceptedForClient("Saturday 10am", "WhatsApp video", null),
    acceptedForClient("Saturday 10am", "Google Meet", "https://meet.google.com/x"),
    acceptedForWorker("JOB-1", "Kitchen cupboards", "Saturday 10am", "Zoom", null, "https://app.yaadly.co.uk/portal/jobs/JOB-1"),
  ];
  for (const t of texts) {
    assert(!/arrange (it|the call) with (them|the client|the worker)|their number|your number/i.test(t), t);
    assert(!/[–—]/.test(t), "no dashes");
    for (const line of t.split("\n")) assert(line.length <= 120, `long line: ${line}`);
  }
  assert(offerForClient("JOB-1", "K", "Sat", "Zoom", "x").includes("ACCEPT JOB-1"), "the client must be told the words that accept");
});

Deno.test("the acceptance lane touches the walkthrough and nothing else, ahead of the client lane", () => {
  const at = src.indexOf("a client accepting a walkthrough time");
  const clientLane = src.indexOf("a client on a live job, saying something that is not a code");
  assert(at > 0 && clientLane > at, "accept must be read before the client lane");
  const block = src.slice(at, clientLane);
  assert(block.includes('rpc("accept_walkthrough_via_whatsapp"'));
  assert(!/approve_stage|release|choose_worker|mark_paid|relay_confirmed_report/.test(block), "accepting a time may not approve, book or pay anything");
});

Deno.test("a worker's time goes to the client only when one walkthrough is open", () => {
  const at = src.indexOf("A day and time for a walkthrough the client asked for");
  assert(at > 0, "the offer lane is gone");
  const block = src.slice(at, src.indexOf("const justFiled", at));
  assert(block.includes('.is("walk_accepted_at", null)') && block.includes("length === 1"), "must be exactly one open walkthrough");
  assert(block.includes('rpc("offer_walkthrough_via_whatsapp"'));
  assert(!/from\("evidence"\)|update_draft/.test(block), "an offer is not evidence and not an update");
});
