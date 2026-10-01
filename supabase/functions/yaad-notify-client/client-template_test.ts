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
  // service_booked was the other example here until 1 Oct 2026, when the
  // founder asked for service bookings to reach WhatsApp outside the window
  // too. It now has a summary, asserted below; a worker kind still has none.
  assertEquals(clientTemplateSummary("booked_worker"), null);
});

Deno.test("service bookings have a line for outside the window", () => {
  for (const k of ["service_booked", "service_confirmed", "service_live"]) assert(clientTemplateSummary(k), k);
});

// 1 Oct 2026, founder: the price message names three choices, and the booked
// message shows the fee, links the invoice and says what starts the job.
import { bookedPaymentLines, quoteChoices } from "./client-template.ts";

Deno.test("the price message names accept, go back and review, each with where it is done", () => {
  const withPhone = quoteChoices("JOB-WEB-1", "Andre", true, "https://p/price", "https://p/job");
  assert(/Accept: reply JOB-WEB-1/.test(withPhone));
  assert(/Go back to Andre: ask for a change/.test(withPhone) && withPhone.includes("https://p/job"));
  assert(/Review: .*https:\/\/p\/price/.test(withPhone));
  assert(/Nothing is booked and nothing is charged until you accept/.test(withPhone));
  // No phone on the job: accepting by reply is not offered.
  assert(!/reply JOB-WEB-1/.test(quoteChoices("JOB-WEB-1", "Andre", false, "https://p/price", "https://p/job")));
  assertEquals(guardrails.scan(withPhone).length, 0);
  assert(!/[–—]/.test(withPhone));
});

Deno.test("the booked message says what starts the job, for both billing modes", () => {
  const full = bookedPaymentLines(false, "J$4,500", "J$10,000", "https://p/job?tab=money");
  assert(/paid in full, as your terms set out/.test(full) && /fee of J\$4,500/.test(full));
  assert(full.includes("https://p/job?tab=money") && /review the full invoice/i.test(full));
  const staged = bookedPaymentLines(true, "J$4,500", null, "https://p/job?tab=money");
  assert(/first bill is paid: Yaadly's Guarantee & Support fee of J\$4,500\./.test(staged));
  assert(/each stage, the first included, is paid before it starts/.test(staged));
  for (const t of [full, staged]) {
    assertEquals(guardrails.scan(t).length, 0, t);
    assert(!/[–—]/.test(t));
    assert(!/\b(?:held|holding|escrow|today|tomorrow|within)\b/i.test(t), t);
  }
});
