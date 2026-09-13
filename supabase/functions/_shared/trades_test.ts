import { assert, assertEquals } from "jsr:@std/assert@1";
import { TRADES, TRADES_PROMPT_LINE } from "./trades.ts";

/** Read the trades straight out of the generated taxonomy, the way a person
 *  would check by opening it. Deliberately not an import: the taxonomy is a
 *  plain browser script with a `var`, shared by `docs/` and the web app, and
 *  the point of this test is to compare against THAT file rather than against
 *  a convenient copy of it. */
function taxonomyTrades(): string[] {
  const src = Deno.readTextFileSync(new URL("../../../data/job-taxonomy.js", import.meta.url));
  const m = src.match(/var JC_TRADES=(\[[\s\S]*?\]);/);
  if (!m) throw new Error("JC_TRADES not found in data/job-taxonomy.js");
  return JSON.parse(m[1]);
}

Deno.test("the shared trade list IS the taxonomy, in the same order", () => {
  // If this fails, a trade was added or renamed in one place and not the
  // other. Regenerate trades.ts from the taxonomy; do not edit it by hand and
  // do not edit this test to agree with whichever copy happens to be open.
  assertEquals(TRADES, taxonomyTrades());
});

Deno.test("18 trades, which is what the taxonomy says on its first line", () => {
  assertEquals(TRADES.length, 18);
});

Deno.test("the eight trades that were invisible to the classifier are all here", () => {
  // The exact eight the 4 Sep 2026 audit found missing from
  // app_settings.trade_list. Named individually so a future edit that drops
  // one fails for a reason somebody can read, rather than as an off-by-one.
  for (
    const t of [
      "Grille & Gate Welding",
      "General Handyman",
      "Solar Install",
      "Water Tank & Pump",
      "Locks & Security Doors",
      "Drainage & Septic",
      "Fencing",
      "CCTV & Alarms",
    ]
  ) {
    assert(TRADES.includes(t), `missing from the shared list: ${t}`);
  }
});

Deno.test("the prompt line names every trade and tells the model it may answer nothing", () => {
  for (const t of TRADES) assert(TRADES_PROMPT_LINE.includes(t), `not in the prompt line: ${t}`);
  // A classifier with no escape hatch invents one, which is how a job gets a
  // confident wrong trade instead of a blank a person can fill in.
  assert(/empty if unclear/i.test(TRADES_PROMPT_LINE), TRADES_PROMPT_LINE);
});
