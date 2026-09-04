// A tap is a way of typing, and must never be more than that.
//
// The negative assertions are the point. A button that could reach a job the
// sender's number is not on, or that carried its own authority, would be a
// second door into the money path with none of the checks the first one has.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { inboundText, wasTapped } from "./button-tap.ts";
import { matchApprovingJob } from "./approval-match.ts";

const JOBS = [
  { id: "JOB-WA-1757000000000", title: "Roof leak, Portland", stage: 1 },
  { id: "JOB-WA-1757000000999", title: "Septic, Kingston", stage: 2 },
];

Deno.test("a tapped button reaches the same job a typed code would", () => {
  const tapped = inboundText("JOB-WA-1757000000000", "Approve");
  const typed = inboundText("", "JOB-WA-1757000000000");
  assertEquals(matchApprovingJob(tapped, JOBS)?.id, matchApprovingJob(typed, JOBS)?.id);
  assertEquals(matchApprovingJob(tapped, JOBS)?.id, "JOB-WA-1757000000000");
});

Deno.test("the button's visible label never enters the message", () => {
  // Concatenating payload and label would still match, but only by luck, and
  // it would put "Approve" into the transcript as if the client wrote it.
  assertEquals(inboundText("JOB-WA-1757000000000", "Approve"), "JOB-WA-1757000000000");
});

Deno.test("an ordinary message is untouched, so this is inert without a template", () => {
  assertEquals(inboundText("", "the back bedroom is still leaking"), "the back bedroom is still leaking");
  assertEquals(inboundText(undefined, "hello"), "hello");
  assertEquals(wasTapped(""), false);
  assertEquals(wasTapped(undefined), false);
});

Deno.test("a whitespace-only payload is not a tap and does not blank the body", () => {
  // Twilio sends the parameter empty on some message types.
  assertEquals(wasTapped("   "), false);
  assertEquals(inboundText("   ", "roof a leak"), "roof a leak");
});

Deno.test("a tap carrying junk approves nothing, exactly as typing junk does", () => {
  for (const payload of ["yes", "1", "approve", "APPROVE ALL", "JOB-WA-0000000000000"]) {
    assertEquals(matchApprovingJob(inboundText(payload, "Approve"), JOBS), null,
      `a button payload of "${payload}" matched a job and must not have`);
  }
});

Deno.test("a payload naming two jobs is refused rather than guessed", () => {
  const both = "JOB-WA-1757000000000 JOB-WA-1757000000999";
  assertEquals(matchApprovingJob(inboundText(both, "Approve"), JOBS), null);
});

Deno.test("yaad-inbound reads the payload and prefers it over the body", () => {
  // The wiring, not the logic. If somebody removes this, taps silently become
  // whatever the button label happened to say.
  const src = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
  assert(src.includes('f.get("ButtonPayload")'), "yaad-inbound no longer reads the button payload");
  assert(src.includes("inboundText(buttonPayload, f.get(\"Body\"))"),
    "yaad-inbound no longer routes the payload through the tested rule");
  assert(src.includes("wasTapped(buttonPayload)"), "the trace no longer records whether it was a tap");
});
