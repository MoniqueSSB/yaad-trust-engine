/* ── wa-window.ts ─────────────────────────────────────────────────────────
 *
 * Is this person inside WhatsApp's 24 hour window, read BEFORE sending.
 *
 * WhatsApp only delivers ordinary text inside 24 hours of the person's own
 * last message. Outside it, Twilio accepts the send and it fails later as
 * 63016, after the sending function has returned, so nothing that looks at
 * the send result ever sees the failure. Every free text message a worker
 * was sent days after they last wrote failed that way, silently.
 *
 * Moved here from yaad-notify-client/worker-template.ts on 30 Sep 2026, so
 * yaad-job-health reads the window by the same rule instead of a second copy
 * of it. worker-template.ts re-exports these, so its tests still hold.
 *
 * Pure apart from lastInboundInWindow(), which only reads.
 */

/** Inside WhatsApp's window, with an hour's margin so a send that takes a
 *  moment is not the one that lands a minute late. */
export const WINDOW_MS = 23 * 3600_000;

export function insideWindow(lastInboundIso: string | null, now = Date.now()): boolean {
  if (!lastInboundIso) return false;
  const t = new Date(lastInboundIso).getTime();
  return Number.isFinite(t) && now - t < WINDOW_MS;
}

/** Two numbers are the same phone when their digits agree on the last ten.
 *  wa_inbound_seen holds "+44..." and "1876..." side by side. */
export function samePhoneDigits(a: string, b: string): boolean {
  const x = String(a ?? "").replace(/\D/g, "");
  const y = String(b ?? "").replace(/\D/g, "");
  if (x.length < 7 || y.length < 7) return false;
  return x.slice(-10) === y.slice(-10);
}

/** True inside the window, false outside it, null when it could not be read.
 *  Null is not "outside": a failed read leaves the caller doing what it did
 *  before this existed, rather than skipping a message that would have gone. */
// deno-lint-ignore no-explicit-any
export async function lastInboundInWindow(admin: any, phone: string, now = Date.now()): Promise<boolean | null> {
  try {
    const { data: seen, error } = await admin.from("wa_inbound_seen")
      .select("from_addr, seen_at").eq("channel", "whatsapp")
      .gte("seen_at", new Date(now - WINDOW_MS).toISOString())
      .order("seen_at", { ascending: false }).limit(500);
    if (error) return null;
    const last = (seen ?? []).find((r: { from_addr: string }) => samePhoneDigits(r.from_addr, phone));
    return insideWindow(last?.seen_at ?? null, now);
  } catch (_) {
    return null;
  }
}

/** An approved Content Template's SID, from its secret or else from the
 *  setting yaad-twilio-setup writes only once Meta has approved it. Empty
 *  means not approved, and nothing should be sent through it. */
// deno-lint-ignore no-explicit-any
export async function approvedTemplateSid(admin: any, envName: string, settingKey: string): Promise<string> {
  let sid = Deno.env.get(envName) ?? "";
  if (!sid) {
    try {
      const { data: st } = await admin.from("app_settings").select("value").eq("key", settingKey).maybeSingle();
      try { sid = String(JSON.parse(String(st?.value ?? '""'))); } catch (_) { sid = String(st?.value ?? ""); }
    } catch (_) { sid = ""; }
  }
  return /^HX[0-9a-f]{32}$/i.test(sid) ? sid : "";
}
