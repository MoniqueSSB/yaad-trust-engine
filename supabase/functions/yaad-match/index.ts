// =====================================================================
// yaad-match — tell the right vetted workers a job just went live.
//
// Deploy with verify_jwt = true. Two callers are expected:
//   1. the admin desk, with Monique's JWT  -> is_admin() must pass
//   2. yaad-website-intake / a DB trigger, with the service-role key
//      -> recognised by the x-yaad-internal header + service role JWT
//
// Sends nothing it has already sent. The unique index on job_alerts is
// the guarantee, not this code — a retry after a crash is safe.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY   = Deno.env.get("RESEND_API_KEY") ?? "";       // optional
// Must be an address on a domain Resend has verified for SENDING, which is
// in.yaadly.co.uk. monique@yaadly.co.uk is where mail comes IN, on names.co.uk,
// and Resend refuses to send from a domain it does not hold. send.yaadly.co.uk
// still shows as verified there but its DKIM and SPF records are gone from
// DNS, so anything from it fails authentication and lands in spam silently.
const FROM_EMAIL   = Deno.env.get("YAAD_FROM_EMAIL") ?? "jobs@in.yaadly.co.uk";
const SITE         = Deno.env.get("YAAD_SITE") ?? "https://yaadly.co.uk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-yaad-internal",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

type Match = {
  worker_email: string;
  name: string;
  trade: string | null;
  parish: string | null;
  jobs_done: number;
  match_reason: string;
  rank_score: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // ---- who is calling -------------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const internal = req.headers.get("x-yaad-internal") === "1" && token === SERVICE_KEY;

  if (!internal) {
    // A real user. They must be an admin.
    const asUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: isAdmin, error: adminErr } = await asUser.rpc("is_admin");
    if (adminErr || isAdmin !== true) return json({ error: "not permitted" }, 403);
  }

  // ---- input ----------------------------------------------------------
  let body: { job_id?: string; limit?: number; dry_run?: boolean };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const jobId = (body.job_id ?? "").trim();
  if (!jobId) return json({ error: "job_id required" }, 400);
  const limit  = Math.min(Math.max(body.limit ?? 25, 1), 100);
  const dryRun = body.dry_run === true;

  // ---- the job, and whether it is genuinely open -----------------------
  const { data: job, error: jobErr } = await admin
    .from("jobs")
    .select("id, title, parish, trade, open, stage, worker_email, status")
    .eq("id", jobId)
    .maybeSingle();

  if (jobErr) return json({ error: "job lookup failed", detail: jobErr.message }, 500);
  if (!job)   return json({ error: "no such job" }, 404);

  if (!job.open || job.stage !== 0 || (job.worker_email ?? "") !== "") {
    return json({ error: "job is not open for matching", job_id: jobId, status: job.status }, 409);
  }
  if (!job.trade) {
    // Loud on purpose. A job with no trade can only match on parish, which
    // is how you spam a plumber about a roof.
    return json({ error: "job has no trade set — matching would be parish-only", job_id: jobId }, 422);
  }

  // ---- who should hear about it ---------------------------------------
  const { data: matches, error: matchErr } = await admin
    .rpc("match_workers_for_job", { p_job: jobId, p_limit: limit });

  if (matchErr) return json({ error: "match failed", detail: matchErr.message }, 500);
  const list = (matches ?? []) as Match[];

  if (dryRun) {
    return json({ ok: true, dry_run: true, job_id: jobId, would_alert: list.length, matches: list });
  }
  if (list.length === 0) {
    return json({ ok: true, job_id: jobId, alerted: 0, note: "nobody new to tell" });
  }

  // ---- ntfy topic ------------------------------------------------------
  const { data: setting } = await admin
    .from("app_settings").select("value").eq("key", "ntfy_topic").maybeSingle();
  const ntfyTopic = setting?.value ?? "";

  // Nothing personal in the notification body. Reference, trade, parish.
  const area  = job.parish ?? "Jamaica";
  const short = `${job.trade} · ${area}`;
  const link  = `${SITE}/#market`;

  const results: { worker_email: string; channel: string; status: string; detail?: string }[] = [];

  for (const w of list) {
    // ---- ntfy ---------------------------------------------------------
    if (ntfyTopic) {
      try {
        const r = await fetch(`https://ntfy.sh/${ntfyTopic}`, {
          method: "POST",
          headers: {
            "Title": `New ${job.trade} job — ${area}`,
            "Tags": "hammer",
            "Click": link,
          },
          body: `${jobId} · ${short}\nQuoting is free. Open the board to see it.`,
        });
        results.push({ worker_email: w.worker_email, channel: "ntfy", status: r.ok ? "sent" : "failed", detail: r.ok ? undefined : `http ${r.status}` });
      } catch (e) {
        results.push({ worker_email: w.worker_email, channel: "ntfy", status: "failed", detail: String(e) });
      }
    }

    // ---- email ---------------------------------------------------------
    if (RESEND_KEY) {
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: `Yaadly <${FROM_EMAIL}>`,
            to: [w.worker_email],
            subject: `New ${job.trade} job in ${area} — ${jobId}`,
            text:
`${w.name},

A new job just opened on the board that matches your trade and your area.

  ${jobId} — ${job.title ?? short}
  ${short}

Quoting is free and always will be. You are never charged to see a job,
to quote for one, or for a lead you did not win.

Open the board: ${link}

You are getting this because ${w.match_reason} matched your published profile.
`,
          }),
        });
        results.push({ worker_email: w.worker_email, channel: "email", status: r.ok ? "sent" : "failed", detail: r.ok ? undefined : `http ${r.status}` });
      } catch (e) {
        results.push({ worker_email: w.worker_email, channel: "email", status: "failed", detail: String(e) });
      }
    } else {
      results.push({ worker_email: w.worker_email, channel: "email", status: "skipped", detail: "RESEND_API_KEY not set" });
    }
  }

  // ---- record it. upsert, because the unique index is the dedupe. ------
  const rows = results.map((r) => ({
    job_id: jobId,
    worker_email: r.worker_email,
    channel: r.channel,
    status: r.status,
    detail: r.detail ?? null,
  }));

  const { error: insErr } = await admin
    .from("job_alerts")
    .upsert(rows, { onConflict: "job_id,worker_email,channel", ignoreDuplicates: true });

  if (insErr) {
    // The alerts went out. Say so loudly rather than pretending they did not.
    return json({
      ok: false,
      job_id: jobId,
      alerted: results.filter((r) => r.status === "sent").length,
      warning: "alerts sent but not all were recorded — a retry could double-send",
      detail: insErr.message,
    }, 207);
  }

  return json({
    ok: true,
    job_id: jobId,
    matched: list.length,
    alerted: results.filter((r) => r.status === "sent").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    channels: { ntfy: !!ntfyTopic, email: !!RESEND_KEY },
  });
});
