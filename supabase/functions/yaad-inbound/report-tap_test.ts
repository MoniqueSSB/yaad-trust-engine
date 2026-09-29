import { assert, assertEquals } from "jsr:@std/assert@1";
import { readDraftTap, readOnSiteTap, tapMatchesDraft } from "./report-tap.ts";
import { ON_SITE_TAP, onSiteContent, REPORT_DRAFT_EDIT, REPORT_DRAFT_OWN, REPORT_DRAFT_SEND, reportDraftContent } from "../yaad-twilio-setup/content.ts";

const JOB = "JOB-WEB-1789253807959";
const fill = (id: string) => id.replace("{{2}}", JOB);

Deno.test("every button on the draft template is read, as the thing its label says", () => {
  const actions = reportDraftContent().types["twilio/quick-reply"].actions;
  assertEquals(actions.length, 3, "three buttons is what shows reliably on every phone");
  const want: Record<string, string> = { "Send as written": "send", "Edit it": "edit", "Write my own": "own" };
  for (const a of actions) {
    assert(a.title.length <= 20, `${a.title} is too long for a WhatsApp button`);
    const tap = readDraftTap(fill(a.id));
    assert(tap, `${a.id} is not read`);
    assertEquals(tap!.kind, want[a.title]);
    assertEquals(tap!.jobId, JOB);
  }
});

Deno.test("the ids in content.ts are the ids read here", () => {
  assertEquals(readDraftTap(`${REPORT_DRAFT_SEND} ${JOB}`)?.kind, "send");
  assertEquals(readDraftTap(`${REPORT_DRAFT_EDIT} ${JOB}`)?.kind, "edit");
  assertEquals(readDraftTap(`${REPORT_DRAFT_OWN} ${JOB}`)?.kind, "own");
  assertEquals(readOnSiteTap(`${ON_SITE_TAP} ${JOB}`), JOB);
  assertEquals(readOnSiteTap(fill(onSiteContent().types["twilio/quick-reply"].actions[0].id)), JOB);
});

Deno.test("a worker's own words are never mistaken for a tap", () => {
  for (const said of ["1", "edit", "send it", "draftsend", "I was on site all day", "onsite", "EDIT JOB-1", "DRAFTSEND JOB-1 and more"]) {
    assertEquals(readDraftTap(said), null, said);
    assertEquals(readOnSiteTap(said), null, said);
  }
});

Deno.test("a draft tap does not collide with the Completion Report's Edit and Issue buttons", () => {
  // yaad-inbound reads ^(EDIT|ISSUE)\s for the Completion Report.
  for (const a of reportDraftContent().types["twilio/quick-reply"].actions) {
    assert(!/^(EDIT|ISSUE)\s/i.test(fill(a.id)), a.id);
  }
});

Deno.test("a tap on an old message cannot act on a different job's draft", () => {
  const tap = readDraftTap(`DRAFTSEND ${JOB}`)!;
  assertEquals(tapMatchesDraft(tap, JOB), true);
  assertEquals(tapMatchesDraft(tap, "JOB-WEB-1"), false);
  assertEquals(tapMatchesDraft(tap, ""), false);
  assertEquals(tapMatchesDraft(tap, null), false);
});

Deno.test("no template body carries a dash or a banned idea", () => {
  for (const c of [reportDraftContent(), onSiteContent()]) {
    const body = c.types["twilio/quick-reply"].body;
    assert(!/[–—]/.test(body), body);
    assert(!/escrow|held for|100%/i.test(body), body);
  }
});
