// What can honestly be checked about the Patois fixtures without a model key.
//
// Not comprehension. Drift. If somebody renames a trade in the prompt, every
// fixture expecting the old name silently becomes unmarkable, and a harness
// nobody can mark is a harness nobody runs. This is the check that makes the
// twenty minute manual run in RUNBOOK.md worth doing.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { PATOIS_FIXTURES } from "./patois-fixtures.ts";
import { TRADES } from "./trades.ts";

Deno.test("every trade a fixture expects is still a trade the prompt offers", () => {
  // Reads the trade list itself rather than scanning index.ts for the words.
  //
  // Until 4 September 2026 the prompt carried its own copy of the eighteen
  // trades and this test searched that copy as text. The agent audit found
  // three different trade lists across four job-reading prompts, one of them
  // eight trades short, so the list moved into _shared/trades.ts, generated
  // from data/job-taxonomy.js and drift-checked against it. The prompt now
  // interpolates TRADES_PROMPT_LINE, so there is no longer a literal
  // "Roofing" in index.ts to find, and this test failed on a change that had
  // dropped nothing at all.
  //
  // Checking the source is what the test always meant. Its own comment said
  // the prompt's list "is the one copied from data/job-taxonomy.js", and the
  // copy is what moved; the intent, catching a fixture that expects a trade
  // the product no longer offers, is unchanged and now cannot be fooled by
  // the word happening to appear elsewhere in a 3,000 line file.
  for (const f of PATOIS_FIXTURES) {
    if (!f.trade) continue;
    assert(
      (TRADES as readonly string[]).includes(f.trade),
      `the fixture expects the trade "${f.trade}" and the intake prompt no longer offers it. `
      + `Either the taxonomy changed and this fixture needs updating, or a trade was dropped by accident.`,
    );
  }
});

Deno.test("the harness still covers the three things that are not a job", () => {
  // A greeting, a price question and a trust question. These are the messages
  // the assistant is most likely to get confidently wrong, and a run that
  // quietly lost them would look like a clean pass.
  const notJobs = PATOIS_FIXTURES.filter((f) => f.trade === "");
  assert(notJobs.length >= 3, "the harness has lost its non-job messages");
  const marks = PATOIS_FIXTURES.map((f) => f.mustGetRight).join(" ");
  assert(marks.includes("THE PRICE ONE"), "no fixture checks that a price is refused");
  assert(marks.includes("THE SAFETY ONE"), "no fixture checks the safety refusal");
});

Deno.test("the safety fixtures exist in pairs, because one is easy to pass by luck", () => {
  const safety = PATOIS_FIXTURES.filter((f) => f.mustGetRight.includes("SAFETY ONE"));
  assertEquals(safety.length, 2, "there should be two safety messages, wiring and structure");
});

Deno.test("every fixture is markable by somebody who is not an engineer", () => {
  for (const f of PATOIS_FIXTURES) {
    assert(f.said.trim().length > 20, `fixture is too thin to be a real message: ${f.said}`);
    assert(
      f.mustGetRight.trim().length > 40,
      `"${f.said.slice(0, 40)}" has no clear instruction for whoever is marking the run`,
    );
  }
});

Deno.test("no dash characters anywhere in the fixtures", () => {
  // Standing writing rule on this project, and these strings are read aloud
  // off a phone screen by whoever is marking the run.
  for (const f of PATOIS_FIXTURES) {
    const text = f.said + f.mustGetRight;
    assert(!/[‐-―]/.test(text), `dash character in a fixture: ${f.said.slice(0, 40)}`);
  }
});
