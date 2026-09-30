// The 72 hour nudge reads the 24 hour window before sending. 30 Sep 2026.
import { assert } from "jsr:@std/assert@1";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("the nudge is never free text outside the window", () => {
  const at = src.indexOf("const inWindow = await lastInboundInWindow(admin, phone);");
  assert(at > 0, "the window is not read before the nudge");
  const block = src.slice(at, src.indexOf("root.setAttributes", at));
  assert(/if \(inWindow === false\) \{[\s\S]*ContentSid|sid: quietSid|recordNotSent/.test(block), "outside the window must go by template or be recorded as not sent");
  const outside = block.slice(0, block.indexOf("} else {\n            await sendTwilioWhatsApp(phone, nudgeText"));
  assert(!outside.includes("nudgeText("), "free text is sent outside the window");
  assert(block.includes("recordNotSent("), "a nudge with no template is not visible to the desk");
});

Deno.test("the nudge asks, and does not make the check-in a requirement", () => {
  const at = src.indexOf("function nudgeText(");
  const text = src.slice(at, src.indexOf("\n}", at));
  assert(!/check in/i.test(text), "the nudge asks for a check-in, which is optional");
  assert(/Reply here/.test(text), "the nudge does not say what a reply does");
  assert(!/[\u2013\u2014]/.test(src.slice(at, at + 1200)), "no dashes");
});
