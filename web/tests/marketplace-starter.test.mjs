/**
 * The "Trade and parish" starter card on docs/marketplace.html, against the
 * taxonomy it has to agree with.
 *
 * Why this file exists.
 *
 * The card asks two questions on the marketing site and sends both answers to
 * /jobs/new as query parameters. That page validates each one against
 * lib/taxonomy.ts and silently drops anything not on the list, because a
 * hand-typed parameter must not be able to put an unknown trade on a job. The
 * failure mode of that design is that a wrong value looks exactly like a right
 * one: the link works, the form opens, and the answer the person already gave
 * is quietly thrown away. Nothing goes red.
 *
 * That is not hypothetical. Before 6 September 2026 three of the six trade
 * tiles on this page linked to ?trade=Painting, ?trade=Drainage and
 * ?trade=Grille, none of which are trades. Those three tiles had done nothing
 * for as long as they had existed.
 *
 * So the values are asserted against the taxonomy here, and the launch
 * parishes behind the "outside our first parishes" note are asserted against
 * LAUNCH_PARISHES. A friendly-looking label put in a value attribute fails
 * this file, and the failure names the value.
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

const PAGE = join(HERE, "../../docs/marketplace.html");
const html = readFileSync(PAGE, "utf8");

/* The page is hand-written static HTML with no build step, so it is read as
   text rather than parsed. Only two shapes are needed and both are exact. */
const decode = (s) => s.replace(/&amp;/g, "&").replace(/%20/g, " ").replace(/%26/g, "&");

function optionValues(selectId) {
  const block = new RegExp(`<select id="${selectId}">([\\s\\S]*?)</select>`).exec(html);
  assert.ok(block, `no <select id="${selectId}"> on the page`);
  return [...block[1].matchAll(/value="([^"]*)"/g)].map((m) => decode(m[1]));
}

/* href attributes only. The starter card builds its own link in script, and
   that line also contains the substring "jobs/new?trade=". */
function tileTrades() {
  return [...html.matchAll(/href="[^"]*jobs\/new\?trade=([^"&]+)"/g)].map((m) => decode(m[1]));
}

let TRADES, PARISHES, LAUNCH_PARISHES, askedFor;
before(async () => {
  ({ TRADES, PARISHES, LAUNCH_PARISHES } =
    await import(pathToFileURL(join(HERE, "../lib/taxonomy.ts")).href));
  ({ askedFor } = await import(pathToFileURL(join(HERE, "../lib/jobs/new-form.ts")).href));
});

describe("what /jobs/new does with the two answers", () => {
  test("keeps a trade and a parish it recognises", () => {
    assert.equal(askedFor("Painting & Decorating", TRADES), "Painting & Decorating");
    assert.equal(askedFor("Portland", PARISHES), "Portland");
  });

  test("drops a friendly label that is not a taxonomy value", () => {
    /* The three that were live on the old page and did nothing. */
    assert.equal(askedFor("Painting", TRADES), "");
    assert.equal(askedFor("Drainage", TRADES), "");
    assert.equal(askedFor("Grille", TRADES), "");
    /* And the parish label the design shipped with. */
    assert.equal(askedFor("St Catherine (incl. Portmore)", PARISHES), "");
  });

  test("drops a hand-typed parameter, and a missing one", () => {
    assert.equal(askedFor("Dentistry", TRADES), "");
    assert.equal(askedFor(undefined, TRADES), "");
    assert.equal(askedFor("", PARISHES), "");
  });

  test("every value the card can emit survives the check", () => {
    for (const v of optionValues("trade")) assert.equal(askedFor(v, TRADES), v);
    for (const v of optionValues("parish")) assert.equal(askedFor(v, PARISHES), v);
  });
});

describe("the marketplace starter card", () => {
  test("every trade it offers is a real trade", () => {
    for (const v of optionValues("trade")) {
      assert.ok(TRADES.includes(v), `"${v}" is not in TRADES, so /jobs/new will drop it`);
    }
  });

  test("it offers every trade, so the card and the form agree on the list", () => {
    assert.deepEqual([...optionValues("trade")].sort(), [...TRADES].sort());
  });

  test("every parish it offers is a real parish", () => {
    for (const v of optionValues("parish")) {
      assert.ok(PARISHES.includes(v), `"${v}" is not in PARISHES, so /jobs/new will drop it`);
    }
  });

  test("it offers every parish", () => {
    assert.deepEqual([...optionValues("parish")].sort(), [...PARISHES].sort());
  });

  test("the coverage note fires on the same three parishes as LAUNCH_PARISHES", () => {
    const inScript = /var LAUNCH=\[([^\]]+)\]/.exec(html);
    assert.ok(inScript, "no LAUNCH list in the starter card script");
    const listed = inScript[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
    assert.deepEqual(listed.sort(), [...LAUNCH_PARISHES].sort());
  });
});

describe("the one tap trade tiles", () => {
  test("every tile links to a real trade", () => {
    const tiles = tileTrades();
    assert.ok(tiles.length >= 6, "expected at least six trade tiles");
    for (const v of tiles) {
      assert.ok(TRADES.includes(v), `tile links to ?trade=${v}, which is not a trade`);
    }
  });
});
