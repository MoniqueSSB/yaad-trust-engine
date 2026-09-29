/* ── yaad-addon-pdf ─────────────────────────────────────────────────────────
 *
 * One revision of an add-on (extra work on a booked job, 20260928235000) as a
 * PDF, for WhatsApp. Founder, 28 Sep 2026: the add-on "should be able to be
 * viewed on WhatsApp if possible so the client can confirm, edits only done
 * in portal".
 *
 * THE TOKEN IS THE ONLY DOOR. Runs with --no-verify-jwt, because Twilio
 * fetches a WhatsApp attachment with no session, and so does a client tapping
 * the link in an email. The link is ?a=<add-on>&r=<revision>&t=<hmac>, signed
 * by yaad-notify-client with the service role key (_shared/addon-link.ts). A
 * wrong token, an unknown add-on and a missing one all get the same "not
 * valid" page, so it cannot be used to learn which add-ons exist.
 *
 * ONE REVISION PER LINK. If the add-on has been changed since, the old link
 * says so and shows nothing, so a client is never shown words different from
 * the message that carried the link.
 *
 * WHAT IT NEVER DOES. It reads only. Accepting is a WhatsApp reply handled by
 * yaad-inbound (agree_addon_via_whatsapp) or a button in the portal; any
 * change is the portal. CLAUDE.md §2, §3.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { httpAttrs, SpanKind, Trace } from "./otel.ts";
import { verifyAddonPdfToken } from "./addon-link.ts";
import { addonPdf, type AddonForPdf, type JobForPdf } from "./pdf.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL = Deno.env.get("YAAD_APP_URL") ?? "https://app.yaadly.co.uk";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function page(title: string, message: string, status: number): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · Yaadly</title>
<style>body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;background:#0d0d28;color:#f1f0fa;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{max-width:480px;width:100%;background:#16163a;border:1px solid #2c2c5c;border-radius:18px;padding:28px}
.mark{font-weight:800;letter-spacing:.04em;color:#c9a227;margin-bottom:14px}h1{font-size:21px;margin:0 0 10px}p{margin:0;color:#c9c8e0}</style></head>
<body><div class="card"><div class="mark">YAADLY.</div><h1>${esc(title)}</h1><p>${esc(message)}</p></div></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

Deno.serve(async (req: Request) => {
  const trace = new Trace("yaad-addon-pdf", req);
  const root = trace.startSpan(`${req.method} /yaad-addon-pdf`, SpanKind.SERVER, httpAttrs(req));
  const finish = (r: Response) => {
    root.setAttributes({ "http.response.status_code": r.status });
    root.end(); trace.flush();
    return r;
  };
  const notValid = () => finish(page("This link is not valid", "Please use the link as it was sent, or open your job on app.yaadly.co.uk.", 404));

  if (req.method !== "GET" && req.method !== "HEAD") return finish(page("Not available", "Open the link from your message.", 405));
  if (!SUPABASE_URL || !SERVICE_KEY) return finish(page("Not available right now", "Please try again later, or open your job on app.yaadly.co.uk.", 500));

  try {
    const u = new URL(req.url);
    const id = (u.searchParams.get("a") ?? "").trim();
    const rev = Number(u.searchParams.get("r") ?? "");
    const token = (u.searchParams.get("t") ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isInteger(rev) || !(await verifyAddonPdfToken(id, rev, token, SERVICE_KEY))) {
      return notValid();
    }
    root.setAttributes({ "yaadly.addon.id": id, "yaadly.addon.rev": rev });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: a } = await admin.from("job_addons")
      .select("id, job_id, rev, scope, amount_jmd, terms, status, last_edit_side, confirm_code, updated_at, agreed_at")
      .eq("id", id).maybeSingle();
    if (!a) return notValid();
    if (a.rev !== rev) {
      return finish(page("This version has been replaced",
        "The extra work was changed after this link was sent. Open your job on app.yaadly.co.uk to see the latest version.", 410));
    }
    const { data: job } = await admin.from("jobs").select("id, title, parish").eq("id", a.job_id).maybeSingle();
    if (!job) return notValid();

    const bytes = await addonPdf(a as AddonForPdf, job as JobForPdf, `${APP_URL}/portal/jobs/${encodeURIComponent(job.id)}?tab=extra`);
    return finish(new Response(req.method === "HEAD" ? null : new Blob([bytes as BlobPart], { type: "application/pdf" }), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Add-on ${job.id} v${a.rev}.pdf"`,
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    }));
  } catch (e) {
    root.setAttributes({ "yaadly.error": String((e as Error)?.message ?? e) });
    return finish(page("Not available right now", "Please try again later, or open your job on app.yaadly.co.uk.", 500));
  }
});
