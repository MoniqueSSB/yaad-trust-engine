import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";
import { pickTextProvider, providerAttrs, NO_PROVIDER_MESSAGE } from "./textmodel.ts";

// yaad-invoice
//
// The invoicing agent. It reads a sentence like "bill Marcia for August
// retainer and the extra visit to Portmore" and turns it into a numbered
// draft invoice against the real service catalogue.
//
// The single most important design decision in this file: the model is never
// given a field in which to put a price. Its JSON schema has no amount. It may
// only cite a catalogue id and a tier, and Postgres overwrites the amount from
// service_catalogue on write. Anything it cannot map comes back as an unpriced
// line that blocks the invoice from being sent until a human deals with it.
//
// The function never sends an invoice and never marks one paid. Both of those
// are human moves, and the second is refused by the database itself.

// Model and endpoint come from _shared/textmodel.ts. See that file for why.

const SYSTEM = `You are the Invoicing Agent for Yaadly Ltd, a UK company providing construction project management and oversight for property work in Jamaica. You read a short instruction from the founder and turn it into the lines of a draft invoice.

Return STRICT JSON only, no markdown fences, exactly this shape:
{"client_name":"","client_email":"","client_company":"","po_number":"","period_label":"","lines":[{"catalogue_id":"","description":"","qty":1,"tier":"founding"}],"covering_note":"","questions":[]}

Rules, all of them absolute:
1. You may NEVER state, calculate, estimate or imply an amount of money. There is no field for one. Do not put a number in a description.
2. "catalogue_id" MUST be copied character for character from the CATALOGUE list given below, or be the exact string "UNKNOWN" if the work described is not on that list.
3. "tier" is "founding" or "full". Use "founding" when the instruction says founding, founder price, first five, or names an existing founding client. Use "full" otherwise. If the item is UNKNOWN, set tier to "founding" and it will be ignored.
4. "qty" is a plain number. For a monthly retainer covering one month, qty is 1 and period_label says which month, for example "August 2026". For several site visits, qty is the number of visits.
5. "description" is what appears on the client's invoice: one clear line naming the service and, where it helps, the property or month. No prices, no promises about the quality of anyone's work, no legal or title language.
6. Never invent a client, a company name, or a PO number. If any of them are not in the instruction, leave that field empty. Only client name and email need a question raised for them; company and PO number are optional and simply stay blank.
7. "covering_note" is two or three warm, plain sentences to the client saying what this invoice covers and what happens next. British English. No em dashes or en dashes anywhere. Never promise an outcome, a date or a result.
8. "questions" lists anything a person must confirm before this is sent. Always add a question for every UNKNOWN line.

You draft. A named human checks and sends. You do not decide what anyone owes.`;

type CatalogueRow = {
  id: string; name: string; blurb: string;
  founding_pence: number | null; full_pence: number | null;
  recurring: boolean; unit_label: string;
};

function bearer(req: Request): string {
  return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
}

function claim(req: Request, key: string): string {
  try {
    const payload = JSON.parse(atob(bearer(req).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload[key] || "";
  } catch (_) { return ""; }
}

function env() {
  return {
    url: Deno.env.get("SUPABASE_URL")!,
    anon: Deno.env.get("SUPABASE_ANON_KEY")!,
  };
}

// Every database call goes out under the CALLER's token, so RLS is doing the
// access control and this function holds no service-role key.
async function db(req: Request, path: string, init: RequestInit = {}) {
  const { url, anon } = env();
  return await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: anon,
      Authorization: `Bearer ${bearer(req)}`,
      ...(init.headers || {}),
    },
  });
}

async function isAdmin(req: Request): Promise<boolean> {
  try {
    const r = await db(req, "rpc/is_admin", { method: "POST", body: "{}" });
    return r.ok && (await r.json()) === true;
  } catch (_) { return false; }
}

// Two currencies live on invoices now (20260901v): GBP for everything this
// function has always drafted, JMD for a marketplace job's own stage fee,
// raised in the job's own currency rather than inventing an FX rate and a
// rate policy here. J$ with no decimal places, matching how a Jamaican
// dollar figure reads everywhere else in this codebase (job_quotes.labour_jmd,
// the portal's own jmd() formatters) - GBP keeps its pence.
const money = (pence: number, currency = "GBP") =>
  currency === "JMD"
    ? "J$" + Math.round(pence).toLocaleString("en-JM")
    : "£" + (pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// --------------------------------------------------------------- render

function renderInvoice(inv: Record<string, any>, lines: Record<string, any>[], settings: Record<string, string>) {
  const unpriced = lines.filter((l) => l.price_source === "needs_price");
  const rows = lines.map((l) => `
      <tr${l.price_source === "needs_price" ? ' class="unpriced"' : ""}>
        <td>${esc(l.description)}${l.price_source === "needs_price" ? '<span class="flag">price not set</span>' : ""}</td>
        <td class="num">${Number(l.qty) % 1 === 0 ? Number(l.qty) : Number(l.qty).toFixed(2)}</td>
        <td class="num">${l.price_source === "needs_price" ? "&mdash;" : money(l.unit_amount_pence, inv.currency)}</td>
        <td class="num">${l.price_source === "needs_price" ? "&mdash;" : money(l.line_total_pence, inv.currency)}</td>
      </tr>`).join("");

  const dt = (d: string) =>
    new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(inv.id)} · ${esc(settings.invoice_issuer_name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root{ --teal:#14B8A6; --deep:#08110F; --line:#DCE6E2; --mute:#5E7772; --mango:#FFB020; }
  *{box-sizing:border-box}
  body{margin:0;padding:32px 20px;background:#F4F7F6;color:var(--deep);
       font:15px/1.55 'Space Grotesk',-apple-system,sans-serif}
  .sheet{max-width:760px;margin:0 auto;background:#fff;padding:44px 48px;
         border-radius:14px;box-shadow:0 2px 24px rgba(8,17,15,.08)}
  header{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;
         border-bottom:3px solid var(--teal);padding-bottom:22px}
  .mark{font-family:'Anton',Impact,sans-serif;font-size:34px;letter-spacing:.5px;line-height:1}
  .mark span{color:var(--teal)}
  .issuer{font-size:13px;color:var(--mute);margin-top:8px;white-space:pre-line}
  .title{text-align:right}
  .title h1{font-family:'Anton',Impact,sans-serif;font-weight:400;font-size:30px;margin:0;letter-spacing:1px}
  .ref{font-size:20px;font-weight:700;margin-top:4px}
  .status{display:inline-block;margin-top:8px;padding:3px 12px;border-radius:999px;
          font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;
          background:#E8F6F4;color:#0B7A6E}
  .status.draft{background:#FFF3DA;color:#8A5A00}
  .status.paid{background:#E4F5E6;color:#1B7A33}
  .status.void{background:#F0F0F0;color:#666;text-decoration:line-through}
  .meta{display:flex;justify-content:space-between;gap:32px;flex-wrap:wrap;margin:26px 0 8px}
  .meta h2{font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--mute);margin:0 0 6px}
  .meta p{margin:0;white-space:pre-line}
  table{width:100%;border-collapse:collapse;margin-top:26px}
  th{font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--mute);
     text-align:left;padding:0 0 8px;border-bottom:1px solid var(--line)}
  td{padding:13px 0;border-bottom:1px solid var(--line);vertical-align:top}
  th.num,td.num{text-align:right;white-space:nowrap;padding-left:16px}
  tr.unpriced td{color:#8A5A00;background:#FFFBF2}
  .flag{display:inline-block;margin-left:8px;padding:1px 8px;border-radius:999px;
        background:#FFE9B8;color:#8A5A00;font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase}
  .totals{margin-top:18px;margin-left:auto;width:min(300px,100%)}
  .totals div{display:flex;justify-content:space-between;padding:7px 0}
  .totals .grand{border-top:2px solid var(--deep);margin-top:6px;padding-top:12px;
                 font-family:'Anton',Impact,sans-serif;font-size:24px;letter-spacing:.5px}
  .note{margin-top:30px;padding:18px 20px;background:#F4F7F6;border-left:3px solid var(--teal);border-radius:0 8px 8px 0}
  .note h2{font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--mute);margin:0 0 8px}
  .note p{margin:0 0 8px}.note p:last-child{margin:0}
  .warn{margin-top:22px;padding:14px 18px;background:#FFFBF2;border:1px solid #FFE0A3;border-radius:8px;
        color:#8A5A00;font-size:13px}
  footer{margin-top:34px;padding-top:18px;border-top:1px solid var(--line);
         font-size:12px;color:var(--mute);line-height:1.7}
  @media print{ body{background:#fff;padding:0} .sheet{box-shadow:none;padding:0;max-width:none} }
</style></head>
<body><div class="sheet">
  <header>
    <div>
      <div class="mark">YAADLY<span>.</span></div>
      <div class="issuer">${esc(settings.invoice_issuer_name)}
Company number ${esc(settings.invoice_issuer_number)}
${esc(settings.invoice_issuer_address)}
${esc(settings.invoice_issuer_email)} · ${esc(settings.invoice_issuer_phone)}</div>
    </div>
    <div class="title">
      <h1>INVOICE</h1>
      <div class="ref">${esc(inv.id)}</div>
      <div class="status ${esc(inv.status)}">${esc(inv.status)}</div>
    </div>
  </header>

  <div class="meta">
    <div>
      <h2>Billed to</h2>
      <p>${esc(inv.client_name)}${inv.client_company ? "\n" + esc(inv.client_company) : ""}
${esc(inv.client_email)}${inv.client_address ? "\n" + esc(inv.client_address) : ""}</p>
    </div>
    <div>
      <h2>Issued</h2><p>${dt(inv.issue_date)}</p>
    </div>
    <div>
      <h2>Due</h2><p>${dt(inv.due_date)}</p>
    </div>
    ${inv.period_label ? `<div><h2>Period</h2><p>${esc(inv.period_label)}</p></div>` : ""}
    ${inv.po_number ? `<div><h2>PO number</h2><p>${esc(inv.po_number)}</p></div>` : ""}
  </div>

  <table>
    <thead><tr><th>Service</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div><span>Subtotal</span><span>${money(inv.subtotal_pence, inv.currency)}</span></div>
    <div><span>VAT</span><span>${esc(settings.invoice_vat_status)}</span></div>
    <div class="grand"><span>Total</span><span>${money(inv.total_pence, inv.currency)}</span></div>
  </div>

  ${unpriced.length ? `<div class="warn"><strong>Not ready to send.</strong> ${unpriced.length} line${unpriced.length > 1 ? "s have" : " has"} no price. The agent will not guess one. Price ${unpriced.length > 1 ? "them" : "it"} or remove ${unpriced.length > 1 ? "them" : "it"} first.</div>` : ""}

  ${inv.covering_note ? `<div class="note"><h2>Note</h2><p>${esc(inv.covering_note).replace(/\n/g, "</p><p>")}</p></div>` : ""}

  <footer>
    ${esc(settings.invoice_payment_terms)}<br>
    ${esc(settings.invoice_pay_to)}<br>
    ${esc(settings.invoice_vat_status)}. ${esc(settings.invoice_issuer_name)} is registered in England and Wales, company number ${esc(settings.invoice_issuer_number)}.<br>
    Services are project management, observation and documentation. They are not a survey, a valuation, a legal opinion or a quantity surveyor's estimate.
  </footer>
</div></body></html>`;
}

// --------------------------------------------------------------- handler

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const trace = new Trace("yaad-invoice", req);
  const root = trace.startSpan("POST /yaad-invoice", SpanKind.SERVER, httpAttrs(req));
  const done = (body: BodyInit, status: number, ct = "application/json") => {
    root.setAttributes({ "http.response.status_code": status });
    root.end();
    trace.flush();
    return new Response(body, { status, headers: { ...cors, "Content-Type": ct } });
  };
  const fail = (msg: string, status: number) => done(JSON.stringify({ error: msg }), status);

  try {
    if (claim(req, "role") !== "authenticated") {
      root.setAttributes({ "yaadly.auth.outcome": "rejected" });
      return fail("Sign in required.", 401);
    }
    // Invoicing is the founder's desk. Clients read their own invoices
    // through the portal and RLS, never through this function.
    if (!(await isAdmin(req))) {
      root.setAttributes({ "yaadly.auth.outcome": "not_admin" });
      return fail("Admin only.", 403);
    }
    root.setAttributes({ "yaadly.auth.outcome": "admin" });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "draft");
    root.setAttributes({ "yaadly.invoice.action": action });

    // ---------------------------------------------------------- catalogue
    const catRes = await db(req, "service_catalogue?select=*&active=eq.true&order=sort");
    if (!catRes.ok) return fail(`catalogue read failed: http ${catRes.status}`, 502);
    const catalogue: CatalogueRow[] = await catRes.json();

    if (action === "catalogue") {
      return done(JSON.stringify({ catalogue }), 200);
    }

    // -------------------------------------------------------------- send
    // Founder's own instruction, live: raising an invoice per the published
    // payment terms (raise_service_invoice(), not this function's own
    // AI-drafted "draft" path) should end in one click, not a click to
    // raise and a second, separate click to mark it sent. This is that
    // second half: render the exact document the client will read, email
    // it, and only on a successful send does the invoice actually move to
    // 'sent' - a failed send leaves it a draft, so nothing is marked gone
    // out that never actually reached anyone.
    //
    // Deliberately NOT offered for an 'ai' drafted_by invoice: those still
    // need a human to read the model's proposed lines before anything
    // leaves this desk, the same gate the free-text drafting flow's own
    // "mark sent" button already enforces by requiring a separate click.
    // A policy-raised invoice carries no model-written content at all -
    // catalogue name, a fixed amount, a fixed sentence naming which
    // published rule it follows - so there is nothing here for a human to
    // check that raising it did not already guarantee.
    if (action === "send") {
      const id = String(body.invoice_id || "");
      if (!id) return fail("invoice_id required", 400);

      const [iR, lR, sR] = await Promise.all([
        db(req, `invoices?select=*&id=eq.${encodeURIComponent(id)}`),
        db(req, `invoice_lines?select=*&invoice_id=eq.${encodeURIComponent(id)}&order=sort,id`),
        db(req, `app_settings?select=key,value&key=like.invoice_*`),
      ]);
      if (!iR.ok) return fail(`invoice read failed: http ${iR.status}`, 502);
      const inv = (await iR.json())[0];
      if (!inv) return fail("no such invoice", 404);
      if (inv.status !== "draft") return fail(`invoice ${id} is ${inv.status}, not a draft to send`, 409);
      if (inv.drafted_by === "ai") return fail("an AI-drafted invoice needs a human to read it first: use render, then mark it sent from there.", 409);

      const lines = lR.ok ? await lR.json() : [];
      if (lines.some((l: any) => l.price_source === "needs_price")) return fail(`invoice ${id} has an unpriced line and cannot be sent`, 409);
      const settings: Record<string, string> = {};
      if (sR.ok) for (const r of await sR.json()) settings[r.key] = r.value;
      const html = renderInvoice(inv, lines, settings);

      const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
      if (!resendKey) return fail("RESEND_API_KEY is not set, so this cannot email anybody yet. Render and send it by hand instead.", 500);

      const sendRes = await trace.span("resend.send invoice", SpanKind.CLIENT, { "server.address": "api.resend.com" }, async (s) => {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: `${settings.invoice_issuer_name || "Yaadly"} <invoices@in.yaadly.co.uk>`,
            to: [inv.client_email],
            reply_to: settings.invoice_issuer_email || undefined,
            subject: `Invoice ${inv.id}${inv.period_label ? ", " + inv.period_label : ""} — ${money(inv.total_pence, inv.currency)}`,
            html,
          }),
          signal: AbortSignal.timeout(15000),
        });
        s.setAttributes({ "http.response.status_code": r.status });
        return r;
      });
      if (!sendRes.ok) {
        const t = await sendRes.text().catch(() => "");
        root.recordError(`resend send ${sendRes.status}: ${t.slice(0, 200)}`);
        return fail(`Could not email this: ${t.slice(0, 200)}`, 502);
      }

      const updRes = await db(req, `invoices?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: "sent" }),
      });
      if (!updRes.ok) return fail(`emailed, but could not mark ${id} sent: ${await updRes.text()}`, 502);
      const updated = (await updRes.json())[0];

      root.setAttributes({ "yaadly.invoice.id": id, "yaadly.invoice.action": "send", "yaadly.invoice.outcome": "emailed" });
      return done(JSON.stringify({ invoice: updated, emailed_to: inv.client_email }), 200);
    }

    // ------------------------------------------------------------- render
    if (action === "render") {
      const id = String(body.invoice_id || "");
      if (!id) return fail("invoice_id required", 400);

      const [iR, lR, sR] = await Promise.all([
        db(req, `invoices?select=*&id=eq.${encodeURIComponent(id)}`),
        db(req, `invoice_lines?select=*&invoice_id=eq.${encodeURIComponent(id)}&order=sort,id`),
        db(req, `app_settings?select=key,value&key=like.invoice_*`),
      ]);
      if (!iR.ok) return fail(`invoice read failed: http ${iR.status}`, 502);
      const inv = (await iR.json())[0];
      if (!inv) return fail("no such invoice", 404);
      const lines = lR.ok ? await lR.json() : [];
      const settings: Record<string, string> = {};
      if (sR.ok) for (const r of await sR.json()) settings[r.key] = r.value;

      const html = renderInvoice(inv, lines, settings);
      return body.as === "json"
        ? done(JSON.stringify({ invoice: inv, lines, html }), 200)
        : done(html, 200, "text/html; charset=utf-8");
    }

    // -------------------------------------------------------------- draft
    if (action !== "draft") return fail(`unknown action: ${action}`, 400);

    const text = String(body.text || "").slice(0, 4000);
    if (!text.trim()) return fail("Tell me what to bill for.", 400);

    const prov = pickTextProvider();
    if (!prov) {
      root.recordError("no text model is configured");
      return fail(NO_PROVIDER_MESSAGE, 500);
    }

    // The model sees names and ids. It does NOT see prices, because it has no
    // use for them and no field to return one in.
    const catalogueForPrompt = catalogue
      .map((c) => `${c.id} = ${c.name} (per ${c.unit_label}${c.recurring ? ", recurring monthly" : ""}). ${c.blurb}`)
      .join("\n");

    const raw = await trace.span(`chat ${prov.model}`, SpanKind.CLIENT, {
      ...providerAttrs(prov),
      "gen_ai.operation.name": "chat",
      "gen_ai.request.temperature": 0,
    }, async (s) => {
      const r = await fetch(prov.api, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${prov.key}` },
        body: JSON.stringify({
          model: prov.model,
          temperature: 0,
          messages: [
            { role: "system", content: `${SYSTEM}\n\nCATALOGUE (the only permitted catalogue_id values, plus "UNKNOWN"):\n${catalogueForPrompt}` },
            { role: "user", content: text },
          ],
        }),
      });
      const j = await r.json();
      s.setAttributes({
        "http.response.status_code": r.status,
        "gen_ai.response.model": j?.model,
        "gen_ai.response.finish_reasons": j?.choices?.[0]?.finish_reason,
        "gen_ai.usage.input_tokens": j?.usage?.prompt_tokens,
        "gen_ai.usage.output_tokens": j?.usage?.completion_tokens,
      });
      if (!r.ok) s.recordError(`${prov.name} http ${r.status}`);
      return j?.choices?.[0]?.message?.content ?? "";
    });

    let parsed: Record<string, any> = {};
    try {
      parsed = JSON.parse(String(raw).replace(/^```(json)?/i, "").replace(/```$/, "").trim());
    } catch (_) {
      root.recordError("model returned unparseable JSON");
      return fail("The agent did not return a usable draft. Try saying it more plainly.", 502);
    }

    // Validate every line against the catalogue. An id the model invented is
    // not an error, it is an unpriced line and a question for a human.
    const ids = new Set(catalogue.map((c) => c.id));
    const proposed: any[] = Array.isArray(parsed.lines) ? parsed.lines.slice(0, 20) : [];
    let offList = 0;

    const lines = proposed.map((l: any, i: number) => {
      const cid = String(l.catalogue_id ?? "").trim();
      const known = ids.has(cid);
      if (!known) offList++;
      const tier = String(l.tier ?? "founding").toLowerCase() === "full" ? "catalogue_full" : "catalogue_founding";
      const qty = Number(l.qty);
      return {
        catalogue_id: known ? cid : null,
        description: String(l.description ?? (known ? catalogue.find((c) => c.id === cid)!.name : "Unrecognised item")).slice(0, 300),
        qty: Number.isFinite(qty) && qty > 0 ? Math.min(qty, 999) : 1,
        price_source: known ? tier : "needs_price",
        sort: i,
      };
    });

    if (!lines.length) return fail("The agent found nothing to bill for in that.", 422);

    const questions: string[] = Array.isArray(parsed.questions) ? parsed.questions.map(String).slice(0, 6) : [];

    const clientName = String(body.client_name || parsed.client_name || "").trim();
    const clientEmail = String(body.client_email || parsed.client_email || "").trim();
    if (!clientName || !clientEmail) {
      return done(JSON.stringify({
        needs: "client",
        message: "I have the lines but not the client. Give me a name and an email and I will write the draft.",
        proposed_lines: lines,
        questions,
      }), 200);
    }

    // Number and write the draft.
    const numRes = await db(req, "rpc/new_invoice_number", { method: "POST", body: "{}" });
    if (!numRes.ok) return fail(`could not allocate an invoice number: http ${numRes.status}`, 502);
    const invoiceId = String(await numRes.json());

    const insRes = await db(req, "invoices?select=*", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        id: invoiceId,
        client_name: clientName,
        client_email: clientEmail,
        client_address: String(body.client_address || ""),
        client_company: String(body.client_company || parsed.client_company || ""),
        po_number: String(body.po_number || parsed.po_number || ""),
        service_id: body.service_id || null,
        job_id: body.job_id || null,
        drafted_by: "ai",
        period_label: String(parsed.period_label ?? "").slice(0, 80),
        covering_note: String(parsed.covering_note ?? "").slice(0, 1200),
        model_note: `${prov.model}, temperature 0. Lines proposed by the agent, prices taken from service_catalogue. Not checked by a human yet.`,
      }),
    });
    if (!insRes.ok) return fail(`could not create the draft: ${await insRes.text()}`, 502);
    const invoice = (await insRes.json())[0];

    const lineRes = await db(req, "invoice_lines?select=*", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(lines.map((l) => ({ ...l, invoice_id: invoiceId }))),
    });
    if (!lineRes.ok) return fail(`draft ${invoiceId} created but its lines failed: ${await lineRes.text()}`, 502);
    const written = await lineRes.json();

    // Re-read the parent: the totals were computed by trigger, not by us.
    const finalRes = await db(req, `invoices?select=*&id=eq.${encodeURIComponent(invoiceId)}`);
    const final = finalRes.ok ? (await finalRes.json())[0] : invoice;

    root.setAttributes({
      "yaadly.invoice.id": invoiceId,
      "yaadly.invoice.lines": lines.length,
      "yaadly.invoice.offlist_lines": offList,
      "yaadly.invoice.total_pence": final?.total_pence ?? 0,
    });

    return done(JSON.stringify({
      invoice: final,
      lines: written,
      questions,
      unpriced: offList,
      ready_to_send: offList === 0,
      reminder: "This is a draft. Read it, fix it, then mark it sent yourself. Nothing here has been sent to anybody.",
    }), 200);
  } catch (e) {
    root.recordError(e);
    return fail(String(e), 500);
  }
});
