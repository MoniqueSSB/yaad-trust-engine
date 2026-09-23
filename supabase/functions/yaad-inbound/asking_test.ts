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

/** A whole top-level function body, rather than a guessed number of bytes.
 *
 *  Three assertions in this file have gone red for the wrong reason already,
 *  each time because a fixed `slice(at, at + N)` window stopped reaching the
 *  line it was checking once a comment or a block was added above it. A test
 *  that fails when the code is right teaches people to widen the number, and
 *  the fourth time nobody looks. Bounded by the next top-level declaration
 *  instead, so it grows with the function. */
function fnBody(name: string): string {
  // Either shape. It took only `async function` until 20 Sep 2026, so the
  // first plain one checked here failed as "gone or renamed" while sitting in
  // the file, which is the same wrong-reason red the comment above is about.
  const at = [`async function ${name}(`, `function ${name}(`]
    .map((d) => src.indexOf(d)).find((i) => i >= 0) ?? -1;
  if (at < 0) throw new Error(`${name} is gone or renamed`);
  const rest = src.slice(at + 10);
  const next = rest.search(/\n(?:async function |function |const [A-Z_]+ =|Deno\.serve)/);
  return next < 0 ? src.slice(at) : src.slice(at, at + 10 + next);
}

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
  assert(!decl.includes("handingOver"),
    "handing over forces a job row again. It did for a few hours on 6 Sep 2026 " +
    "and the founder caught it in her own WhatsApp: somebody asking a question " +
    "and then asking for a person has not got a job, and minting one so a " +
    "notification has something to quote is the tail wagging the dog");
});

Deno.test("nothing tells a client a reference that has no row behind it", () => {
  // One place decides it, so a new reply cannot quote a code that does not
  // exist. The reason the old rule felt safe was a belief that a person taking
  // over needs a job to open, and that was checkable and false: Conversations
  // is keyed on channel and from_addr, and v_waiting_on_you selects from
  // intake_threads with no join to jobs at all.
  assert(src.includes('const reference = writeJob ? jobId : "";'),
    "the single decision about whether a reference may be spoken is gone");
  // Everything the client can read goes through `reference`, never jobId.
  const replies = src.slice(src.indexOf("const say = async (text: string"));
  for (const leak of ["Your reference is ${jobId}", "saved as ${jobId}", "reference: jobId"]) {
    assert(!replies.includes(leak),
      `a client-facing reply names jobId directly (${leak}), so a conversation ` +
      "with no job row will quote a code that resolves to nothing");
  }
});

Deno.test("an alert does not open with a job code", () => {
  // "yES IT WORKED, BUT IT HAD A JOB CODE, JOB-WA-1788699164893", founder,
  // 6 September 2026, reading her own WhatsApp. It is the least useful thing
  // in the message: she finds a thread by the number it came from.
  const at = src.indexOf("const waiting =");
  assert(at > 0, "the handover reasons are gone");
  const decl = src.slice(at, at + 700);
  assert(!/\$\{jobId\}:/.test(decl) && !/\$\{reference\}:/.test(decl),
    "a handover reason opens with a job code again");
  assert(decl.includes("They asked to speak to a person."),
    "the reasons no longer read as sentences");
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
  const body = fnBody("pushToDesk");
  assert(body.includes('headers.Click = cfg.desk_url'),
    "the push no longer sets ntfy's Click header, so tapping the notification " +
    "does nothing, which is the entire complaint this was built for");
  assert(/readSettings\(supabase, \["ntfy_topic", "desk_url", "desk_phone"\]\)/.test(body),
    "pushToDesk is no longer reading desk_url and desk_phone alongside the topic");
  assert(body.includes("if (!cfg.ntfy_topic) return;"),
    "pushToDesk no longer bails out when no topic is configured");
});

Deno.test("nothing about the client travels in the notification link", () => {
  // The desk is behind Cloudflare Access and the link is the same every time,
  // so a notification on a lock screen carries no name, number or address.
  const body = fnBody("pushToDesk");
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
  // Four distinct reasons, not one sentence wearing four hats. They no longer
  // name the job code: that moved to the end of the message and only appears
  // when a job actually exists. See "an alert does not open with a job code".
  for (const reason of [
    "They asked to speak to a person.",
    "Nothing could answer them just now",
    "The assistant is paused at the desk",
    "still not clear",
  ]) {
    assert(decl.includes(reason), `the handover reason "${reason}" is gone`);
  }
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
  assert(src.includes("async function readSettings("),
    "readSettings is gone, so the settings readers can drift apart again");
  const body = fnBody("readSettings");
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

Deno.test("only the notifications she must act on reach her WhatsApp", () => {
  // The rule lives at the call sites, not in a condition inside pushToDesk,
  // so adding a notification means deciding this on purpose.
  const texted = src.match(/alsoText:/g) ?? [];
  assertEquals(texted.length, 6,
    "the set of notifications that text her has changed. Six are meant to: " +
    "handed over, they wrote again on a held thread, a job did not save, a " +
    "reply was held back, a web chat moved to WhatsApp, and a worker on a live " +
    "job asked a question the app cannot answer (15 Sep 2026: nobody else " +
    "will, and the worker was told a person would). Every message from every " +
    "stranger is how a phone gets muted");
  // The informational ones must stay silent. If this catches, someone has
  // started texting her about greetings.
  const push = src.slice(src.indexOf("const pushToPhone"), src.indexOf("const pushToPhone") + 2600);
  assert(/alsoText: handingOver\s*\n?\s*\?/.test(push),
    "the main push texts her whether or not the thread was handed over, so " +
    "she now gets a text for every first message from every stranger");
});

Deno.test("the alert carries what they actually said", () => {
  // The whole point. A notification that says something is waiting and not
  // what it is still ends at a laptop.
  const at = src.indexOf("const said = msg.text.trim().slice(0, 700);");
  assert(at > 0, "the client's own words are no longer quoted into the text");
  assert(src.includes('They said:\\n"${said}"'),
    "the handover text no longer quotes them");
});

Deno.test("a blocked reply reaches her without quoting anything a model wrote", () => {
  // What was blocked is the DRAFT. The guidance strings are a fixed closed
  // set, which is the rule alertDeskBlocked has always followed for its push.
  assert(src.includes("async function alertDeskBlocked("),
    "alertDeskBlocked is gone");
  const body = fnBody("alertDeskBlocked");
  assert(body.includes("alsoText:"), "a held back reply no longer texts her, and the client is waiting");
  assert(!/alsoText[\s\S]{0,400}msg\.text/.test(body),
    "the blocked reply text is quoting the message, where the thing that was " +
    "blocked is the model's own draft");
});

Deno.test("the alert goes to her WhatsApp, on the sender Yaadly already owns", () => {
  // Founder, after I proposed SMS: "why sms WHEN I HAVE TO ANSWER BACK IN
  // WHATSAPP. make everything in whatsapp." An alert on one channel and the
  // reply on another is a context switch on every single message, and the data
  // protection argument for SMS did not apply: WhatsApp is the same Twilio
  // account on a sender Yaadly already owns.
  assert(src.includes("async function alertHerPhone("),
    "alertHerPhone is gone, or the alert went back to SMS");
  const body = fnBody("alertHerPhone");
  assert(body.includes("await sendWhatsAppTo(to, body.slice(0, 1500), trace)"),
    "the alert is no longer sent over WhatsApp, or is unbounded");
  assert(body.includes('const to = (cfg.desk_phone ?? "").trim();'),
    "alertHerPhone is not reading desk_phone");
  assert(body.includes("if (!to) return;"),
    "alertHerPhone no longer treats an empty desk_phone as switched off");
  assert(/console\.error\(\s*\n?\s*"alertHerPhone: Twilio would not deliver/.test(body),
    "a refused delivery now fails silently, which from her side is a number " +
    "set on the desk and no messages ever arriving. The usual cause is Meta's " +
    "24 hour window and it has to be visible in the log");
  assert(!src.includes("TWILIO_SMS_FROM"),
    "the SMS route is back. She answers clients in WhatsApp, so an alert by " +
    "text is a context switch on every message");
});

Deno.test("the WhatsApp alert and the push cannot take each other down", () => {
  // yaad-enquiry's own comment records making this mistake: the push was
  // fetched first and returned early when no topic was configured, which took
  // the email with it. They fail for different reasons.
  const body = fnBody("pushToDesk");
  const textAt = body.indexOf("await alertHerPhone(");
  const bailAt = body.indexOf("if (!cfg.ntfy_topic) return;");
  assert(textAt > 0 && bailAt > 0, "one of the two notification paths is gone");
  assert(textAt < bailAt,
    "the WhatsApp alert is sent after the no-topic bail out, so not configuring " +
    "ntfy silently switches off her WhatsApp alerts too");
});

/* ── the section menu names a Messaging Service ───────────────────────────
   19 Sep 2026. The menu was refused by Twilio with 20422 Invalid Parameter
   on every send from the day it went live, because the request carried a
   From number and no MessagingServiceSid, and Twilio requires a Messaging
   Service for any ContentSid send. Plain Body sends do not, which is why
   nothing else on the same number was affected and this looked like a
   template problem for four days. */

Deno.test("the section menu send names a Messaging Service, not just a From", () => {
  const body = fnBody("sendPhaseMenu");
  assert(body.includes("MessagingServiceSid"),
    "sendPhaseMenu no longer sends MessagingServiceSid, so Twilio will refuse it with 20422 again");
  assert(body.includes("ContentSid"), "sendPhaseMenu no longer sends a ContentSid");
  assert(/if \(!messagingServiceSid\)/.test(body),
    "sendPhaseMenu no longer refuses to try without a Messaging Service, so it will fail on the wire instead");
});

Deno.test("askPhase reads the Messaging Service the same way it reads the template", () => {
  const at = src.indexOf("const askPhase =");
  assert(at > 0, "askPhase is gone or renamed");
  const body = src.slice(at, at + 1200);
  assert(body.includes("TWILIO_MESSAGING_SERVICE_SID"), "the secret is no longer read");
  assert(body.includes("twilio_messaging_service_sid"), "the app_settings row is no longer read");
});

/* ── a template id that is not a template id never goes on the wire ───────
   20 Sep 2026. The TWILIO_CONTENT_SID_PHASE secret was set on 15 September to
   the literal text "HX...", off the copy-paste line in RUNBOOK.md, which had
   the placeholder still in it. Because the secret wins over the desk setting,
   every section menu send for the next five days carried "HX..." as its
   ContentSid and was refused by Twilio with 20422, while the correct id sat
   in app_settings unused. The typed question covered for it so completely
   that two investigations went past it, one at the template and one at the
   Messaging Service.

   The fix is the shape check yaad-twilio-setup has always had, and the rule
   that the FIRST VALUE THAT IS AN ID wins, not the first value that is set.
   Both halves matter: without the second, junk in the secret still hides a
   good id on the desk, which is the whole fault. */

Deno.test("askPhase will not send a template id that is not shaped like one", () => {
  const at = src.indexOf("const askPhase =");
  const body = src.slice(at, at + 1200);
  assert(body.includes("firstTemplateSid("),
    "askPhase no longer checks the shape of the template id, so a placeholder can go on the wire again");
  assert(!/Deno\.env\.get\("TWILIO_CONTENT_SID_PHASE"\)\s*\|\|/.test(body),
    "the secret is being taken on truthiness again, so junk in it hides the id on the desk");
});

Deno.test("firstTemplateSid takes the first id, not the first value that is set", () => {
  const body = fnBody("firstTemplateSid");
  assert(/HX\[0-9a-f\]\{32\}/.test(body), "the ContentSid shape is no longer checked");
  assert(body.includes("find("),
    "firstTemplateSid no longer scans its candidates, so a bad first one wins again");
});

/* ── the typed question offers words, not letters ─────────────────────────
   Founder, 15 Sep 2026: "the letters would be confusing and not clear". Again
   on 20 Sep, having had them for five days because the menu was being
   refused: "the letter needs to go".

   The letters stay ACCEPTED, because the menu's own row ids are the letters
   and a worker who learnt them should not be told they are wrong. They are
   only no longer what a worker is asked for. And the fallback stays a real
   question: the session is already waiting on a section answer, so a worker
   asked nothing says something else and the evidence files unmarked. */

Deno.test("the typed section question asks for words, not single letters", () => {
  const at = src.indexOf("const PHASE_QUESTION");
  assert(at > 0, "PHASE_QUESTION is gone or renamed");
  const q = src.slice(at, src.indexOf(";", at));
  assert(!/\bReply [BDAPNS] for\b/.test(q), "the single letters are back in the question");
  for (const word of ["Before", "During", "After", "Problem", "New", "Skip"]) {
    assert(q.includes(word), `the question no longer offers "${word}"`);
  }
});

Deno.test("every word the typed question offers is a word readPhaseAnswer accepts", () => {
  const at = src.indexOf("function readPhaseAnswer");
  const body = src.slice(at, src.indexOf("\n}", at));
  // Skip is deliberately absent: an unrecognised answer files the evidence
  // unmarked and says so, which is exactly what skipping means here.
  for (const word of ["before", "during", "after", "problem", "new"]) {
    assert(body.includes(word), `the question offers "${word}" but readPhaseAnswer no longer reads it`);
  }
});

Deno.test("askPhase still falls back to a real question when the menu is refused", () => {
  const at = src.indexOf("const askPhase =");
  const body = src.slice(at, at + 1200);
  assert(body.includes("PHASE_QUESTION"),
    "the fallback question is gone, so a refused menu leaves the worker asked nothing "
    + "while the session waits for their answer and files whatever they say next unmarked");
});

/* ── a worker may comment on what they just sent (20 Sep 2026) ────────────
   Founder: a worker should be TOLD they can say something about their
   photographs, not merely allowed to. The invitation goes on the filing
   confirmation, because that is the only point in the evidence lane where a
   worker's free text is not already the answer to a question: before it, it
   is the job code, then the caption, then the section.

   The note that answers it is held and read back like any other typed
   update. The 1 is still the gate. The realistic regression here is somebody
   filing the note on arrival, because the worker was invited so it "must" be
   wanted, and that is the 17 September rule going out of the building. */

Deno.test("the filing confirmation invites a comment", () => {
  const at = src.indexOf("const invite =");
  assert(at > 0, "the invitation on the filing confirmation is gone");
  const line = src.slice(at, src.indexOf("\n", at));
  assert(/Type it now/.test(line), "the invitation no longer tells the worker what to do");
  const body = src.slice(src.indexOf("let body = phase"), src.indexOf("let body = phase") + 700);
  assert((body.match(/\$\{invite\}/g) ?? []).length === 2,
    "the invitation is on one wording of the confirmation and not the other, so whether a "
    + "worker is told they can comment depends on whether the section answer was understood");
});

Deno.test("a note is held and read back, never filed on arrival", () => {
  const at = src.indexOf("const justFiled = found ?");
  assert(at > 0, "the note lane is gone or renamed");
  const branch = src.slice(at, at + 1600);
  assert(branch.includes('_lane: "update_draft"'),
    "the note no longer goes through the draft lane, so it is not waiting for a 1");
  assert(branch.includes("draftReadBack("),
    "the note is no longer read back to the worker before it is filed");
  assert(!branch.includes('from("evidence").insert'),
    "the note lane inserts evidence directly, which files a worker's words without the 1 "
    + "they have had to give since 17 September 2026");
});

Deno.test("only a note carries a batch id onto a typed update", () => {
  const at = src.indexOf("const notesBatch =");
  assert(at > 0, "the note's batch link is gone");
  const branch = src.slice(at, at + 500);
  assert(/batch_id: notesBatch/.test(branch), "the insert no longer carries the batch");
  assert(/a\.notes_batch/.test(branch),
    "the batch is no longer read off the draft, so it is being guessed at filing time");
});

Deno.test("the window a note may arrive in is not renewed by notes", () => {
  const body = fnBody("recentFiledBatch");
  assert(/storage_path/.test(body),
    "recentFiledBatch no longer requires an actual file, so a note renews its own window "
    + "and an unrelated update half an hour later joins old photographs");
  assert(/uploaded_by/.test(body), "the batch is no longer scoped to the worker who sent it");
});

Deno.test("every filed batch gets a batch id, including a single photo", () => {
  const at = src.indexOf("const batchId =");
  assert(at > 0, "the batch id is gone");
  const line = src.slice(at, src.indexOf("\n", at));
  assert(!/length > 1/.test(line),
    "a single photograph is back to having no batch id, so it is the one kind of evidence "
    + "a worker cannot attach a note to");
  assert(/crypto\.randomUUID\(\)/.test(line), "the batch id is no longer minted");
});

/* ── a half-finished session is not for ever (23 Sep 2026) ────────────────
   The evidence session had no age at all. The stale drop written for exactly
   that case sits AFTER the evidence block, and that block returns on every
   path it has, so the one lane whose comment promised an orphaned photo would
   be dropped was the one lane it could never run on.

   Live effect, which is how it was found: three photographs staged on 20
   September were still waiting for a section answer on the 23rd, and the next
   thing the founder typed, about anything at all, would have been read as
   that answer and filed them under it.

   The guard is load bearing because of the ORDER, so the order is asserted
   here too. Move the drop above the block and the guard stops mattering;
   remove the guard and the drop stops running. Either alone is a silent
   return to filing days-old photographs under a stray word. */

Deno.test("an evidence session goes stale, the same as a typed draft", () => {
  const at = src.indexOf("const evSession =");
  assert(at > 0, "evSession is gone or renamed");
  const decl = src.slice(at, src.indexOf(";", at));
  assert(decl.includes("SESSION_STALE_MS"),
    "the evidence session has no age again, so a message days later is read as the answer "
    + "to a question nobody remembers being asked");
  assert(/updated_at/.test(decl), "the age is no longer measured against the session's own clock");
});

Deno.test("the stale drop still sits after the evidence block, which is why the guard is needed", () => {
  const block = src.indexOf("if (!evidenceHeld && evSession) {");
  const drop = src.indexOf("A stale evidence session is dropped");
  assert(block > 0 && drop > 0, "one of the two is gone or renamed");
  assert(drop > block,
    "the stale drop has moved above the evidence block. That is not wrong in itself, but the "
    + "age guard on evSession was added because it was below, so check both together");
});

Deno.test("one staleness number, not a copy per lane", () => {
  assert(/const SESSION_STALE_MS = 48 \* 3600_000;/.test(src), "SESSION_STALE_MS is gone or changed");
  const copies = (src.match(/48 \* 3600_000/g) ?? []).length;
  assert(copies === 1,
    `48 hours is written out ${copies} times. It was three, and they drift: put every lane on `
    + "SESSION_STALE_MS so a change to one is a change to all");
});
