// The link to one revision of an add-on as a PDF (20260928235000).
//
// Founder, 28 Sep 2026: the add-on should be viewable on WhatsApp "so the
// client can confirm, edits only done in portal". Twilio fetches a WhatsApp
// attachment from a public URL, so the PDF is served by yaad-addon-pdf with no
// sign-in, and this token is the only door: an HMAC of the add-on id and its
// revision under the service role key, the same shape as the pay link
// (_shared/stripe.ts) with its own context string so neither token can be
// passed off as the other. A link names one revision; once the add-on is
// changed, the old link says so instead of showing the new words.

const CONTEXT = "yaadly-addon-pdf:";

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function addonPdfToken(addonId: string, rev: number, secret: string): Promise<string> {
  if (!secret) throw new Error("No secret to sign an add-on link with.");
  if (!addonId || !Number.isInteger(rev) || rev < 1) throw new Error("No add-on revision to sign.");
  return (await hmacHex(secret, `${CONTEXT}${addonId}:${rev}`)).slice(0, 32);
}

export async function verifyAddonPdfToken(addonId: string, rev: number, token: string, secret: string): Promise<boolean> {
  if (!secret || !addonId || !Number.isInteger(rev) || rev < 1 || !/^[0-9a-f]{32}$/.test(token)) return false;
  const want = await addonPdfToken(addonId, rev, secret);
  let diff = want.length ^ token.length;
  for (let i = 0; i < Math.min(want.length, token.length); i++) diff |= want.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export async function addonPdfUrl(supabaseUrl: string, addonId: string, rev: number, secret: string): Promise<string> {
  const t = await addonPdfToken(addonId, rev, secret);
  return `${supabaseUrl}/functions/v1/yaad-addon-pdf?a=${encodeURIComponent(addonId)}&r=${rev}&t=${t}`;
}
