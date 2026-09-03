/**
 * Tests for lib/ask.ts, the rules Ask Yaadly applies before a stranger's
 * question is saved for publication on a public page.
 *
 * Why this file exists. Two things call these rules: the form as you type,
 * and the server action before it inserts. If they ever disagree, the visitor
 * is either stopped by a message they cannot act on, or waved through into a
 * refusal from Postgres. One module, held here.
 *
 * The contact-details rule is the one worth reading twice. It has two ways to
 * be wrong and they are not equally bad. Missing a phone number publishes
 * somebody's mobile on the open internet. Flagging a price stops a question
 * that is the entire point of the board, because "is 1,500,000 fair for a
 * bathroom" is what people actually come here to ask. Both are tested below,
 * and if one of these assertions ever has to be loosened to make a change
 * pass, the change is publishing contact details or blocking prices. Fix the
 * code, never the assertion.
 *
 * Run: npm test   (from web/)
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(HERE, "ts-resolve-hooks.mjs")));

let a;
before(async () => {
  a = await import(pathToFileURL(join(HERE, "../lib/ask.ts")).href);
});

const ok = (body, area = "") => assert.equal(a.checkQuestion(body, area), null);
const fails = (body, area = "") => {
  const p = a.checkQuestion(body, area);
  assert.ok(p, "expected this to be refused, it was accepted");
  return p;
};

describe("length", () => {
  test("a real question passes", () => {
    ok("How much should a water tank install cost in Portmore?");
  });

  test("under ten characters is refused, and says how to fix it", () => {
    const p = fails("too short");
    assert.equal(p.field, "body");
    assert.match(p.message, /at least ten characters/);
  });

  test("whitespace does not pad a short question into a long one", () => {
    fails("   hi        ");
  });

  test("exactly ten characters passes, the boundary is inclusive", () => {
    ok("Gate cost?");
  });

  test("over five hundred characters is refused", () => {
    const p = fails("a".repeat(a.BODY_MAX + 1));
    assert.match(p.message, /over 500 characters/);
  });

  test("exactly five hundred passes", () => {
    ok("a".repeat(a.BODY_MAX));
  });
});

describe("contact details never reach a public board", () => {
  test("an email address is refused", () => {
    const p = fails("Can somebody price a roof for me, reply to me at monique@example.com");
    assert.match(p.message, /public/);
  });

  test("a plain Jamaican number is refused", () => {
    fails("Call me on 8765551234 about a bathroom job please");
  });

  test("a grouped local number is refused", () => {
    fails("My number is 555-1234 if a plumber wants the job");
  });

  test("a grouped number with an area code is refused", () => {
    fails("Reach me on 876 555 1234 about the roof at the back");
  });

  test("a spaced international number is refused", () => {
    fails("Ring me on +44 7700 900123 about the wall at the back");
  });

  test("a number in the area field is refused too", () => {
    const p = fails("Is a soak away needed for a new bathroom in this parish?", "8765551234");
    assert.equal(p.field, "area");
  });
});

describe("prices are questions, not contact details", () => {
  // Every one of these is a question the board exists to answer. If any of
  // them starts failing, the board has stopped working for the people it is
  // for.
  test("a comma grouped price passes", () => {
    ok("Is 1,500,000 a fair price for a full bathroom in Kingston?");
  });

  test("a larger comma grouped price passes", () => {
    ok("A contractor quoted me 12,500,000 to build two bedrooms, is that sane?");
  });

  test("measurements and small figures pass", () => {
    ok("For a 10 by 12 room how many bags of cement is normal for a floor?");
  });

  test("a year passes", () => {
    ok("The roof was last done in 2016, is it due again by now do you think?");
  });

  test("a plain price with no separators passes", () => {
    ok("Would 450000 cover painting a three bedroom house inside and out?");
  });

  // The considered trade in lib/ask.ts. A bare run of seven digits is both a
  // local number and a price in Jamaican dollars, and the board exists to
  // answer the price question, so the submit lets it through and the desk is
  // told to look. Changing this to refuse would block the questions the
  // board is for. See the comment above PHONEISH.
  test("a bare seven digit figure passes, because it is also a price", () => {
    ok("Is 1500000 fair for a full bathroom in Kingston these days?");
  });

  test("but the desk is told to look at it", () => {
    assert.equal(a.mightCarryContactDetails("Is 1500000 fair for a bathroom?"), true);
    assert.equal(a.mightCarryContactDetails("Is 1,500,000 fair for a bathroom?"), false);
  });
});

describe("what the insert receives", () => {
  test("it is trimmed, and an empty area becomes null not an empty string", () => {
    const t = a.tidyQuestion("  How much for a gate?  ", "   ");
    assert.equal(t.body, "How much for a gate?");
    assert.equal(t.area, null);
  });

  test("an area is trimmed and kept", () => {
    assert.equal(a.tidyQuestion("How much for a gate?", " Portmore ").area, "Portmore");
  });

  test("a long body is cut to the column's length", () => {
    assert.equal(a.tidyQuestion("b".repeat(900), "").body.length, a.BODY_MAX);
  });

  test("an over long area is cut rather than refused by the database", () => {
    assert.equal(a.tidyQuestion("How much for a gate?", "x".repeat(200)).area.length, a.AREA_MAX);
  });
});
