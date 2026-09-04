// The banned-language screen reaches the CRM, not just agent output.
//
// WHY THIS EXISTS. hubspotConfig.ts has carried a comment since it was written
// saying the guardrail list "applies to stage names too, not just client copy",
// because stage labels surface in deal notifications and workflow emails. It
// then observed, correctly, that "the check cannot catch this one. We have to."
//
// Nobody did. A stage sat labelled "Funds Held" for a day while the site said
// in as many words that Yaadly does not hold money on your behalf, and it was
// found by eye during an audit rather than by anything automatic. The label is
// fixed. This is the thing that stops the next one.
//
// It reads the config as text on purpose. Importing TypeScript from web/ into
// the Deno suite would drag in Next's module resolution for no benefit; the
// strings are literals and a regex over them is exact enough to fail loudly.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { scan } from "./guardrails.ts";

const config = await Deno.readTextFile(
  new URL("../../../web/lib/hubspotConfig.ts", import.meta.url),
);

/** Every quoted string on a line that defines a label or a dropdown option:
 *  the values that reach a client through a workflow email or a deal export. */
function clientFacingStrings(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*(?:[a-z_]+|"[a-z_]+"):\s*"([^"]+)",?\s*$/gim)) out.push(m[1]);
  for (const m of src.matchAll(/label:\s*"([^"]+)"/g)) out.push(m[1]);
  for (const m of src.matchAll(/options:\s*\[([^\]]*)\]/gs)) {
    for (const o of m[1].matchAll(/"([^"]+)"/g)) out.push(o[1]);
  }
  return [...new Set(out)];
}

const strings = clientFacingStrings(config);

Deno.test("the config actually yielded strings to check", () => {
  // A regex that silently matches nothing would make every test below pass.
  assert(strings.length > 30, `only found ${strings.length} strings, the extraction is broken`);
  assert(strings.includes("Client Paid"), "the renamed stage label is not being read");
});

Deno.test("no CRM label says anything the company has a standing rule never to say", () => {
  const bad: string[] = [];
  for (const s of strings) {
    const hits = scan(s);
    if (hits.length) bad.push(`"${s}" -> ${hits.map((h) => h.term).join(", ")}`);
  }
  assertEquals(bad, [], `a CRM label breaks the banned-language rule:\n  ${bad.join("\n  ")}`);
});

Deno.test("the specific label that was live and wrong stays gone", () => {
  // "Funds Held" describes a structure Yaadly stopped operating on 3 September
  // 2026 when it became principal, and it reached clients through workflow
  // emails. It is not caught by the banned patterns (it says nothing about
  // holding YOUR money), so it is named here directly.
  for (const dead of ["Funds Held", "Escrow", "In Escrow", "Money Held", "Held Funds"]) {
    assert(
      !strings.some((s) => s.toLowerCase() === dead.toLowerCase()),
      `the CRM label "${dead}" is back. Yaadly is principal: the client buys the job from Yaadly.`,
    );
  }
});

Deno.test("no CRM label carries a price, because prices move and labels do not", () => {
  // The service dropdown carried "Deposit Protection Check £149" and two others,
  // and all three were wrong by the time anybody looked: service_catalogue is
  // the only place a price may come from.
  const priced = strings.filter((s) => /£\s?\d|J\$\s?\d|\d+\s?%|\/mo\b/.test(s));
  assertEquals(priced, [], `a CRM label carries a price: ${priced.join(", ")}`);
});
