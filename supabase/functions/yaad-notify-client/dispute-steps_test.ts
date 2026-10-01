// The words for a dispute nobody moved (1 Oct 2026, 20261001120000).
//
// Run: deno test --allow-read --allow-env supabase/functions/

import { assert } from "jsr:@std/assert@1";
import { chaseClient, DISPUTE_HOURS, steppedInForClient, steppedInForWorker } from "./dispute-lane.ts";
import * as guardrails from "./guardrails.ts";

const link = "https://app.yaadly.co.uk/portal/jobs/JOB-WEB-1";
const all = [
  steppedInForClient("JOB-WEB-1", "Roof", "no_reply", link),
  steppedInForClient("JOB-WEB-1", "Roof", "client_silent", link),
  steppedInForWorker("JOB-WEB-1", "Roof", "no_reply", link),
  steppedInForWorker("JOB-WEB-1", "Roof", "client_silent", link),
  chaseClient("JOB-WEB-1", "Roof", link),
];

Deno.test("every message names the job, passes the screen and has no dashes", () => {
  for (const t of all) {
    assert(t.includes("JOB-WEB-1") && t.includes(link), t);
    assert(guardrails.scan(t).length === 0, t);
    assert(!/[–—]/.test(t), t);
  }
});

Deno.test("nothing approves, rules, or promises when a person answers", () => {
  for (const t of all) {
    assert(/Nothing (?:on the job )?is approved until it is sorted/.test(t), t);
    // The one time said is the 48 hour rule itself; nothing else is promised.
    assert(!/\b(?:today|tomorrow|within|refund|released|ruled)\b/i.test(t), t);
    assert(!/\b(?!48 )\d+ hours?\b/i.test(t.replace(/\b48 (?:more )?hours\b/g, "")), t);
  }
});

Deno.test("the client is told why Yaadly stepped in, and the chase names both replies", () => {
  assert(all[0].includes(`in ${DISPUTE_HOURS} hours`));
  assert(/not said whether/.test(all[1]));
  assert(all[4].includes("SORTED JOB-WEB-1") && all[4].includes("NOT FIXED JOB-WEB-1"));
});

Deno.test("the migration counts 48 hours, checks every five minutes, and says who moved it", async () => {
  const mig = await Deno.readTextFile(new URL("../../migrations/20261001120000_a_dispute_never_goes_quiet.sql", import.meta.url));
  assert(mig.includes(`interval '${DISPUTE_HOURS} hours'`), "the hours in the migration must match the words");
  assert(!/interval '\d+ days?'/.test(mig), "a day count crept back in");
  assert(mig.includes("'*/5 * * * *'"), "the check is not every five minutes");
  assert(mig.includes("escalated_by = 'no_reply'") && mig.includes("escalated_by = 'client_silent'"), "who moved it is not recorded");
  assert(mig.includes("'dispute_stepped_in', 'dispute_stepped_in_worker'") && mig.includes("'dispute_chase_client'"), "a party is not told");
  // It only ever moves a dispute to a person. It never closes one.
  assert(!/state = 'resolved'/.test(mig.replace(/new\.state not in \('resolved', 'escalated'\)/, "")), "the timer must never close a dispute");
});
