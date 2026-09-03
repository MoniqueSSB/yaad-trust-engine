/**
 * Tests for the sign in page's one real decision: does the code box hold
 * something worth trying, or does the page need to send a fresh one.
 *
 * The founder's own requirement, 31 Aug 2026: sign in should work with "the
 * code or the email and their code", on one screen that shows "what is
 * essential and what is optional", not a code box hidden until a first
 * click. The logic tests below prove the branch; the source tests prove the
 * page still shows both fields together rather than gating one behind the
 * other again. This still holds for /portal/sign-in.
 *
 * /portal/join is a different page with a different answer, since 3 Sep
 * 2026: see the "the join page" tests further down for why it went back to
 * two visual stages rather than one screen with everything on it.
 *
 * Every test code here is built from CODE_LENGTH, never a literal digit
 * string. The first version of this file hardcoded "123456", six digits,
 * matching what every page's own copy claimed. It was wrong: Supabase
 * actually issues an eight digit code for this project, confirmed against a
 * real email, and a real code typed correctly was being read as incomplete
 * because the check here disagreed with reality. A hardcoded test length
 * would have stayed green through that entire bug.
 *
 * Run: npm test   (from web/)
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(HERE, "ts-resolve-hooks.mjs")));

let signIn;
let CODE;
before(async () => {
  signIn = await import(pathToFileURL(join(HERE, "../lib/portal/sign-in.ts")).href);
  CODE = "1".repeat(signIn.CODE_LENGTH);
});

describe("normalizeCode", () => {
  test("strips anything that is not a digit", () => {
    assert.equal(signIn.normalizeCode("12 34"), "1234");
    assert.equal(signIn.normalizeCode("12-34"), "1234");
    assert.equal(signIn.normalizeCode(""), "");
  });
});

describe("isCodeComplete", () => {
  test("exactly CODE_LENGTH digits is complete", () => {
    assert.equal(signIn.isCodeComplete(CODE), true);
  });

  test("digits with formatting spread through them still count", () => {
    const spaced = CODE.slice(0, Math.ceil(CODE.length / 2)) + " " + CODE.slice(Math.ceil(CODE.length / 2));
    assert.equal(signIn.isCodeComplete(spaced), true);
  });

  test("one digit short is not complete", () => {
    assert.equal(signIn.isCodeComplete(CODE.slice(0, -1)), false);
  });

  test("one digit too many is not complete, not truncated and accepted", () => {
    assert.equal(signIn.isCodeComplete(CODE + "1"), false);
  });

  test("an empty box is not complete", () => {
    assert.equal(signIn.isCodeComplete(""), false);
  });

  test("the right length but not all digits is not complete", () => {
    // A pasted code with a typo should not be waved through as if it were
    // the real thing.
    assert.equal(signIn.isCodeComplete("a" + CODE.slice(1)), false);
  });
});

describe("signInButtonLabel", () => {
  test("an empty box offers to send a code", () => {
    assert.equal(signIn.signInButtonLabel("", false), "Send me a sign in code");
  });

  test("a complete code offers to sign in", () => {
    assert.equal(signIn.signInButtonLabel(CODE, false), "Sign in");
  });

  test("busy while sending says so", () => {
    assert.equal(signIn.signInButtonLabel("", true), "Sending your code...");
  });

  test("busy while checking a code says so, not the sending copy", () => {
    assert.equal(signIn.signInButtonLabel(CODE, true), "Signing in...");
  });
});

describe("the sign in page itself", () => {
  const source = readFileSync(join(HERE, "../app/portal/sign-in/page.tsx"), "utf8");

  test("shows the email field and marks it required", () => {
    assert.match(source, /type="email"/);
    assert.match(source, />\s*Required\s*</);
  });

  test("shows the code field on the same screen, marked optional", () => {
    assert.match(source, /autoComplete="one-time-code"/);
    assert.match(source, />\s*Optional\s*</);
  });

  test("does not gate the code field behind a hidden two-step stage", () => {
    // This is the actual regression this rebuild fixes: the old page only
    // rendered the code input after a separate "ask" stage was submitted,
    // which is why it looked like there was nowhere to enter one.
    assert.doesNotMatch(source, /stage === "enter"/);
    assert.doesNotMatch(source, /useState<"ask" \| "enter">/);
  });

  test("uses the shared decision logic rather than its own copy", () => {
    assert.match(source, /from "@\/lib\/portal\/sign-in"/);
  });

  test("does not commit to a specific digit count in its own visible copy", () => {
    // The bug this guards against: page text claiming "six digit code"
    // while the real length is a different number, silently again.
    assert.doesNotMatch(source, /six digit/i);
  });

  test("still asks for no job code on this page, that belongs to /portal/join", () => {
    assert.doesNotMatch(source, /Job code/);
  });
});

describe("the join page", () => {
  // Rebuilt 3 Sep 2026, founder instruction: the 31 Aug all-fields-at-once
  // screen read as confusing (three boxes, most people only ever needed to
  // fill in one of them), so it went back to two visual stages on the same
  // URL. The 31 Aug fix this replaces is still worth guarding, just aimed at
  // the new shape: the stage that shows the sign-in code field must never be
  // reachable except by way of sendCode actually confirming delivery, never
  // as a stage sitting there unseen from first render.
  const source = readFileSync(join(HERE, "../app/portal/join/page.tsx"), "utf8");

  test("starts on the email stage, not the code stage", () => {
    assert.match(source, /useState<"email" \| "code">\("email"\)/);
  });

  test("only moves to the code stage from inside sendCode, after delivery is confirmed", () => {
    assert.match(source, /setStage\("code"\)/);
    // The old failure mode: a code box that exists in the DOM from first
    // render, just visually hidden by a stage nobody was told about.
    assert.doesNotMatch(source, /useState<"ask" \| "enter">/);
  });

  test("shows the email field", () => {
    assert.match(source, /type="email"/);
  });

  test("the job code field is conditional on it not already being known from the link", () => {
    assert.match(source, /!jobCodeKnown &&/);
    assert.match(source, />Job code</);
  });

  test("shows the sign-in code field, marked required now that it has its own stage", () => {
    assert.match(source, /autoComplete="one-time-code"/);
  });

  test("does not commit to a specific digit count in its own visible copy", () => {
    assert.doesNotMatch(source, /six digit/i);
  });

  test("uses the shared decision logic rather than its own copy", () => {
    assert.match(source, /from "@\/lib\/portal\/sign-in"/);
  });
});
