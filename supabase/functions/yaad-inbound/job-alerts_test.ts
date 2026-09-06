// Proves the pure parts of the job alert list: what is read as asking to join,
// what is read as asking to stop, that the replies pass the same banned
// language screen every other reply does, and the one rule this lane exists to
// hold, which is that joining the list sends nobody an alert.
//
// Run: deno test --allow-read supabase/functions/yaad-inbound/job-alerts_test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  ALERT_CONSENT_VERSION, ALERT_TERMS, ALERTS_EXACT, ALERTS_PHRASE, ALERTS_STOP,
  ALERTS_MAX_TRIES, ALERTS_OPENER, ALERTS_WA_LINK, alertsOpenerExact, sayList,
} from "./job-alerts.ts";
import { scan } from "./guardrails.ts";

const inboundSource = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("ALERTS on its own joins the list, however it is typed", () => {
  for (const said of ["ALERTS", "alerts", "Alerts", "alert", "job alerts", "Start alerts", "subscribe", "ALERTS!"]) {
    assert(ALERTS_EXACT.test(said), `${said} should join`);
  }
});

Deno.test("a client describing a job is never read as joining the alert list", () => {
  for (const said of [
    "The roof is leaking over the back bedroom",
    "Alerts came through late last week and the worker never showed",
    "I need a plumber in Portmore",
  ]) {
    assert(!ALERTS_EXACT.test(said), `${said} is not the exact opener`);
  }
});

Deno.test("the looser phrasings are recognised, and are gated on there being no job conversation", () => {
  assert(ALERTS_PHRASE.test("Hello Yaadly, I want job alerts."));
  assert(ALERTS_PHRASE.test("how do I get alerts"));
  assert(ALERTS_PHRASE.test("I would like to join alerts"));

  // The gate itself. ALERTS_PHRASE alone would pull a client who already has a
  // job conversation running into the worker lane, so index.ts requires there
  // to be no prior thread before it acts on the loose form. If this assertion
  // fails, that protection has been edited out.
  assert(
    /ALERTS_PHRASE\.test\(alertsSaid\)\s*&&\s*!prior/.test(inboundSource),
    "the loose opener must still be gated on there being no prior thread",
  );
});

Deno.test("STOP comes off the list, and is answered whether or not a question is open", () => {
  for (const said of ["STOP", "stop", "Stop.", "unsubscribe", "stop alerts", "no more alerts"]) {
    assert(ALERTS_STOP.test(said), `${said} should stop`);
  }
  assert(!ALERTS_STOP.test("stop the job"), "a sentence about a job is not the stop keyword");
  assert(!ALERTS_STOP.test("please stop the worker coming tomorrow"));

  // STOP is checked before the session branch, so somebody halfway through
  // being asked their parishes can still get out in one message.
  const stopAt = inboundSource.indexOf("ALERTS_STOP.test(alertsSaid)");
  const sessionAt = inboundSource.indexOf("if (alertsSession) {");
  assert(stopAt > 0 && sessionAt > 0, "both branches must exist");
  assert(stopAt < sessionAt, "STOP must be answered before the mid-question branch");
});

Deno.test("a stop from somebody who is not on the list falls through to their own conversation", () => {
  // stop_job_alerts returns false for a number that was never on the list, and
  // the lane must only answer when it returns true. Otherwise a client typing
  // "stop" in the middle of their own job gets a message about alerts they
  // never asked for and their actual message is swallowed.
  assert(
    /wasOn === true/.test(inboundSource),
    "the stop reply must be conditional on the number actually being on the list",
  );
});

Deno.test("every fixed reply in the alert lane passes the banned-language screen", () => {
  assertEquals(scan(ALERT_TERMS), []);
  assert(!/[‐-―]/.test(ALERT_TERMS), "no dashes");

  // Every string literal in the lane, screened the same way twiml() screens it
  // at runtime. These are marketing copy as much as they are system messages:
  // for a tradesperson who has never dealt with Yaadly, the joining reply is
  // the first sentence they ever read from the company.
  const lane = inboundSource.slice(
    inboundSource.indexOf("// ── the job alert list ──"),
    inboundSource.indexOf("// A worker answering the \"send this draft"),
  );
  assert(lane.length > 1000, "the lane should be in index.ts");
  for (const m of lane.matchAll(/twiml\(\s*([`"][^`"]*[`"])/g)) {
    const text = m[1].slice(1, -1);
    assertEquals(scan(text), [], `banned language in: ${text.slice(0, 80)}`);
    assert(!/[‐-―]/.test(text), `dash in: ${text.slice(0, 80)}`);
  }
});

Deno.test("joining the list sends nobody an alert", () => {
  // The whole point of building the list cold. If this fails, somebody has
  // wired sending into the joining flow, and the first person to find out will
  // be everybody on the list at once.
  const lane = inboundSource.slice(
    inboundSource.indexOf("// ── the job alert list ──"),
    inboundSource.indexOf("// A worker answering the \"send this draft"),
  );
  // Call shapes, not bare mentions: the lane's comments name the matcher on
  // purpose, to say what it is deliberately not doing.
  assert(!/invoke\(\s*["'`]yaad-match/.test(lane), "the joining lane must not call the matcher");
  assert(!/rpc\(\s*["'`]match_workers_for_job/.test(lane), "the joining lane must not run the matcher");
  assert(!/sendWhatsAppTo\(|api\.twilio\.com/.test(lane), "the joining lane replies, it does not send to anybody else");
  assert(!/from\(\s*["'`]job_alerts["'`]/.test(lane), "the joining lane must not write an alert record");
});

Deno.test("the consent version and the sentence it refers to travel together", () => {
  // A consent is only worth the sentence that earned it. If ALERT_TERMS is
  // edited without moving the version, everybody's existing answer is silently
  // reinterpreted as agreement to the new wording.
  assertEquals(ALERT_CONSENT_VERSION, "alerts-v1");
  assert(/STOP/.test(ALERT_TERMS), "the terms must say how to get out");
  assert(/free/i.test(ALERT_TERMS), "the terms must say quoting is free");
  assert(
    inboundSource.includes("p_version: ALERT_CONSENT_VERSION"),
    "the version recorded against a consent must be the constant, never a literal",
  );
});

Deno.test("somebody who cannot quote yet is told so when they join, not when a job arrives", () => {
  assert(
    /can_quote/.test(inboundSource),
    "the joining confirmation must read the vetting gate",
  );
  assert(
    /\/apply/.test(inboundSource),
    "and must point somebody who has not been checked at the way to finish",
  );
});

Deno.test("the lane lets go after two failed answers", () => {
  assertEquals(ALERTS_MAX_TRIES, 2);
  assert(
    /tries >= ALERTS_MAX_TRIES/.test(inboundSource),
    "there must be a cap, or an unanswered question swallows every later message",
  );
});

Deno.test("a list of trades reads as a sentence", () => {
  assertEquals(sayList([]), "");
  assertEquals(sayList(["plumbing"]), "plumbing");
  assertEquals(sayList(["plumbing", "tiling"]), "plumbing and tiling");
  assertEquals(sayList(["plumbing", "tiling", "masonry"]), "plumbing, tiling and masonry");
  assertEquals(sayList(["plumbing", "", "  "]), "plumbing", "empties do not become stray commas");
});

// ── the button, and the reason this test reads other people's files ────────
//
// The "get job alerts" button is a link that opens WhatsApp with a sentence
// already typed. If a page carries a sentence this lane does not recognise, the
// button opens, the message sends, and the person gets the ordinary intake
// assistant instead of joining anything. Nothing errors and nobody finds out.
// So the pages are checked against the constant rather than trusted.

const repoRoot = new URL("../../../", import.meta.url);
const read = (p: string) => Deno.readTextFileSync(new URL(p, repoRoot));

Deno.test("the button's own sentence is recognised as joining", () => {
  assert(alertsOpenerExact(ALERTS_OPENER), "the opener must be read as joining");
  assert(alertsOpenerExact("  " + ALERTS_OPENER + "  "), "whitespace from a paste must not break it");
  assert(alertsOpenerExact("ALERTS"), "the bare keyword still works");
  assert(!alertsOpenerExact("The roof is leaking"), "an ordinary message is not the opener");
});

Deno.test("the button's sentence is matched exactly, not through the loose phrase", () => {
  // ALERTS_PHRASE is refused from a number with a job conversation running,
  // which is right for something somebody typed and wrong for something our own
  // button wrote. A tradesperson who posted a job last month must still be able
  // to press it, so the opener has to pass the exact check on its own.
  assert(
    /alertsOpenerExact\(alertsSaid\)\s*\|\|/.test(inboundSource),
    "the joining branch must check the exact opener before falling back to the loose phrase",
  );
});

Deno.test("every page carrying the button uses the exact sentence the lane recognises", () => {
  const encoded = encodeURIComponent(ALERTS_OPENER);
  assertEquals(ALERTS_WA_LINK, "https://wa.me/447878877567?text=" + encoded);

  // The marketing site writes the href out by hand, because docs/ has no build
  // step and cannot import anything.
  const marketplace = read("docs/marketplace.html");
  assert(
    marketplace.includes(encoded),
    "docs/marketplace.html carries an alerts link whose text has drifted from ALERTS_OPENER",
  );

  // The app builds the href from its own copy of the sentence, duplicated the
  // way web/lib/taxonomy.ts duplicates the trade list, because a Next.js build
  // cannot import from a Deno function.
  const webCopy = read("web/lib/alerts.ts");
  assert(
    webCopy.includes(JSON.stringify(ALERTS_OPENER)),
    "web/lib/alerts.ts has drifted from ALERTS_OPENER in job-alerts.ts",
  );
  assert(
    read("web/app/jobs/page.tsx").includes("ALERTS_WA_LINK"),
    "the board should still carry the button",
  );
});

Deno.test("the button is a link, never a form that posts a number", () => {
  // The whole design. A typed box proves neither that the number is theirs nor
  // that they consented, and it does not open WhatsApp's 24 hour window, so the
  // first reply would need an approved template that does not exist yet.
  const board = read("web/app/jobs/page.tsx");
  // lastIndexOf, not indexOf: the first occurrence is the import line.
  const at = board.lastIndexOf("ALERTS_WA_LINK");
  const around = board.slice(Math.max(0, at - 400), at + 400);
  assert(/<a\s/.test(around), "the alerts button must be a link");
  assert(!/<input|<form/.test(around), "the alerts button must not collect a number on the page");
});
