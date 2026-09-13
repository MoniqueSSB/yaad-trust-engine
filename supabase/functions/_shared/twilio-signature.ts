/* Moved into _shared/ on 4 September 2026, when yaad-message-status became the
 * second function to verify a Twilio signature. Before that it lived in
 * yaad-inbound alone, which was right while there was one caller and wrong the
 * moment there were two: nothing in CI compares a hand-copied file against its
 * original, so the second copy could have drifted from the first in silence,
 * and this is the check standing in front of endpoints that run with
 * --no-verify-jwt. In _shared it is copied by sync-shared.sh and the build
 * fails if the copies ever differ.
 */
/* ── twilio-signature.ts ──────────────────────────────────────────────────
 *
 * Pulled out of index.ts so this one check can be run by a test with a
 * throwaway secret, rather than only ever by a real signed message from
 * Twilio. index.ts calls Deno.serve() at module load, so importing it
 * directly for a test would start a live server; this file has no such
 * side effect and nothing in it reads an environment variable.
 *
 * Twilio signs with HMAC-SHA1 over the full URL it posted to, plus every
 * POST param sorted by key and concatenated key+value with nothing between
 * them. https://www.twilio.com/docs/usage/security#validating-requests
 */

async function hmacSha1(keyBytes: Uint8Array, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", keyBytes as unknown as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return new Uint8Array(sig);
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

async function signFor(url: string, sorted: string[], params: URLSearchParams, key: Uint8Array): Promise<string> {
  let msg = url;
  for (const k of sorted) msg += k + params.get(k);
  return b64(await hmacSha1(key, msg));
}

/**
 * Checks a request's `X-Twilio-Signature` header against the token, the form
 * body, and the URL Twilio was actually configured to post to.
 *
 * `checked: false` means no token was passed in, so nothing was verified.
 * That is a deliberate fail-open, the same one index.ts always had: it lets
 * this be wired up and proven before every secret exists. Once a real
 * TWILIO_AUTH_TOKEN is passed in, an unsigned or wrongly signed request is
 * refused.
 */
export async function checkTwilioSignature(
  req: Request,
  raw: string,
  token: string,
  supabaseUrl: string,
): Promise<{ ok: boolean; checked: boolean }> {
  if (!token) return { ok: true, checked: false };
  const offered = req.headers.get("x-twilio-signature") ?? "";
  if (!offered) return { ok: false, checked: true };

  const params = new URLSearchParams(raw);
  const sorted = [...params.keys()].sort();
  const key = new TextEncoder().encode(token);

  // Twilio signs the URL it posted to. Inside the edge runtime `req.url` is
  // NOT that URL: it comes through as
  //   http://<ref>.supabase.co/yaad-inbound
  // with the scheme downgraded and the /functions/v1 prefix stripped by the
  // gateway. Signing over it rejects every genuine Twilio message with a
  // 403, and the only way to notice is to send a correctly signed request,
  // because a forged one is refused either way and looks like the check
  // working.
  //
  // So the public URL is rebuilt from supabaseUrl and checked candidate by
  // candidate, keeping `req.url` itself as a candidate for local dev where
  // it is the real one. Twilio also signs whatever is typed into its own
  // console, so a trailing slash gets its own candidate rather than a
  // support ticket.
  const slug = new URL(req.url).pathname.replace(/^\/+/, "").replace(/^functions\/v1\//, "");
  const base = supabaseUrl.replace(/\/+$/, "");
  const candidates = [
    `${base}/functions/v1/${slug}`,
    `${base}/functions/v1/${slug}/`,
    req.url,
  ];

  for (const url of candidates) {
    if (offered === await signFor(url, sorted, params, key)) return { ok: true, checked: true };
  }
  return { ok: false, checked: true };
}
