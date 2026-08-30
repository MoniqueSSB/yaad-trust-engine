/**
 * HMAC signature check for inbound machine to machine webhooks.
 *
 * Split out from the route handler on purpose: this is the part that decides
 * whether a request is genuine, so it should be readable on its own and
 * testable without standing up an HTTP server.
 *
 * THE SCHEME. The sender computes:
 *
 *     signature = hex(HMAC_SHA256(secret, `${timestamp}.${rawBody}`))
 *
 * and sends it as x-yaadly-signature, with the unix timestamp in seconds as
 * x-yaadly-timestamp. This is the shape Stripe and most others use, so
 * whichever payment rail Yaadly ends up on, the receiving side already fits.
 *
 * WHY THE TIMESTAMP IS INSIDE THE HMAC. Signing only the body means a captured
 * request stays valid forever, and anyone who ever sees one can replay "payment
 * confirmed" whenever they like. Signing timestamp and body together, then
 * refusing anything outside a short window, bounds that to the window. The
 * timestamp has to be inside the signed material, otherwise an attacker just
 * edits the header.
 *
 * RAW BODY, NOT PARSED JSON. The signature covers the exact bytes that were
 * sent. Parsing and re-serialising changes key order and whitespace, and the
 * HMAC then never matches.
 */

const encoder = new TextEncoder();

export type SignatureResult =
  | { ok: true }
  | { ok: false; reason: "missing_signature" | "missing_timestamp" | "bad_timestamp" | "stale" | "mismatch" };

/**
 * Compare without leaking where two values start to differ.
 *
 * `a === b` on a string returns as soon as it finds a difference, so how long
 * it takes depends on how much of the prefix was right. Given enough attempts
 * that is enough to reconstruct a valid signature one character at a time.
 * This always walks the whole length.
 *
 * Length is compared first and does leak, but the length of a SHA-256 hex
 * digest is 64 and public anyway.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyWebhookSignature(opts: {
  secret: string;
  rawBody: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  toleranceSeconds?: number;
  nowMs?: number;
}): Promise<SignatureResult> {
  const { secret, rawBody, signatureHeader, timestampHeader } = opts;
  const toleranceSeconds = opts.toleranceSeconds ?? 300;
  const nowMs = opts.nowMs ?? Date.now();

  if (!signatureHeader) return { ok: false, reason: "missing_signature" };
  if (!timestampHeader) return { ok: false, reason: "missing_timestamp" };

  const ts = Number(timestampHeader);
  if (!Number.isInteger(ts) || ts <= 0) return { ok: false, reason: "bad_timestamp" };

  // Both directions. A clock ahead of ours is as suspicious as one behind, and
  // a far future timestamp would otherwise mint a signature valid for years.
  const skewSeconds = Math.abs(nowMs / 1000 - ts);
  if (skewSeconds > toleranceSeconds) return { ok: false, reason: "stale" };

  // Some senders prefix the scheme. Accept "sha256=..." as well as bare hex.
  const provided = signatureHeader.replace(/^sha256=/i, "").trim().toLowerCase();
  const expected = await hmacSha256Hex(secret, `${ts}.${rawBody}`);

  return timingSafeEqualHex(provided, expected) ? { ok: true } : { ok: false, reason: "mismatch" };
}
