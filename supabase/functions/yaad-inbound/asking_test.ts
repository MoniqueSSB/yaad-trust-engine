// Somebody can write in and get help, not only load a job.
//
// FOUNDER'S INSTRUCTION, 6 September 2026: "People should be able to contact
// me on WhatsApp and get help. Not only just load a job."
//
// What was actually there. Every path below the classifier assumed an inbound
// message was work being described. A question got a job row titled "Someone
// writing in on whatsapp", a reference number, an admin email whose subject
// line began "New job", and a reply asking which parish the property is in.
// There is a real thread in the database from that morning whose entire
// content is "how do you choose workers", and that is exactly what happened to
// it.
//
// Source-level assertions, same as two-calls_test.ts and voice-once_test.ts
// beside it, and for the same reason. The realistic regression here is not a
// broken function. It is somebody simplifying the branch away, because "always
// write the job row" reads tidier than "write it when there is a job", and
// nothing would look wrong afterwards: the client still gets a reply, the desk
// still gets a row, and only the person being interrogated about a job they
// never mentioned would know.
//
// If one of these goes red, the change is wrong, not the test.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("the classifier is asked whether this is a question at all", () => {
  const prompt = src.slice(src.indexOf("const CLASSIFY_SYSTEM"), src.indexOf("/** Extraction only."));
  assert(prompt.length > 200, "CLASSIFY_SYSTEM is gone or renamed");
  assert(prompt.includes('"asking"'), "the classifier no longer decides whether this is a question");
  assert(/"asking":false/.test(prompt),
    "asking is described but not in the JSON shape the model is told to return, " +
    "so it will never come back and every question is a job again");
  // Both at once is the common case and the easy one to get wrong: "my roof is
  // leaking in Portland, how does this work" is a job AND a question.
  assert(/not opposites/.test(prompt),
    "the prompt no longer says a message can be a job and a question at once, " +
    "which is how a real job stops being written up because it ended in a " +
    "question mark");
});

Deno.test("the card carries it, so the handler can read it", () => {
  const type = src.slice(src.indexOf("type IntakeCard = {"), src.indexOf("const CLASSIFY_SYSTEM"));
  assert(/asking: boolean;/.test(type), "IntakeCard no longer carries asking");
});

Deno.test("a question is only treated as one when the classifier is sure and no work was described", () => {
  const at = src.indexOf("const justAsking =");
  assert(at > 0, "justAsking is gone, so questions are job intakes again");
  const decl = src.slice(at, at + 220);
  // Every one of these matters. The consequences of justAsking are that no job
  // row is written and no handover happens at three turns, and neither should
  // ever fire on a guess or on a half-read message.
  assert(decl.includes("card?.asking === true"),
    "justAsking no longer requires the classifier to have positively said so, " +
    "so a failed classification would start suppressing job rows");
  assert(decl.includes("!enough"),
    "justAsking no longer excludes a complete job");
  for (const field of ["scope", "trade", "parish"]) {
    assert(decl.includes(`!s(card?.${field})`),
      `justAsking no longer checks that ${field} is empty, so a message that ` +
      `described real work could be filed as a question and never written up`);
  }
});

Deno.test("the writer is told to answer a question rather than gather a job", () => {
  const prompt = src.slice(src.indexOf("const COMPOSE_SYSTEM"), src.indexOf("/** Writing only."));
  assert(prompt.length > 200, "COMPOSE_SYSTEM is gone or renamed");
  assert(prompt.includes("STATE helping"), "the helping state is gone from the writer's brief");
  assert(/Do NOT\s*\n?\s*ask them for a parish/.test(prompt),
    "the writer is no longer told to stop asking a question-asker for a parish, " +
    "which is the entire complaint this was built for");
  // The override is what makes this survive a failed classification, which is
  // the failure mode that produced the original bug report on the same day.
  assert(/ignore this state and follow STATE helping/.test(prompt),
    "the gathering state no longer overrides itself when nothing was actually " +
    "described, so a failed classification puts everyone back in the funnel");
  assert(src.includes(`stage: "gathering" | "confirming" | "done" | "helping"`),
    "composeReply will not accept the helping state");
});

Deno.test("the writer gets the helping state, and the database does not", () => {
  // intake_threads.stage has a check constraint of gathering, confirming or
  // done. Widening a database constraint to carry a hint for a prompt would be
  // the tail wagging the dog, so the two are deliberately different values.
  assert(src.includes("const writerState = justAsking ? \"helping\" as const : stage;"),
    "writerState is gone, so either the writer stopped being told, or the " +
    "thread started writing a stage its check constraint will reject");
  assert(src.includes("await composeReply(transcript, card, writerState,"),
    "the writer is being handed the database stage again instead of writerState");
  assert(/job_id: writeJob \? jobId : null,/.test(src),
    "the thread is writing a job reference again whether or not a row exists");
});

Deno.test("a question writes no job row, and anything else still does", () => {
  const at = src.indexOf("const writeJob =");
  assert(at > 0, "writeJob is gone, so every question is a job row again");
  const decl = src.slice(at, at + 120);
  assert(decl.includes("!!priorJobId"),
    "a conversation that already has a job would stop updating it");
  assert(decl.includes("!justAsking"), "the question case is no longer excluded");
  assert(decl.includes("handingOver"),
    "handing over no longer forces the job row, so a client can be given a " +
    "reference with no row behind it and a person can be handed a conversation " +
    "with nothing to open");
});

Deno.test("insert or update is decided by whether a job exists, not by whether the thread does", () => {
  // These were the same question for as long as every message wrote a job.
  // Somebody who asks two questions and then describes their roof has a thread
  // on turn three and no job: updating a row that was never written matches
  // nothing and fails silently.
  assert(src.includes("const priorJobId = continuing ? s(prior!.job_id) : \"\";"),
    "priorJobId is gone, so the insert-or-update choice is back on `continuing`");
  // Anchored on the writeJob branch, not on the bare destructure: there is an
  // earlier `const { data, error } =` in this file, on the magic-link call.
  const at = src.indexOf("const { data, error } = !writeJob");
  assert(at > 0, "the job write is gone or moved");
  const write = src.slice(at, at + 700);
  assert(/:\s*priorJobId\s*\n?\s*\?\s*await supabase\.from\("jobs"\)\.update/.test(write),
    "the update branch is no longer chosen by priorJobId, so a thread that " +
    "started as a question will try to update a job row that does not exist");
});

Deno.test("a question-asker is not pushed at a person after three turns", () => {
  const at = src.indexOf("const handingOver =");
  assert(at > 0, "handingOver is gone");
  const decl = src.slice(at, at + 200);
  assert(decl.includes("!justAsking && turns >= HANDOFF_TURNS"),
    "the three turn handover applies to questions again, so somebody working " +
    "through four questions about how Yaadly works lands in Monique's inbox");
  // The two doors to a person that must stay open regardless.
  assert(decl.includes("wantsHuman"), "asking for a person no longer reaches one");
  assert(decl.includes("modelSaidNothing && saidSomething"),
    "a client nothing could answer is no longer handed to a person");
});

Deno.test("a question does not arrive in her inbox dressed as a job", () => {
  // notifyAdmin's subject line is literally `New job ${job.id}` and every row
  // in its table is a job field.
  assert(src.includes("worthTelling && !justAsking ? notifyAdmin("),
    "the job brief email fires for questions again");
  // The phone push still fires. Knowing somebody wrote in is worth a buzz.
  const push = src.slice(src.indexOf("const pushToPhone"), src.indexOf("const pushToPhone") + 1800);
  assert(push.includes("justAsking ? `A question on"),
    "the phone push no longer tells her a question is a question");
  assert(!/justAsking\s*\n?\s*\?\s*`\$\{jobId\}/.test(push),
    "the push quotes a job reference for a conversation that has no job row");
});

Deno.test("the honest placeholder and the handover wording still carry no promise", () => {
  // Fixed strings do not pass through unkeepableSentences, so they are checked
  // by eye and by this. No clock, ever: she reads these herself.
  const at = src.indexOf("if (!safe && saidSomething) {");
  assert(at > 0, "the both-models-failed reply is gone");
  const body = src.slice(at, at + 700);
  assert(body.includes("it will not be instant"),
    "the both-models-failed reply stopped saying that a person reading it takes time");
  for (const promise of ["24 hour", "within a day", "tomorrow", "shortly", "right away"]) {
    assert(!body.includes(promise), `the reply now promises a timescale: ${promise}`);
  }
  assertEquals(body.includes("escrow"), false);
});
