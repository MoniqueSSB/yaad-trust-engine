// Twilio's own signing algorithm, run against a throwaway test token rather
// than production's, because nobody building this holds TWILIO_AUTH_TOKEN
// to fire a genuinely signed request at the live function. The algorithm
// needs no production secret to prove correct: sign a request the same way
// Twilio does, with a test secret, and check this function agrees. The
// first real worker photo to the live number is still the end-to-end
// proof; this is the proof that the check underneath it is not broken.
//
// Run: deno test supabase/functions/yaad-inbound/twilio-signature_test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import { checkTwilioSignature } from "./twilio-signature.ts";

const TOKEN = "test-token-not-a-real-one";
const SUPABASE_URL = "https://leffyisvfvjwzilydlwf.supabase.co";
const FN_URL = `${SUPABASE_URL}/functions/v1/yaad-inbound`;

const PARAMS: Record<string, string> = {
  From: "whatsapp:+18765551234",
  Body: "JOB-0042",
  NumMedia: "1",
  MediaUrl0: "https://api.twilio.com/media/x",
};
const RAW = new URLSearchParams(PARAMS).toString();

/** The exact algorithm Twilio uses to sign a request, reimplemented here
 *  independently of twilio-signature.ts, so the test is not just checking
 *  the function against itself. */
async function sign(url: string, params: Record<string, string>, token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  let msg = url;
  for (const k of Object.keys(params).sort()) msg += k + params[k];
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function req(url: string, signature: string | null): Request {
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
  if (signature !== null) headers.set("x-twilio-signature", signature);
  return new Request(url, { method: "POST", headers, body: RAW });
}

Deno.test("a correctly signed request checks out", async () => {
  const signature = await sign(FN_URL, PARAMS, TOKEN);
  const r = await checkTwilioSignature(req(FN_URL, signature), RAW, TOKEN, SUPABASE_URL);
  assertEquals(r, { ok: true, checked: true });
});

Deno.test("a signature made with the wrong token is refused", async () => {
  const signature = await sign(FN_URL, PARAMS, "attacker-does-not-have-the-real-token");
  const r = await checkTwilioSignature(req(FN_URL, signature), RAW, TOKEN, SUPABASE_URL);
  assertEquals(r, { ok: false, checked: true });
});

Deno.test("tampering with the body after signing is refused, real-looking signature or not", async () => {
  const signature = await sign(FN_URL, PARAMS, TOKEN);
  const tamperedRaw = new URLSearchParams({ ...PARAMS, Body: "JOB-0099" }).toString();
  const r = await checkTwilioSignature(req(FN_URL, signature), tamperedRaw, TOKEN, SUPABASE_URL);
  assertEquals(r, { ok: false, checked: true });
});

Deno.test("a missing signature header is refused, not skipped", async () => {
  const r = await checkTwilioSignature(req(FN_URL, null), RAW, TOKEN, SUPABASE_URL);
  assertEquals(r, { ok: false, checked: true });
});

Deno.test("a trailing slash on the URL Twilio was configured with still matches", async () => {
  const signature = await sign(`${FN_URL}/`, PARAMS, TOKEN);
  const r = await checkTwilioSignature(req(FN_URL, signature), RAW, TOKEN, SUPABASE_URL);
  assertEquals(r, { ok: true, checked: true });
});

Deno.test("no token configured means unchecked, not refused", async () => {
  // The deliberate fail-open this repo has always had: it lets the endpoint
  // be wired up and proven before every secret exists. Once a real
  // TWILIO_AUTH_TOKEN is set, this branch is never taken again.
  const signature = await sign(FN_URL, PARAMS, TOKEN);
  const r = await checkTwilioSignature(req(FN_URL, signature), RAW, "", SUPABASE_URL);
  assertEquals(r, { ok: true, checked: false });
});

/* ── the gate stays wired ─────────────────────────────────────────────────
   Proves index.ts is actually running this file's logic rather than a
   second copy of its own that has quietly drifted from it. */
const inboundSource = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("yaad-inbound uses this signature check rather than its own copy", () => {
  assert(inboundSource.includes('from "./twilio-signature.ts"'), "yaad-inbound no longer imports twilio-signature.ts");
  assert(!/const candidates = \[/.test(inboundSource), "yaad-inbound has grown its own copy of the candidate-URL logic again");

  /* The module above may report "nothing was verified"; index.ts is what
     decides that a Twilio request in that state does not get in. Added 3 Sep
     2026. The assertion lives here rather than in the module's own tests
     because the module's contract is deliberately unchanged: it reports a
     fact, the caller sets the policy. If this fails, the fail-open has come
     back at the only place it ever mattered. */
  assert(
    /isTwilio && !sig\.checked/.test(inboundSource),
    "yaad-inbound no longer refuses a Twilio request it could not verify",
  );
});
