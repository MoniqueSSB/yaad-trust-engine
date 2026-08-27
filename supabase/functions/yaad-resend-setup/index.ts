import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// A one-shot helper for wiring Resend inbound.
//
// It exists because the API key lives here, on the server, and should stay
// here. Rather than anyone reading the key out to configure a domain by hand,
// this asks Resend what it wants and reports back only the DNS records, which
// are public information the moment they are in DNS anyway.
//
// Gated on the same cron secret the purge uses, so finding the URL is not
// enough to enumerate somebody's domains.

const KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const CRON = Deno.env.get("YAAD_CRON_SECRET") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!KEY) return json({ error: "RESEND_API_KEY is not set on this project." }, 500);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (!CRON || String(body.secret ?? "") !== CRON) return json({ error: "Admin only." }, 403);

  const call = async (path: string, init?: RequestInit) => {
    const r = await fetch(`https://api.resend.com${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(20000),
    });
    const text = await r.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch (_) { /* keep raw */ }
    return { status: r.status, ok: r.ok, body: parsed };
  };

  const action = String(body.action ?? "list");

  // Shape only, never the value. Enough to tell a truncated paste from a
  // wrong key from a key with quotes baked into it, without the secret
  // leaving the server or appearing in a log.
  if (action === "shape") {
    const looksResend = /^re_[A-Za-z0-9_-]+$/.test(KEY);
    return json({
      length: KEY.length,
      startsWith: KEY.slice(0, 3),
      endsWithVisible: KEY.length > 4 ? KEY.slice(-2) : "",
      hasWhitespace: /\s/.test(KEY),
      hasQuotes: /["']/.test(KEY),
      matchesResendFormat: looksResend,
      expectedRoughly: "re_ plus about 30 to 40 characters, no spaces, no quotes",
    });
  }

  if (action === "list") {
    return json(await call("/domains"));
  }

  if (action === "get") {
    const id = String(body.domainId ?? "");
    if (!id) return json({ error: "domainId is needed." }, 400);
    return json(await call(`/domains/${id}`));
  }

  // Whatever Resend calls the receiving switch, try the documented shapes and
  // report exactly what each one said rather than guessing which worked.
  if (action === "enable-receiving") {
    const id = String(body.domainId ?? "");
    if (!id) return json({ error: "domainId is needed." }, 400);
    const attempts: Record<string, unknown> = {};
    attempts["PATCH /domains/{id} receiving:true"] =
      await call(`/domains/${id}`, { method: "PATCH", body: JSON.stringify({ receiving: true }) });
    attempts["POST /domains/{id}/receiving"] =
      await call(`/domains/${id}/receiving`, { method: "POST", body: "{}" });
    attempts["after: GET /domains/{id}"] = await call(`/domains/${id}`);
    return json(attempts);
  }

  // Resend re-checks DNS on request. Without this you wait for whatever
  // polling interval they use, staring at a record that is already correct.
  if (action === "verify") {
    const id = String(body.domainId ?? "");
    if (!id) return json({ error: "domainId is needed." }, 400);
    const kicked = await call(`/domains/${id}/verify`, { method: "POST", body: "{}" });
    await new Promise((r) => setTimeout(r, 4000));
    const after = await call(`/domains/${id}`);
    return json({ kicked, after });
  }

  if (action === "webhooks") {
    return json(await call("/webhooks"));
  }

  return json({ error: "Unknown action." }, 400);
});
