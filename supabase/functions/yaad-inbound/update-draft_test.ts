// A worker's typed update is filed only on a reply of 1.
//
// The chat on JOB-WEB-1789253807959 is the fixture: "done", "no",
// "share location" and "1" all went on the record as evidence on 14 and 15
// September 2026. None of them may file on their own again.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { draftReadBack, readDraftReply, saysWhatItShows, tooShortToBeAnUpdate, WHAT_HAPPENS_NEXT } from "./update-draft.ts";
import { isBareAcknowledgement } from "./worker-question.ts";

const read = (t: string) => readDraftReply(t, isBareAcknowledgement);

Deno.test("only a reply of 1 files the waiting update", () => {
  assertEquals(read("1"), "file");
  assertEquals(read(" 1 "), "file");
  for (const said of ["yes", "ok", "done", "send it", "11", "one"]) {
    assert(read(said) !== "file", `"${said}" must not file`);
  }
});

Deno.test("no drops the waiting update", () => {
  for (const said of ["no", "No.", "cancel", "delete", "don't"]) assertEquals(read(said), "discard", said);
});

Deno.test("an acknowledgement or a stray character keeps the draft as it is", () => {
  for (const said of ["ok", "thanks", "2", "?", "."]) assertEquals(read(said), "keep", said);
});

Deno.test("real words replace the draft rather than filing", () => {
  for (const said of ["done", "stairs are in and the rail is fixed", "share location"]) {
    assertEquals(read(said), "replace", said);
  }
});

Deno.test("a lone number or character is never an update", () => {
  for (const said of ["1", "2", "", "  ", "?", "!!", "12"]) assert(tooShortToBeAnUpdate(said), said);
  for (const said of ["done", "ok", "rail fixed"]) assert(!tooShortToBeAnUpdate(said), said);
});

Deno.test("the read-back quotes the words, names the job and the one reply that files", () => {
  const s = draftReadBack("JOB-1", "Stair rails", "stage one done, stairs are in");
  assert(s.includes("JOB-1 (Stair rails)"));
  assert(s.includes("\"stage one done, stairs are in\""));
  assert(s.includes("Reply 1"));
  assert(!/[–—]/.test(s), "no dashes in worker copy");
});

/* ── a note about the photographs just filed (20 Sep 2026) ────────────────
   The filing confirmation now invites a comment, and the answer is held and
   read back like any other typed update. Being invited to say something does
   not buy a way past the 17 September rule: the 1 is still the gate. What
   changes is only where the words land, sharing the photographs' batch_id so
   the portal draws the lot as one update. */

Deno.test("a note joining a batch says so, and still files only on a 1", () => {
  const s = draftReadBack("JOB-1", "Stair rails", "the rail was rusted through underneath", true);
  assert(s.includes("with the photos you just sent"), "the worker is not told where it is going");
  assert(s.includes("JOB-1 (Stair rails)"), "the job is no longer named, so it cannot be checked");
  assert(s.includes("Reply 1"), "the gate is gone from the read-back");
  assert(s.includes("Nothing is filed until you reply 1"), "the gate is no longer stated");
  assert(!/[–—]/.test(s), "no dashes in worker copy");
});

Deno.test("a note does not promise that the NEXT photos will carry it too", () => {
  const note = draftReadBack("JOB-1", "Stair rails", "rail was rusted", true);
  const plain = draftReadBack("JOB-1", "Stair rails", "rail was rusted");
  assert(!note.includes("Photos you send next"),
    "a note is attached backwards to photos already filed, so promising the next ones carry it is a lie");
  assert(plain.includes("Photos you send next"),
    "the ordinary read-back lost the forward promise, which is a real behaviour a worker relies on");
});

Deno.test("a note is read exactly like any other draft", () => {
  // Nothing about readDraftReply changes for a note. If this ever needs its
  // own branch, the gate has been moved and the change is wrong.
  assertEquals(read("1"), "file");
  assertEquals(read("no"), "discard");
  assertEquals(read("actually it was the joint, not the rail"), "replace");
});

Deno.test("a mistyped no still drops the waiting update", () => {
  // 29 Sep 2026: "nno" was read back as the next update for the job.
  for (const said of ["nno", "noo", "Nno.", "nnope", "canccel"]) assertEquals(read(said), "discard", said);
  // One stroke away from "no" and a real update all the same.
  for (const said of ["on site", "not done yet", "now fitting the rail"]) assertEquals(read(said), "replace", said);
});

Deno.test("a 1 or an ok is never what a photograph shows", () => {
  for (const said of ["1", " 1 ", "ok", "yes", "2", "?", "", "thanks", "nno"]) {
    assert(!saysWhatItShows(said, isBareAcknowledgement), `must not caption a photo: "${said}"`);
  }
  for (const said of ["fixing beam in place", "done", "after", "new rail"]) {
    assert(saysWhatItShows(said, isBareAcknowledgement), `is a caption: ${said}`);
  }
});

Deno.test("after a filing the worker is told what arrives next and what to do with it", async () => {
  assert(WHAT_HAPPENS_NEXT.startsWith("Next:"));
  // 30 Sep 2026: the reply instruction moved to the draft itself, on the
  // founder's instruction that two asks in one message was confusing. What
  // stays is the gate: nothing reaches the client without the worker.
  assert(!WHAT_HAPPENS_NEXT.includes("Reply 1"), "the filing confirmation asks one thing, not two");
  assert(WHAT_HAPPENS_NEXT.includes("Nothing goes to the client until you say so"));
  assert(WHAT_HAPPENS_NEXT.includes("draft review") && /videos/i.test(WHAT_HAPPENS_NEXT), "the review is named, and videos are a requirement");
  // No day, no hour, nothing about pay or about what the client will decide.
  assert(!/today|tomorrow|tonight|\bhours?\b|paid|payment|approve|guarantee/i.test(WHAT_HAPPENS_NEXT), WHAT_HAPPENS_NEXT);
  assert(!/[\u2013\u2014]/.test(WHAT_HAPPENS_NEXT));
  // Every confirmation that something went on the job carries it, and the
  // sentence it replaced is gone.
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(!src.includes("The client hears about it once it is drafted"), "the old ending is back");
  // Two sites since 30 Sep 2026, and each is named: the several-jobs update
  // no longer files on its job answer with a confirmation of its own, it is
  // read back and goes through fileHeldDraft like every other typed update.
  assert((src.match(/\$\{WHAT_HAPPENS_NEXT\}/g) ?? []).length >= 2, "a filing confirmation lost its next step");
  const held = src.slice(src.indexOf("const fileHeldDraft = async"), src.indexOf("const fileHeldDraft = async") + 3000);
  assert(held.includes("${WHAT_HAPPENS_NEXT}"), "a typed update filed with its 1 lost its next step");
  const photos = src.slice(src.indexOf("const invite = "), src.indexOf("const invite = ") + 200);
  assert(photos.includes("${WHAT_HAPPENS_NEXT}"), "a photo filing lost its next step");
  assert(!/from\("evidence"\)\.insert\(\{\s*job_id: pick\.id/.test(src), "an update is filed somewhere with no next step");
});

/* ── the two buttons under the read-back (29 Sep 2026) ────────────────────
   A tap is a way of typing. These hold the ids in content.ts against the
   reader here, and hold the rule that a tap cannot do what typing could not. */

import { oneLine, readBackVars, readUpdateTap, tapAsTyped, tapMatchesUpdate, TYPE_YOUR_NEW_WORDS } from "./update-draft.ts";
import { ALERT_TERMS } from "./job-alerts.ts";
import { ALERT_PARISH_ROWS, ALERT_TRADE_ROWS, alertParishesContent, alertTradesContent, UPDATE_DRAFT_BODY, UPDATE_DRAFT_DROP, UPDATE_DRAFT_FILE, updateDraftContent } from "../yaad-twilio-setup/content.ts";

const TAP_JOB = "JOB-WEB-1789253807959";

Deno.test("both buttons on the read-back are read, as the thing the label says", () => {
  const actions = updateDraftContent().types["twilio/quick-reply"].actions;
  assertEquals(actions.length, 3, "three buttons is what shows reliably on every phone");
  const want: Record<string, string> = { "Put it on the job": "file", "Change my words": "change", "Drop it": "drop" };
  for (const a of actions) {
    assert(a.title.length <= 20, `${a.title} is too long for a WhatsApp button`);
    const tap = readUpdateTap(a.id.replace("{{4}}", TAP_JOB));
    assert(tap, `${a.id} is not read`);
    assertEquals(tap!.kind, want[a.title]);
    assertEquals(tap!.jobId, TAP_JOB);
  }
  assertEquals(readUpdateTap(`${UPDATE_DRAFT_FILE} ${TAP_JOB}`)?.kind, "file");
  assertEquals(readUpdateTap(`${UPDATE_DRAFT_DROP} ${TAP_JOB}`)?.kind, "drop");
});

Deno.test("a tap is the reply it stands for and goes through the same gate", () => {
  assertEquals(read(tapAsTyped(readUpdateTap(`UPDATEFILE ${TAP_JOB}`)!)), "file");
  assertEquals(read(tapAsTyped(readUpdateTap(`UPDATEDROP ${TAP_JOB}`)!)), "discard");
});

Deno.test("a worker's own words are never mistaken for a tap", () => {
  for (const said of ["1", "no", "drop it", "updatefile", "put it on the job", "UPDATEFILE JOB-1 and more", "DRAFTSEND JOB-1", "EDIT JOB-1"]) {
    assertEquals(readUpdateTap(said), null, said);
  }
});

Deno.test("a tap on an old message cannot file or drop a different update", () => {
  const tap = readUpdateTap(`UPDATEFILE ${TAP_JOB}`)!;
  assertEquals(tapMatchesUpdate(tap, TAP_JOB), true);
  assertEquals(tapMatchesUpdate(tap, "JOB-WEB-1"), false);
  assertEquals(tapMatchesUpdate(tap, ""), false);
  assertEquals(tapMatchesUpdate(tap, null), false);
});

Deno.test("a button id never reaches the report lane or the general door", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const stale = src.indexOf("tap_on_an_update_not_waiting");
  const report = src.indexOf("relay_confirmed_report");
  assert(stale > 0 && report > 0 && stale < report, "the stale tap must be answered before the report lane can send it to a client");
});

Deno.test("the read-back with buttons says what the typed one says", () => {
  assert(UPDATE_DRAFT_BODY.includes("Nothing is filed until you tap Put it on the job"), "the gate is no longer stated");
  assert(!/[\u2013\u2014]/.test(UPDATE_DRAFT_BODY), "no dashes in worker copy");
  const plain = readBackVars("JOB-1", "Stair rails", "stage one done,\nstairs are in");
  assertEquals(plain["1"], "JOB-1 (Stair rails)");
  assertEquals(plain["2"], "stage one done, stairs are in", "a variable is one line");
  assert(plain["3"].includes("Photos you send next"));
  assertEquals(plain["4"], "JOB-1");
  const note = readBackVars("JOB-1", "Stair rails", "rail was rusted", true);
  assert(!note["3"].includes("Photos you send next"), "a note must not promise the next photos carry it");
  assert(note["3"].includes("photos you just sent"));
  assertEquals(oneLine("", 10), "-");
  assert(oneLine("x".repeat(900), 600).length <= 600);
});

Deno.test("Change my words asks for the words and files nothing", async () => {
  const tap = readUpdateTap(`UPDATECHANGE ${TAP_JOB}`)!;
  assertEquals(tap.kind, "change");
  assertEquals(tapAsTyped(tap), "", "it must never stand for a 1");
  assert(!/[\u2013\u2014]/.test(TYPE_YOUR_NEW_WORDS));
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const at = src.indexOf('updateTap?.kind === "change"');
  const typed = src.indexOf("const said = updateTap ? tapAsTyped(updateTap)");
  assert(at > 0 && typed > 0 && at < typed, "the change tap must be answered before anything reads it as a reply");
});

/* ── the trades and parishes lists (29 Sep 2026) ──────────────────────────
   A row's id is what reaches the lane as text, so every id has to be a word
   the typed question already understood. The patterns are trade_key's and
   parish names, copied here so a row that would be refused is caught before
   a worker taps it. */

Deno.test("every trade row is a word the typed question understands, and fits WhatsApp", () => {
  const known = /(solar|plumb|electric|roof|tile|tiling|mason|paint|weld|air ?con|carpent|landscap|window|handy|lock)/i;
  const items = alertTradesContent().types["twilio/list-picker"].items;
  assert(items.length <= 10, "a WhatsApp list carries ten rows");
  assertEquals(items.length, ALERT_TRADE_ROWS.length);
  for (const r of items) {
    assert(known.test(r.id), `${r.id} would not be recognised as a trade`);
    assert(r.item.length <= 24, `${r.item} is too long for a list row`);
    assert(!/,|;|\/|\band\b/i.test(r.id), `${r.id} would be split into two answers`);
  }
});

Deno.test("every parish row is a parish, or anywhere, and fits WhatsApp", () => {
  const parishes = ["Kingston", "St Andrew", "St Catherine", "St Thomas", "Portland", "St Mary", "St Ann", "Trelawny", "St James", "Hanover", "Westmoreland", "St Elizabeth", "Manchester", "Clarendon"];
  const items = alertParishesContent().types["twilio/list-picker"].items;
  assert(items.length <= 10, "a WhatsApp list carries ten rows");
  assertEquals(items.length, ALERT_PARISH_ROWS.length);
  for (const r of items) {
    assert(parishes.includes(r.id) || /^anywhere$/i.test(r.id), `${r.id} is not a parish`);
    assert(r.item.length <= 24, `${r.item} is too long for a list row`);
  }
});

Deno.test("the consent sentence still reaches somebody joining, word for word", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(src.includes('"trades", `You are on the list. ${ALERT_TERMS}`'), "joining no longer says the consent sentence");
  assert(src.includes("return twiml(`${lead}\\n\\n${typed}`);"), "the typed question no longer carries the lead, so the consent sentence is lost when there is no list");
  assert(ALERT_TERMS.length < 900, "the consent sentence would be cut short as a template variable");
});
