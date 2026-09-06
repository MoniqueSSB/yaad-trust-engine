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
  const push = src.slice(src.indexOf("const pushToPhone"), src.indexOf("const pushToPhone") + 2600);
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

// ── 6 September 2026, being told, and being able to act on it ────────────
//
// Founder: "how am I being informed people need help, I should get a
// notification on my phone stating to check the dashboard."
//
// She WAS being told. Five separate pushes already fired. What none of them
// did was go anywhere: `desk_url` had been in app_settings the whole time,
// read by the admin email and by nothing else, so a notification arrived on a
// phone saying something was waiting and then had to be acted on by putting
// the phone down and finding a laptop.

Deno.test("there is one push path, and it carries the link", () => {
  // Five copies of the same fetch had already drifted in tone and priority.
  // The link belongs in the one place none of them can forget it.
  const calls = src.match(/fetch\(`https:\/\/ntfy\.sh\//g) ?? [];
  assertEquals(calls.length, 1,
    "a phone push is being sent outside pushToDesk, so it will not open the " +
    "desk when she taps it");
  const at = src.indexOf("async function pushToDesk(");
  assert(at > 0, "pushToDesk is gone or renamed");
  const body = src.slice(at, at + 1800);
  assert(body.includes('headers.Click = cfg.desk_url'),
    "the push no longer sets ntfy's Click header, so tapping the notification " +
    "does nothing, which is the entire complaint this was built for");
  assert(/readSettings\(supabase, \["ntfy_topic", "desk_url", "desk_sms"\]\)/.test(body),
    "pushToDesk is no longer reading desk_url and desk_sms alongside the topic");
  assert(body.includes("if (!cfg.ntfy_topic) return;"),
    "pushToDesk no longer bails out when no topic is configured");
});

Deno.test("nothing about the client travels in the notification link", () => {
  // The desk is behind Cloudflare Access and the link is the same every time,
  // so a notification on a lock screen carries no name, number or address.
  const at = src.indexOf("async function pushToDesk(");
  const body = src.slice(at, at + 1800);
  assert(!/headers\.Click = .*\$\{/.test(body),
    "the notification link is being built with interpolation, so something " +
    "about the conversation is travelling in a URL on a lock screen");
});

Deno.test("an urgent push says why it is waiting, not one line for three reasons", () => {
  // handingOver fires for three reasons and this used to describe only the
  // third. Somebody typing "can I speak to a person" produced a notification
  // saying their message was unclear.
  const at = src.indexOf("const waiting =");
  assert(at > 0, "the handover push is back to one sentence for every reason");
  const decl = src.slice(at, at + 700);
  assert(decl.includes("wantsHuman"), "asking for a person is no longer named in the push");
  assert(decl.includes("modelSaidNothing"),
    "a client nothing could answer no longer gets their own reason in the push");
  assert(decl.includes("agentsPaused"), "a paused assistant is no longer named in the push");
  assert(decl.includes("still not clear"), "the three turn case lost its wording");
  // Every branch names the job, so the push can be acted on from a lock screen.
  assertEquals(decl.match(/\$\{jobId\}/g)?.length, 4,
    "not every reason names the reference any more");
});

Deno.test("a question push points somewhere instead of dismissing itself", () => {
  // Comments stripped before searching. The comment above this branch quotes
  // the old wording to explain why it changed, and a plain substring search
  // reads the explanation as the thing it warns about.
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const at = code.indexOf("const pushToPhone");
  assert(at > 0, "the phone push is gone");
  const push = code.slice(at, at + 2400);
  assert(!push.includes("nothing for you to do"),
    "the question push tells her to ignore it again, which is the opposite of " +
    "what she asked for");
  assert(push.includes("Open Conversations"),
    "the question push no longer says where to read it");
});

Deno.test("a held thread with no job does not push the word null", () => {
  // Replying from the desk sets human_handling and never touches job_id, so
  // the moment she answers somebody who only asked a question, that thread is
  // held with job_id null. String(null) is the string "null".
  const at = src.indexOf("if (prior?.human_handling === true) {");
  assert(at > 0, "the held thread branch is gone");
  // Wide enough to reach the push at the bottom of the branch.
  const body = src.slice(at, at + 4000);
  assert(body.includes("const heldJobId = s(prior.job_id);"),
    "heldJobId is back to String(), which turns a null job into the literal " +
    'string "null" in a foreign key and in a notification');
  assert(body.includes("if (msg.media.length && heldJobId)"),
    "media on a held thread is being filed against a job id that may not exist");
  assert(body.includes("job_id: heldJobId || null,"),
    "the held thread is writing an empty string where the column wants null");
  assert(body.includes("heldJobId ? `${heldJobId}: ` : \"\""),
    "the held push prints a reference even when there is no job behind it");
});

Deno.test("a setting is not trusted to have been written cleanly", () => {
  // Found live, 6 September 2026: desk_url was the 32 character string
  // `"https://concierge.yaadly.co.uk"`, quote marks included. Not a URL. It
  // had been breaking the "Open the desk" button in every admin email, which
  // renders as href=""https://..."", and it would have broken the tap-to-open
  // notification shipped an hour earlier the same evening.
  //
  // yaad-enquiry had already found this, named desk_url in a comment, and
  // stripped the quotes in its own copy. The two places that actually read
  // desk_url kept reading it raw.
  const at = src.indexOf("async function readSettings(");
  assert(at > 0, "readSettings is gone, so the settings readers can drift apart again");
  const body = src.slice(at, at + 400);
  assert(/replace\(\/\^"\(\.\*\)"\$\/, "\$1"\)/.test(body),
    "readSettings no longer strips a surrounding pair of quotes, so a value " +
    "written as JSON breaks every link built from it");
  // Both readers go through it. A raw read is how this came back last time.
  assertEquals(src.match(/from\("app_settings"\)\s*\n?\s*\.select\("key,value"\)/g)?.length, 1,
    "app_settings is being read outside readSettings, so one of the readers " +
    "will trust a value the other one knows better than to trust");
});

// ── 6 September 2026, the words reach her phone ──────────────────────────
//
// Founder: "a message needs to reach me on my phone than in the desk. But I'm
// not on the desk all the time."
//
// The push told her something was waiting. It never told her what was said, so
// every notification still ended at a laptop. She chose a text message over
// the other three routes: Twilio already carries every one of these messages
// so it adds no new company holding client words, where ntfy.sh is a public
// relay whose topic name is the only thing between a stranger and everything.

Deno.test("only the notifications she must act on carry the client's words", () => {
  // The rule lives at the call sites, not in a condition inside pushToDesk,
  // so adding a notification means deciding this on purpose.
  const texted = src.match(/alsoText:/g) ?? [];
  assertEquals(texted.length, 5,
    "the set of notifications that text her has changed. Five are meant to: " +
    "handed over, they wrote again on a held thread, a job did not save, a " +
    "reply was held back, and a web chat moved to WhatsApp. Every message from " +
    "every stranger is how a phone gets muted");
  // The informational ones must stay silent. If this catches, someone has
  // started texting her about greetings.
  const push = src.slice(src.indexOf("const pushToPhone"), src.indexOf("const pushToPhone") + 2600);
  assert(/alsoText: handingOver\s*\n?\s*\?/.test(push),
    "the main push texts her whether or not the thread was handed over, so " +
    "she now gets a text for every first message from every stranger");
});

Deno.test("a text carries what they actually said", () => {
  // The whole point. A notification that says something is waiting and not
  // what it is still ends at a laptop.
  const at = src.indexOf("const said = msg.text.trim().slice(0, 700);");
  assert(at > 0, "the client's own words are no longer quoted into the text");
  assert(src.includes('They said:\\n"${said}"'),
    "the handover text no longer quotes them");
});

Deno.test("a blocked reply texts her without quoting anything a model wrote", () => {
  // What was blocked is the DRAFT. The guidance strings are a fixed closed
  // set, which is the rule alertDeskBlocked has always followed for its push.
  const at = src.indexOf("async function alertDeskBlocked(");
  assert(at > 0, "alertDeskBlocked is gone");
  const body = src.slice(at, at + 1400);
  assert(body.includes("alsoText:"), "a held back reply no longer texts her, and the client is waiting");
  assert(!/alsoText[\s\S]{0,400}msg\.text/.test(body),
    "the blocked reply text is quoting the message, where the thing that was " +
    "blocked is the model's own draft");
});

Deno.test("the text is bounded, and says so when it cannot send", () => {
  const at = src.indexOf("async function textTheDesk(");
  assert(at > 0, "textTheDesk is gone");
  const body = src.slice(at, at + 2200);
  assert(body.includes("body.slice(0, 1500)"),
    "the text is unbounded, so a long voice note transcript is rejected by " +
    "Twilio rather than trimmed");
  assert(body.includes('Deno.env.get("TWILIO_SMS_FROM")'),
    "textTheDesk is no longer reading the SMS number");
  assert(/console\.error\(\s*\n?\s*"textTheDesk: desk_sms is set but /.test(body),
    "a missing Twilio number now fails silently, which from her side is a " +
    "number set on the desk and no texts ever arriving");
  assert(body.includes('if (!to) return;'),
    "textTheDesk no longer treats an empty desk_sms as switched off");
});

Deno.test("the text and the push cannot take each other down", () => {
  // yaad-enquiry's own comment records making this mistake: the push was
  // fetched first and returned early when no topic was configured, which took
  // the email with it. They fail for different reasons.
  const at = src.indexOf("async function pushToDesk(");
  const body = src.slice(at, at + 2600);
  const textAt = body.indexOf("await textTheDesk(");
  const bailAt = body.indexOf("if (!cfg.ntfy_topic) return;");
  assert(textAt > 0 && bailAt > 0, "one of the two notification paths is gone");
  assert(textAt < bailAt,
    "the text is sent after the no-topic bail out, so not configuring ntfy " +
    "silently switches off her text messages too");
});
