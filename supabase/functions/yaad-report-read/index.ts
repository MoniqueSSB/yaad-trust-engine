import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";
import { NO_VISION_PROVIDER_MESSAGE, pickVisionProvider, visionAttrs } from "./visionmodel.ts";

// yaad-report-read
//
// The reading half of a priced report. Monique, 25 September 2026: "I need
// the AI agent to be able to read a PDF and photo copies to then make the
// deposit check document."
//
// This takes the photographs the desk sends (a photographed quote, a receipt,
// a screenshot of a message, the client's site photographs; a PDF arrives as
// one image per page, rendered in the browser) and returns two things: a
// verbatim transcription of every document, and a factual one line caption of
// every photograph. The desk drops that into the notes box, where a person
// reads it and corrects it BEFORE the draft is made. That pause is the point.
// A model reading handwriting gets a digit wrong, and a wrong digit in the
// notes becomes a wrong finding with a straight face.
//
// WHAT IT NEVER DOES
//
// It does not draft, rate, price check, or say whether anything is sound. It
// reads. The drafting agent (yaad-report) is the only thing that writes a
// finding, and it is under the ten rules and the service brief. Keeping the
// two apart means the transcript can be verbatim, figures and dimensions and
// all, because it is the RECORD of the source and not the agent's words. The
// scrubbers run on yaad-report's output, not on this.
//
// WHERE THE PICTURES GO
//
// pickVisionProvider("report"). Mistral, EU, under the same terms as the job
// photographs since 15 September 2026. A quote carries the contractor's name
// and number, which is personal data, and this is the first time a
// contractor's paperwork has gone to a model at all, so it is a named job in
// _shared/visionmodel.ts rather than a reuse of "evidence". Nothing here is
// stored: the desk holds the answer and yaad-report keeps it as source_text
// when the draft is made.
//
// NO SERVICE-ROLE KEY. Admin session only, checked the same way yaad-sketch
// does: a signed-in role, then is_admin() over the caller's own token.

const READ_PROMPT = `You are a transcription clerk for Yaadly Ltd, a UK construction project management company. You are given photographs. Some are documents (a contractor's quote, a receipt, a screenshot of a message, a certificate). Some are photographs of a property.

For EACH image, in order, return one entry. Return STRICT JSON only, no markdown fences, exactly this shape:
{"documents":[{"index":1,"kind":"quote","text":""}]}

"kind" is one of: quote, receipt, message, certificate, photo, other.

For a document (quote, receipt, message, certificate, other):
- "text" is a VERBATIM transcription, line by line, in the order it appears. Keep every figure, date, name, phone number, unit and spelling exactly as written, including mistakes. Do not correct, round, convert, total or tidy anything.
- Where a word or figure cannot be read, write [unreadable] in its place. Never guess a digit.
- After the transcription, add one line starting "Layout:" saying whether it is handwritten or typed, whether it carries a letterhead, a date, a signature, a TRN, an address, a phone number. Say only what is visible.
- Do not summarise, interpret, evaluate, or say whether anything is missing, high, low, fair, or normal. You are transcribing, not reviewing.

For a photograph of a property (photo):
- "text" is one or two plain sentences saying what is visible: which part of the building, what is in frame, what condition is visible on the surface. "A rear roof slope, corrugated zinc, one sheet lifted at the edge, staining on the wall below."
- No measurements, no cost, no opinion on whether anything is safe, sound or urgent, and nothing you cannot actually see in the frame. If the image is blurred or shows nothing useful, say so.

British English. No em dashes and no en dashes anywhere; use a comma, a colon, brackets or a full stop.

Reply with ONLY the JSON object, starting with { and ending with }. No words before it, no words after it.`;

function bearer(req: Request): string {
  return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
}
function claim(req: Request, key: string): string {
  try {
    return JSON.parse(atob(bearer(req).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))[key] || "";
  } catch (_) { return ""; }
}
async function db(req: Request, path: string, init: RequestInit = {}) {
  return await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: Deno.env.get("SUPABASE_ANON_KEY")!,
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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Eight images a call, each under about 1.5 MB encoded. A desk sends a PDF as
// one image per page and a phone photograph resized to fit, so eight covers
// a quote, a receipt and a handful of site photographs in one read.
const MAX_IMAGES = 8;
const MAX_IMAGE_CHARS = 2_000_000;
const isImage = (s: unknown) =>
  /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(String(s || ""));

type Doc = { index: number; kind: string; text: string; name: string };

const KINDS = new Set(["quote", "receipt", "message", "certificate", "photo", "other"]);

// The transcript in the shape the notes box wants: one labelled block per
// image, in order, so the person reading it can match each block to the
// picture they attached.
function notesBlock(docs: Doc[]): string {
  return docs.map((d) => {
    const label = d.kind === "photo" ? `PHOTOGRAPH ${d.index}` : `DOCUMENT ${d.index} (${d.kind})`;
    return `${label}${d.name ? `, ${d.name}` : ""}:\n${d.text}`;
  }).join("\n\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-report-read", req);
  const root = trace.startSpan(`${req.method} /yaad-report-read`, SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush(); return res;
  };
  const json = (body: unknown, status = 200) =>
    done(new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } }), status);
  const fail = (message: string, status: number) => {
    root.recordError(message);
    return json({ error: message }, status);
  };

  try {
    if (req.method !== "POST") return fail("Method not allowed.", 405);
    if (claim(req, "role") !== "authenticated") {
      root.setAttributes({ "yaadly.auth.outcome": "rejected" });
      return fail("Sign in required.", 401);
    }
    if (!(await isAdmin(req))) {
      root.setAttributes({ "yaadly.auth.outcome": "not_admin" });
      return fail("Admin only.", 403);
    }
    root.setAttributes({ "yaadly.auth.outcome": "admin" });

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch (_) { return fail("Send JSON.", 400); }

    const raw = Array.isArray(body.images) ? (body.images as unknown[]).slice(0, MAX_IMAGES) : [];
    const images: { data: string; name: string }[] = [];
    for (const item of raw) {
      const it = (item && typeof item === "object") ? item as Record<string, unknown> : { data: item };
      const data = String(it.data ?? "");
      if (!isImage(data)) return fail("Every image must be a PNG, JPEG or WebP data URL. A PDF is sent as one image per page.", 400);
      if (data.length > MAX_IMAGE_CHARS) return fail("An image is too large. Resize it to under about 1.5 MB before sending.", 400);
      images.push({ data, name: String(it.name ?? "").slice(0, 80) });
    }
    if (!images.length) return fail("Attach the quote and the photographs first.", 400);

    const vprov = pickVisionProvider("report");
    if (!vprov) return fail(NO_VISION_PROVIDER_MESSAGE, 503);
    root.setAttributes({ "yaadly.report_read.images": images.length });

    // The instructions travel inside the user message, ahead of the images,
    // for the reason recorded in yaad-sketch: a vision model given a system
    // prompt next to an image has read the prompt straight back as its answer.
    const contentFor = (strict: boolean): Record<string, unknown>[] => {
      const c: Record<string, unknown>[] = [{
        type: "text",
        text: `${READ_PROMPT}\n\nThere are ${images.length} image(s), numbered 1 to ${images.length} in the order given.`
          + (images.some((i) => i.name) ? `\nFile names, in order: ${images.map((i, n) => `${n + 1}. ${i.name || "unnamed"}`).join("; ")}.` : "")
          + (strict ? `\n\nYour previous answer was not valid JSON. This time return nothing but the JSON object.` : ""),
      }];
      for (const img of images) c.push({ type: "image_url", image_url: { url: img.data } });
      return c;
    };

    const parse = (text: string): Doc[] | null => {
      const s = String(text);
      const a = s.indexOf("{"), b = s.lastIndexOf("}");
      if (a < 0 || b <= a) return null;
      try {
        const p = JSON.parse(s.slice(a, b + 1));
        if (!Array.isArray(p?.documents) || !p.documents.length) return null;
        return p.documents.slice(0, images.length).map((d: Record<string, unknown>, i: number) => ({
          index: Number(d?.index) || i + 1,
          kind: KINDS.has(String(d?.kind)) ? String(d.kind) : "other",
          text: String(d?.text ?? "").trim().slice(0, 12_000),
          name: images[Number(d?.index) - 1]?.name ?? images[i]?.name ?? "",
        })).filter((d: Doc) => d.text);
      } catch (_) { return null; }
    };

    const read = (strict: boolean) => trace.span(`chat ${vprov.model}${strict ? " strict" : ""}`, SpanKind.CLIENT, {
      ...visionAttrs(vprov),
      "gen_ai.request.temperature": 0,
      "yaadly.report_read.batch_size": images.length,
    }, async (s) => {
      // Sixty seconds and one more go on a 5xx or a hang, the shape yaad-sketch
      // settled on after a hosted endpoint took a request and never answered.
      const ask = () => fetch(vprov.api, {
        method: "POST",
        headers: { Authorization: `Bearer ${vprov.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: vprov.model,
          messages: [{ role: "user", content: contentFor(strict) }],
          max_tokens: 4000, temperature: 0,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      let r: Response;
      try {
        r = await ask();
        if (r.status >= 500) { try { await r.text(); } catch (_) { /* discarded */ } console.error(`yaad-report-read: ${vprov.name} http ${r.status}, trying once more`); r = await ask(); }
      } catch (e) {
        console.error(`yaad-report-read: ${vprov.name} gave no answer in 60s (${String(e).slice(0, 80)}), trying once more`);
        r = await ask();
      }
      const text = await r.text();
      let j: any = {};
      try { j = JSON.parse(text); } catch (_) { /* keep raw */ }
      s.setAttributes({
        "http.response.status_code": r.status,
        "gen_ai.response.model": j?.model,
        "gen_ai.usage.input_tokens": j?.usage?.prompt_tokens,
        "gen_ai.usage.output_tokens": j?.usage?.completion_tokens,
      });
      if (!r.ok) {
        const msg = `yaad-report-read: ${vprov.name} http ${r.status}`;
        s.recordError(msg); console.error(msg, text.slice(0, 200));
        return "";
      }
      return String(j?.choices?.[0]?.message?.content ?? "");
    });

    let docs = parse(await read(false));
    if (!docs) docs = parse(await read(true));
    if (!docs) return fail("The reader did not return a usable transcription. Try clearer photographs, one document per image.", 502);

    root.setAttributes({
      "yaadly.report_read.documents": docs.filter((d) => d.kind !== "photo").length,
      "yaadly.report_read.photos": docs.filter((d) => d.kind === "photo").length,
    });

    // The ledger. Reading is an agent act and is recorded as one, with what it
    // read and where the pictures went. It saved nothing: the desk holds the
    // answer until a person has read it and made the draft.
    await db(req, "agent_actions", {
      method: "POST",
      body: JSON.stringify({
        actor: "yaad-report-read",
        actor_kind: "agent",
        action: "read_report_sources",
        summary: `Read ${images.length} image(s) for a report: ${docs.filter((d) => d.kind !== "photo").length} document(s) transcribed, ${docs.filter((d) => d.kind === "photo").length} photograph(s) captioned. Nothing saved; the desk holds the transcript until the draft is made.`,
        model: vprov.model,
        provider: `${vprov.name} (${vprov.region})`,
      }),
    }).catch(() => {});

    return json({
      ok: true,
      provider: vprov.name,
      region: vprov.region,
      model: vprov.model,
      documents: docs,
      notes_block: notesBlock(docs),
      next: "Read the transcript. Correct anything the reader got wrong, especially figures. Then draft the findings.",
    });
  } catch (e) {
    root.recordError(String(e).slice(0, 300));
    return json({ error: "The reader failed. Nothing was saved." }, 500);
  }
});
