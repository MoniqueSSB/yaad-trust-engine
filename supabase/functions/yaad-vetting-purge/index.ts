import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

// The deletion clock for vetting documents.
//
// Holding a government ID scan and a police record check forever is a
// liability, not an asset, under UK GDPR and the Jamaican Data Protection
// Act. The useful artefact is the decision, not the document.
//
// So this destroys the file and keeps the row. Afterwards the record still
// says who was checked, by whom, when, and what they decided; it just can no
// longer produce the passport. If an insurer or a dispute ever asks, "verified
// on this date by this person, and we did not retain the document longer than
// our policy allows" is a stronger answer than handing over the scan.
//
// Idempotent: rows already purged are skipped, and a file that has already
// gone is treated as done rather than as an error.
//
// Meant to be called on a schedule. Admin-gated so it cannot be triggered by
// anyone who finds the URL.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET  = Deno.env.get("YAAD_CRON_SECRET") ?? "";
const BUCKET = "vetting";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-vetting-purge", req);
  const root = trace.startSpan(`${req.method} /yaad-vetting-purge`, SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush(); return res;
  };
  const json = (b: unknown, status = 200) =>
    done(new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } }), status);

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Not configured." }, 500);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    // Either the scheduler's shared secret, or a signed-in admin.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const presented = String(body.secret ?? "");
    let allowed = Boolean(CRON_SECRET) && presented === CRON_SECRET;

    // The scheduler that actually runs this lives in Postgres, as a pg_cron
    // job calling out through pg_net. It has no access to this function's
    // environment, so it cannot be handed YAAD_CRON_SECRET.
    //
    // So it presents its own secret and this checks it against a SHA-256 HASH
    // held in app_settings. The database therefore stores nothing usable: the
    // only copy of the plaintext is inside the cron job definition, and the
    // cron schema is not exposed through PostgREST.
    if (!allowed && presented) {
      const { data: st } = await admin
        .from("app_settings").select("value")
        .eq("key", "purge_cron_secret_sha256").maybeSingle();
      const expected = String(st?.value ?? "").toLowerCase();
      if (expected) {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(presented));
        const got = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
        // Compared in constant time. A byte-at-a-time timing difference is a
        // slow way to guess a secret, but it is still a way.
        if (got.length === expected.length) {
          let diff = 0;
          for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
          allowed = diff === 0;
        }
      }
    }

    if (!allowed) {
      const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (jwt) {
        const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${jwt}` },
          body: "{}",
        });
        allowed = r.ok && (await r.json()) === true;
      }
    }
    if (!allowed) {
      root.setAttributes({ "yaadly.purge.outcome": "denied" });
      return json({ error: "Admin only." }, 403);
    }

    const { data: due, error } = await admin
      .from("vetting_documents")
      .select("id, storage_path, doc_type")
      .lte("purge_after", new Date().toISOString())
      .is("purged_at", null)
      .not("storage_path", "is", null)
      .limit(500);

    if (error) {
      root.recordError(error.message);
      return json({ error: error.message }, 500);
    }

    const rows = due ?? [];
    let destroyed = 0;
    for (const r of rows) {
      const { error: rmErr } = await admin.storage.from(BUCKET).remove([r.storage_path as string]);
      // A file that is already gone still counts: the point is that it is not
      // there any more, not that this run is the one that removed it.
      if (rmErr && !/not found/i.test(rmErr.message)) {
        root.recordError(`${r.storage_path}: ${rmErr.message}`);
        continue;
      }
      await admin.from("vetting_documents")
        .update({ storage_path: null, purged_at: new Date().toISOString() })
        .eq("id", r.id);
      destroyed++;
    }

    root.setAttributes({ "yaadly.purge.due": rows.length, "yaadly.purge.destroyed": destroyed });
    return json({ ok: true, due: rows.length, destroyed });
  } catch (e) {
    root.recordError(e);
    return json({ error: "Purge failed." }, 500);
  }
});
