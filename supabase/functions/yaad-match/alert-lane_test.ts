import { assert, assertEquals } from "jsr:@std/assert@1";
import { ALERT_CAP, alertAction, alertKey, alertVars } from "./alert-lane.ts";
import { JOB_ALERT_BODY, jobAlertContent } from "../yaad-twilio-setup/content.ts";

Deno.test("the alert names trade and parish only, says what to do, and can be stopped", () => {
  const v = alertVars("Plumbing", "St Catherine", true, "https://app.yaadly.co.uk");
  assertEquals(v["1"], "Plumbing"); assertEquals(v["2"], "St Catherine");
  assert(v["3"].includes("Price it"));
  assert(alertAction(false, "https://app.yaadly.co.uk").includes("Finish your check"));
  assert(JOB_ALERT_BODY.includes("{{1}}") && JOB_ALERT_BODY.includes("{{2}}") && JOB_ALERT_BODY.includes("{{3}}"));
  assert(/STOP/.test(JOB_ALERT_BODY), "the way out must be in every alert");
  assert(!/[–—]/.test(JOB_ALERT_BODY));
  for (const k of Object.keys(jobAlertContent().variables)) assert(["1", "2", "3"].includes(k));
});

Deno.test("a number is keyed by digits, and the cap is a small number", () => {
  assertEquals(alertKey("+1 (876) 555-0100"), "wa:18765550100");
  assert(ALERT_CAP >= 3 && ALERT_CAP <= 10);
});

Deno.test("the matcher sends through the template only, caps per number, and records every send", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const at = src.indexOf("the WhatsApp alert list");
  assert(at > 0, "the WhatsApp lane is gone");
  const lane = src.slice(at, src.indexOf("the desk push, once for the job"));
  assert(lane.includes("twilio_content_sid_job_alert"), "must read the approved template's setting");
  assert(lane.includes("whatsapp_alerts_sent_today") && lane.includes("ALERT_CAP"), "the cap must be checked before every send");
  assert(lane.includes("ContentSid"), "sends must be the template, never free text outside the window");
  assert(!/Body:/.test(lane), "no free text body");
  assert(lane.includes('channel: "whatsapp"'), "every send must be recorded in job_alerts");
});
