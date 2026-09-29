// The check-in is for jobs where nobody at the property is watching.
//
// Run: deno test --allow-read --allow-env supabase/functions/

import { assert } from "jsr:@std/assert@1";
import { checkInApplies } from "./arrival-rule.ts";

Deno.test("somebody at home day to day means no check-in is asked for", () => {
  assert(!checkInApplies("Somebody lives there and is at home day to day"));
});

Deno.test("every other answer on the job form, and no answer, means it is", () => {
  for (const said of [
    "A key is held locally, by family or a neighbour",
    "No inside access needed, outside work only",
    "Still to be arranged, I will sort it out with Yaadly",
    "Caretaker on site",
    "", null, undefined,
  ]) {
    assert(checkInApplies(said), `should be asked: ${String(said)}`);
  }
});

Deno.test("the four answers on the job form are still the ones this rule was written against", async () => {
  // If somebody rewords the form, this fails, and the rule is re-read rather
  // than quietly starting to ask everybody or nobody.
  const form = await Deno.readTextFile(new URL("../../../web/lib/jobs/new-form.ts", import.meta.url));
  for (const said of [
    "Somebody lives there and is at home day to day",
    "A key is held locally, by family or a neighbour",
    "No inside access needed, outside work only",
    "Still to be arranged, I will sort it out with Yaadly",
  ]) {
    assert(form.includes(`"${said}"`), `the job form no longer offers: ${said}`);
  }
});
