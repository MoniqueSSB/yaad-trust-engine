// The client's stage report as a template: what fills it, and that it says
// nothing the company has a rule against saying.
//
// Run: deno test --allow-read --allow-env supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { CLIENT_UPDATE_BODY, CLIENT_UPDATE_NAME, clientUpdateVars } from "./client-template.ts";
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
