// The client's stage report as a template: what fills it, and that it says
// nothing the company has a rule against saying.
//
// Run: deno test --allow-read --allow-env supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { CLIENT_UPDATE_BODY, CLIENT_UPDATE_NAME, clientSummaryKinds, clientSummaryVars, clientTemplateSummary, clientUpdateVars } from "./client-template.ts";
import { WORKER_UPDATE_BODY } from "./worker-template.ts";
import * as guardrails from "./guardrails.ts";

Deno.test("the variables carry the job, the worker's words on one line, and the link", () => {
  const v = clientUpdateVars("Carpentry job", "JOB-WEB-1", "Beam fixed in place\n\nFloor next", "https://app.yaadly.co.uk/portal/jobs/JOB-WEB-1");
  assertEquals(v["1"], "Carpentry job (JOB-WEB-1)");
  assertEquals(v["2"], "Beam fixed in place Floor next.");
  assertEquals(v["3"], "https://app.yaadly.co.uk/portal/jobs/JOB-WEB-1");
  for (const k of ["1", "2", "3"]) assert(!/\n/.test(v[k]) && v[k].length > 0, k);
});

Deno.test("long words are cut, empty words are never sent empty", () => {
  assert(clientUpdateVars("J", "JOB-1", "x".repeat(900), "l")["2"].length <= 401);
  assertEquals(clientUpdateVars("", "JOB-1", "", "l")["2"], "-.");
  assertEquals(clientUpdateVars("", "JOB-1", "done", "l")["1"], "your job (JOB-1)");
});

Deno.test("the body passes the language screen and makes no promise", () => {
  const filled = CLIENT_UPDATE_BODY.replace("{{1}}", "Roof (JOB-1)").replace("{{2}}", "Ridge tiles reset.").replace("{{3}}", "https://app.yaadly.co.uk");
  assertEquals(guardrails.scan(filled).length, 0, filled);
  assert(!/guarantee|paid|payment|today|tomorrow|within/i.test(CLIENT_UPDATE_BODY));
  assert(!/[–—]/.test(CLIENT_UPDATE_BODY));
  // Meta refuses a template that starts or ends on a variable.
  assert(!/^\{\{/.test(CLIENT_UPDATE_BODY) && !/\}\}$/.test(CLIENT_UPDATE_BODY));
  assert(/^[a-z0-9_]+$/.test(CLIENT_UPDATE_NAME));
});

Deno.test("every client summary reads as a sentence in the approved body, and claims nothing it cannot know", () => {
  assert(clientSummaryKinds().length >= 14);
  for (const kind of clientSummaryKinds()) {
    const summary = clientTemplateSummary(kind)!;
    const v = clientSummaryVars("Roof repair", "JOB-WEB-1", summary, "https://app.yaadly.co.uk/portal/jobs/JOB-WEB-1");
    const filled = WORKER_UPDATE_BODY.replace("{{1}}", v["1"]).replace("{{2}}", v["2"]).replace("{{3}}", v["3"]);
    assertEquals(guardrails.scan(filled).length, 0, `${kind}: ${filled}`);
    // The body supplies the full stop, so the summary must not end on one.
    assert(!/[.!?]$/.test(summary), `${kind} ends on punctuation`);
    assert(/^[a-z]/.test(summary) || summary.startsWith("Yaadly"), `${kind} must continue the sentence: ${summary}`);
    assert(!/£|J\$|\d/.test(summary), `${kind} carries a figure`);
    assert(!/\b(?:held|holding|escrow|guarantee[ds]?|has been paid|is paid for|paid out|released|today by|tomorrow|within)\b/i.test(summary.replace("once that is paid", "")), `${kind}: ${summary}`);
    assert(!/[\u2013\u2014]/.test(summary), kind);
  }
});

Deno.test("the body the client summaries ride in names no role", () => {
  // The whole case for reusing the approved template is that its sentence is
  // as true to a client as to a worker. If it ever says "worker", this fails.
  assert(!/worker|tradesperson|client/i.test(WORKER_UPDATE_BODY), WORKER_UPDATE_BODY);
});

Deno.test("a kind with no summary is not sent as a template", () => {
  assertEquals(clientTemplateSummary("service_booked"), null);
  assertEquals(clientTemplateSummary("booked_worker"), null);
});
