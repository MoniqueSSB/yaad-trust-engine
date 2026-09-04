// The assistant's own half of the conversation gets written down.
//
// A wiring test, in the shape _shared/guardrails_test.ts uses, because the
// risk is not a broken function. Until 4 September 2026 the transcript held
// only the client's turns, and the model was handed a monologue while being
// told to "treat later lines as answers to earlier ones". Somebody tidying
// this later could easily drop the recording again without noticing what it
// was for.
//
// Run: deno test --allow-read supabase/functions/

import { assert } from "jsr:@std/assert@1";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const say = src.slice(src.indexOf("const say = async (text: string"), src.indexOf("// They asked for a person."));

Deno.test("every reply the client pipeline sends is written to the thread", () => {
  assert(say.length > 200, "the say() helper is gone or renamed");
  assert(say.includes('from("intake_threads")'), "replies are no longer recorded on the thread");
  assert(say.includes('Yaadly: ${wentOut}'), "the assistant's line is no longer labelled and appended");
});

Deno.test("what is recorded is what went out, not what was drafted", () => {
  // The banned-language screen can replace a reply with the holding text. A
  // transcript claiming Yaadly said something it refused to send would be
  // worse than no transcript.
  assert(say.includes("guardrails.scan(text)"), "the recorded line is no longer screened");
  assert(
    say.includes("SAFE_FALLBACK") && say.includes("WEB_SAFE_FALLBACK"),
    "a blocked reply is no longer recorded as the holding text it actually became",
  );
});

Deno.test("a failed record never costs the reply", () => {
  assert(say.includes("catch"), "a failed transcript write can now throw and lose the send");
  assert(!/return json\(/.test(say), "a failed transcript write now returns early instead of replying");
});

Deno.test("both prompts are told there is more than one speaker", () => {
  // Without this the model reads its own previous questions as things the
  // client said, which is worse than not seeing them at all.
  const classify = src.slice(src.indexOf("const CLASSIFY_SYSTEM"), src.indexOf("/** Extraction only."));
  const compose = src.slice(src.indexOf("const COMPOSE_SYSTEM"), src.indexOf("/** Writing only."));
  for (const [name, prompt] of [["classifier", classify], ["writer", compose]] as const) {
    assert(prompt.includes('"Yaadly:"'), `the ${name} is not told which lines are its own`);
    assert(
      prompt.includes("Monique (from the desk)"),
      `the ${name} is not told which lines are a real person's`,
    );
  }
});

Deno.test("the writer is told not to ask twice for what it already has", () => {
  const compose = src.slice(src.indexOf("const COMPOSE_SYSTEM"), src.indexOf("/** Writing only."));
  assert(
    /already asked for and been\s*\n?\s*given/.test(compose),
    "the rule against re-asking an answered question is gone",
  );
});
