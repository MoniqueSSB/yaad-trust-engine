// Proves the pure parts of the website chat door: the token shape that is
// allowed to become an intake_threads key, the origins the widget may post
// from, the reference the WhatsApp lane adopts, and that the web holding
// reply passes the same banned-language screen every other reply does.
//
// Run: deno test supabase/functions/yaad-inbound/web-chat_test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  originAllowed, visitorTokenOk, webReferenceIn, WEB_SAFE_FALLBACK,
} from "./web-chat.ts";
import { scan } from "./guardrails.ts";

Deno.test("a visitor token is lowercase hex, 24 to 64 characters", () => {
  assert(visitorTokenOk("0123456789abcdef0123456789abcdef"));
  assert(visitorTokenOk("a".repeat(24)));
  assert(visitorTokenOk("f".repeat(64)));
});

Deno.test("anything that could be a person's text is not a visitor token", () => {
  assert(!visitorTokenOk("+447700900000"));
  assert(!visitorTokenOk("sonia@example.com"));
  assert(!visitorTokenOk("0123456789ABCDEF0123456789ABCDEF"), "uppercase is refused, the widget never mints it");
  assert(!visitorTokenOk("abc"));
  assert(!visitorTokenOk("g".repeat(32)), "not hex");
  assert(!visitorTokenOk("a".repeat(65)));
  assert(!visitorTokenOk(""));
  assert(!visitorTokenOk(undefined));
  assert(!visitorTokenOk(42));
});

Deno.test("only the site and the local static server may post", () => {
  assert(originAllowed("https://yaadly.co.uk"));
  assert(originAllowed("https://www.yaadly.co.uk"));
  assert(originAllowed("HTTPS://YAADLY.CO.UK"));
  assert(originAllowed("http://localhost:8932"));
  assert(!originAllowed("https://app.yaadly.co.uk"), "the app has its own doors");
  assert(!originAllowed("https://yaadly.co.uk.evil.example"));
  assert(!originAllowed("http://yaadly.co.uk"), "plain http to the live site is not the live site");
  assert(!originAllowed(null));
  assert(!originAllowed(""));
});

Deno.test("a web reference is found in a WhatsApp opener, and normalised", () => {
  assertEquals(webReferenceIn("Hello Yaadly, my web chat reference is JOB-WEB-1788400000123."), "JOB-WEB-1788400000123");
  assertEquals(webReferenceIn("ref job-web-1788400000123 pls"), "JOB-WEB-1788400000123");
});

Deno.test("other job codes are not web references", () => {
  assertEquals(webReferenceIn("JOB-WA-1788400000123"), null);
  assertEquals(webReferenceIn("JOB-0042"), null);
  assertEquals(webReferenceIn("JOB-WEB-12"), null, "too short to be one of ours");
  assertEquals(webReferenceIn("nothing here"), null);
});

Deno.test("the web holding reply passes the banned-language screen", () => {
  assertEquals(scan(WEB_SAFE_FALLBACK), []);
  assert(!/[\u2010-\u2015]/.test(WEB_SAFE_FALLBACK), "no dashes");
});
