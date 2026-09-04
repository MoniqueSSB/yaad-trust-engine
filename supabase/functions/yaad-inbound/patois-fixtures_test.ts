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

const promptSource = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("every trade a fixture expects is still a trade the prompt offers", () => {
  // The prompt's trade list is the one copied from data/job-taxonomy.js, the
  // generated source of truth for every dropdown in the product.
  for (const f of PATOIS_FIXTURES) {
    if (!f.trade) continue;
    assert(
      promptSource.includes(f.trade),
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
