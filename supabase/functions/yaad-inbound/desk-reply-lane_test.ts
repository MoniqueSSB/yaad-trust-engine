// She answers from her own WhatsApp, and it reaches the client.
//
// Founder, 6 September 2026: "make everything in whatsapp." The alert already
// reached her WhatsApp with the client's own words in it. This is the other
// half: she replies in the same thread, on the same phone, and it goes to the
// client from the Yaadly number.
//
// WHAT AUTHENTICATES IT is the sending number and nothing else. Twilio's
// signature proves the request came from Twilio and WhatsApp reports the
// sender, which is the same standing the desk has behind Cloudflare Access and
// is_admin(). That is worth a test rather than a comment, because the
// mitigation is structural: this lane can only ever send a message. It cannot
// approve a stage, release a payable, publish a worker or change a job.
//
// If one of these goes red, the change is wrong, not the test.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

/** The lane, from its banner to the end of its block. */
function lane(): string {
  const at = src.indexOf("// ── Monique, writing in from her own phone");
  assert(at > 0, "the desk reply lane is gone");
  const end = src.indexOf("// ── the website chat door", at);
  assert(end > at, "the lane's end marker moved");
  return src.slice(at, end);
}

Deno.test("her number is claimed before any lane that assumes a client", () => {
  // Every lane below this one reads an inbound message as a client describing
  // a job. Without this her reply is read as a stranger describing work.
  const at = src.indexOf("// ── Monique, writing in from her own phone");
  for (const later of [
    "// ── the website chat door",
    'if (msg.channel === "whatsapp" && msg.from) {',
    "const card = await classifyTheJob(",
  ]) {
    const l = src.indexOf(later);
    assert(l > at, `the desk lane now runs after ${later}, so her own reply can be read as a client message`);
  }
});

Deno.test("the lane only ever sends a message", () => {
  // The structural mitigation for authenticating on a phone number alone.
  // Everything consequential stays where a person is signed in.
  const body = lane();
  for (const forbidden of [
    "approve_stage_via_whatsapp",
    "choose_worker_via_whatsapp",
    "raise_job_client_invoice",
    "raise_job_worker_payable",
    "agree_kickoff_pack",
    'from("jobs")',
    'from("stage_approvals")',
    'from("evidence")',
    'from("worker_profiles")',
  ]) {
    assert(!body.includes(forbidden),
      `the desk WhatsApp lane can now reach ${forbidden}. It authenticates on a ` +
      "sending number alone, so it may send a message and nothing else. " +
      "Anything consequential belongs where a person is signed in (CLAUDE.md 2)");
  }
});

Deno.test("it is her number that opens the lane, compared properly", () => {
  const body = lane();
  assert(body.includes("samePhone(msg.from, deskPhone)"),
    "the lane no longer compares against desk_phone with samePhone, which is " +
    "the comparison written to stop a suffix match treating two countries' " +
    "numbers as one person");
  assert(body.includes('readSettings(supabase as unknown as SettingsReader, ["desk_phone"])'),
    "the lane is not reading desk_phone, so either it is hardcoded or it is open");
});

Deno.test("a bare reply lands on the conversation she was last alerted about", () => {
  // The one thing she cannot see from a phone is which thread a bare reply
  // would go to, so every alert that names a conversation records it.
  assert(src.includes("async function rememberDeskTarget("),
    "nothing records which conversation her phone is on");
  assertEquals(src.match(/target: threadKey,/g)?.length, 4,
    "an alert stopped naming its conversation, so a bare reply from her phone " +
    "would land on whichever one happened to be recorded last");
  const body = lane();
  assert(body.includes('String(a._lane ?? "") === "desk"'),
    "the lane no longer reads the recorded target");
});

Deno.test("both sides derive the session key the same way", () => {
  // The key is written by rememberDeskTarget and read by the lane. If those
  // two ever normalise differently, every bare reply says "I do not know who
  // that is for" and nothing in the logs says why.
  assertEquals(src.match(/`desk:\$\{digitsOf\(deskPhone\)\}`/g)?.length, 2,
    "the desk session key is derived differently on the write and the read");
  // Prefixed, so it can never collide with a worker session on that number.
  assert(src.includes('`desk:${digitsOf(deskPhone)}`'),
    "the desk session key lost its prefix and can now collide with a worker session");
});

Deno.test("her words go out exactly as typed", () => {
  // Same promise the desk's own reply button makes. No model touches them:
  // they are her words going to a client under Yaadly's name.
  const body = lane();
  assert(body.includes("await sendWhatsAppTo(t.from_addr, body, trace)"),
    "her reply is no longer sent verbatim, or is no longer sent at all");
  for (const model of ["composeReply", "classifyTheJob", "chatWithFailover"]) {
    assert(!body.includes(model),
      `the desk lane now runs ${model} over her own words before they reach a client`);
  }
});

Deno.test("a reply WhatsApp will not carry is queued, not lost", () => {
  // Meta's 24 hour window. The same table the desk's own reply button uses,
  // flushed by the lane at the top of this function when they write back.
  const body = lane();
  assert(body.includes('from("pending_desk_replies").insert('),
    "a reply outside the 24 hour window is no longer queued, so her words are " +
    "simply gone and the client was already promised an answer");
  assert(body.includes("goes the moment they write back"),
    "she is no longer told what happened to a reply that could not go now");
});

Deno.test("the reply clock is stamped exactly as the desk stamps it", () => {
  // first_human_reply_at is written ONCE and never overwritten: the promise on
  // every public page is about the first answer, not the most recent, so a
  // long conversation must not be able to make a slow start look fast.
  const body = lane();
  assert(body.includes("thread.first_human_reply_at ? {} : { first_human_reply_at:"),
    "the reply clock is being overwritten on every reply, which makes the one " +
    "working day promise unmeasurable");
  assert(body.includes("awaiting_human_since: null"),
    "an answered thread no longer stops counting against the desk");
  assert(body.includes("human_handling: true"),
    "the thread is not claimed, so the assistant will answer over the top of her");
  assert(body.includes("Yaadly (from the desk): "),
    "her reply is not labelled as hers on the transcript, so the record no " +
    "longer shows who said what");
});

Deno.test("the lane carries text only, and says so", () => {
  // Sending a client a photograph from a lane with no preview is a different
  // decision and it is not this one.
  const body = lane();
  assert(body.includes("This lane carries text only"),
    "the lane stopped telling her that media is not carried, so a photo she " +
    "sends will look sent and will not be");
});
