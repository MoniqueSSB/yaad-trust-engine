/**
 * Tests for the sign in page's one real decision: does the code box hold
 * something worth trying, or does the page need to send a fresh one.
 *
 * The founder's own requirement, 31 Aug 2026: sign in should work with "the
 * code or the email and their code", on one screen that shows "what is
 * essential and what is optional", not a code box hidden until a first
 * click. The logic tests below prove the branch; the source tests prove the
 * page still shows both fields together rather than gating one behind the
 * other again.
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
before(async () => {
  signIn = await import(pathToFileURL(join(HERE, "../lib/portal/sign-in.ts")).href);
});

describe("normalizeCode", () => {
  test("strips anything that is not a digit", () => {
    assert.equal(signIn.normalizeCode("123 456"), "123456");
    assert.equal(signIn.normalizeCode("12-3456"), "123456");
    assert.equal(signIn.normalizeCode(""), "");
  });
});

describe("isCodeComplete", () => {
  test("exactly six digits is complete", () => {
    assert.equal(signIn.isCodeComplete("123456"), true);
  });

  test("digits with formatting in between still count", () => {
    assert.equal(signIn.isCodeComplete("123 456"), true);
  });

  test("five digits is not complete", () => {
    assert.equal(signIn.isCodeComplete("12345"), false);
  });

  test("seven digits is not complete, not truncated and accepted", () => {
    assert.equal(signIn.isCodeComplete("1234567"), false);
  });

  test("an empty box is not complete", () => {
    assert.equal(signIn.isCodeComplete(""), false);
  });

  test("six characters that are not all digits is not complete", () => {
    // A pasted code with a typo should not be waved through as if it were
    // six real digits.
    assert.equal(signIn.isCodeComplete("12a456"), false);
  });
});

describe("signInButtonLabel", () => {
  test("an empty box offers to send a code", () => {
    assert.equal(signIn.signInButtonLabel("", false), "Send me a sign in code");
  });

  test("a complete code offers to open the portal", () => {
    assert.equal(signIn.signInButtonLabel("123456", false), "Open my portal");
  });

  test("busy while sending says so", () => {
    assert.equal(signIn.signInButtonLabel("", true), "Sending your code...");
  });

  test("busy while checking a code says so, not the sending copy", () => {
    assert.equal(signIn.signInButtonLabel("123456", true), "Checking...");
  });
});

describe("the sign in page itself", () => {
  const source = readFileSync(join(HERE, "../app/portal/sign-in/page.tsx"), "utf8");

  test("shows the email field and marks it required", () => {
    assert.match(source, /type="email"/);
    assert.match(source, />\s*Required\s*</);
  });

  test("shows the six digit code field on the same screen, marked optional", () => {
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

  test("still asks for no job code on this page, that belongs to /portal/join", () => {
    assert.doesNotMatch(source, /Job code/);
  });
});
