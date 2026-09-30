// The check-in is asked for and never gates. The worker is told all of it in
// one message: what is kept, the two ways to check in, that skip files now
// and the check-in is still owed before they leave, how long the ask stands,
// and the way out if they cannot.
//
// Run: deno test --allow-read --allow-env supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { ARRIVAL_HOLD_MS, arrivalAsk, arrivalAskLapsed, arrivalStillWanted, cannotCheckIn, CHECK_IN_BEFORE_YOU_LEAVE, isPin, isSkip, saysCheckedIn } from "./arrival-ask.ts";
import * as guardrails from "./guardrails.ts";
import { looksLikeQuestion } from "./worker-question.ts";

const ask = arrivalAsk("JOB-WEB-1", "stage 3", "photos", "https://app.yaadly.co.uk/x");

Deno.test("the ask says what is kept, both ways to check in, the 24 hours and the way out", () => {
  assert(ask.includes("JOB-WEB-1") && ask.includes("stage 3"));
  assert(ask.includes("Your photos are kept until you reply"), ask);
  // Not "go on the job as soon as you reply": after the reply they are still asked what they show.
  assert(!ask.includes("as soon as you reply"), ask);
  assert(ask.includes("reply skip to file now"), ask);
  assert(ask.includes("You need to check in before you leave site today"), ask);
  assert(ask.includes("I'm on site"), ask);
  assert(ask.includes("Send your current location"), ask);
  assert(ask.includes("https://app.yaadly.co.uk/x"), ask);
  assert(ask.includes("24 hours"), ask);
  assert(ask.includes("a person at Yaadly will help"), ask);
});

Deno.test("the hours the ask names are the hours the code keeps", () => {
  assertEquals(ARRIVAL_HOLD_MS, 24 * 3600_000);
  const asked = "2026-09-29T12:00:00Z", at = Date.parse(asked);
  assert(!arrivalAskLapsed(asked, at + 23 * 3600_000));
  assert(arrivalAskLapsed(asked, at + 24 * 3600_000 + 1));
  // An unreadable clock never lets go of somebody's evidence.
  for (const bad of [null, undefined, "", "soon"]) assert(!arrivalAskLapsed(bad, at + 99 * 3600_000));
});

Deno.test("without a portal link the portal route is still offered", () => {
  const a = arrivalAsk("JOB-1", "stage 1", "update", null);
  assert(a.includes("app.yaadly.co.uk") && a.includes("Your update is kept"), a);
});

Deno.test("a worker who cannot share a location is heard as that", () => {
  for (const said of ["i cant share location", "cannot send it", "mi cyaan send it", "no signal here", "location is off", "it is not working", "i don't want to share my location", "no gps on this phone"]) {
    assert(cannotCheckIn(said), said);
  }
  for (const said of ["done", "sent", "1", "fixing beam in place", "on site now"]) assert(!cannotCheckIn(said), said);
});

Deno.test("a pin is two real numbers, never the zero a missing field becomes", () => {
  assert(isPin(18.0179, -76.8099));
  assert(isPin("18.0", "-76.8"));
  for (const [a, b] of [[0, 0], [NaN, NaN], [undefined, undefined], [null, null], [18, undefined]]) assert(!isPin(a, b), `${a},${b}`);
});

Deno.test("the wording passes the language screen, carries no dashes and promises nothing", () => {
  for (const s of [ask, arrivalAsk("J", "stage 1", "update", null), arrivalStillWanted("photos"), arrivalStillWanted("update"), CHECK_IN_BEFORE_YOU_LEAVE]) {
    assertEquals(guardrails.scan(s).length, 0, s);
    assert(!/[–—]/.test(s), s);
    assert(!/\b(?:paid|payment|approved|guarantee)\b/i.test(s), s);
    assert(!looksLikeQuestion(s));
  }
});

Deno.test("skip files now, and the worker is told the check-in is still owed today", () => {
  for (const said of ["skip", "Skip.", "later", "not now", "file it"]) assert(isSkip(said), said);
  for (const said of ["skipping rope fixed", "done", "1", "fixing beam in place", ""]) assert(!isSkip(said), said);
  assert(CHECK_IN_BEFORE_YOU_LEAVE.includes("before you leave site today"));
  assert(CHECK_IN_BEFORE_YOU_LEAVE.includes("Send your current location"));
});

Deno.test("done after the portal is about the check-in, never a caption", () => {
  for (const said of ["done", "Done.", "sent", "checked in", "im on site", "I'm on site"]) assert(saysCheckedIn(said), said);
  for (const said of ["done the first coat", "sent the receipt", "skip", "beam is in"]) assert(!saysCheckedIn(said), said);
});

Deno.test("the ask fits a phone: short lines, no sign-in link pasted into the chat", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(!src.includes("mintPortalUploadLink"), "a sign-in link is being pasted into a worker's chat again");
  assert(!/arrivalAsk\([^)]*mint/.test(src));
  const a = arrivalAsk("JOB-WEB-1789253807959", "stage 3, Walls", "photos", null);
  assert(a.length < 600, `the ask is ${a.length} characters`);
  for (const line of a.split("\n")) assert(line.length <= 130, `long line: ${line}`);
});
