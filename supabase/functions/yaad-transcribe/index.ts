import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Trace, SpanKind, httpAttrs } from "./otel.ts";

// Speech to text, for the two places a job arrives as a voice note.
//
// WhatsApp is the reason this exists. Somebody standing in front of a leaking
// roof describes it in thirty seconds of Patois far more accurately than they
// will ever type it, and until now those messages landed as
// "[audio message, no text, review manually]" and waited for a person.
//
// Two callers:
//   the WhatsApp webhook, passing a Meta media id it fetches with its own
//   token, because Meta media URLs are short-lived and authenticated
//   the job form, passing a clip recorded in the browser
//
// Provider-agnostic on purpose. MiniMax runs the rest of the product so it
// was the obvious first choice and it was wrong: it exposes no speech-to-text
// endpoint at all, every candidate path 404s. The build notes already
// suspected that, which is why they proposed benchmarking Scribe, AssemblyAI
// and Deepgram against real Patois rather than assuming.
//
// Cloudflare Workers AI is first: it runs Whisper on an account Yaadly is
// already on, inside a free allowance, so voice costs nothing to switch on.
// OpenAI, Deepgram, Scribe and AssemblyAI follow as failover, and whichever
// key is present next takes over if the one before it is down or returns
// nothing. One provider having a bad afternoon must not lose a job.
//
// Patois is stated to every provider rather than left to be guessed. A model
// told to expect English quietly "corrects" Patois into something the client
// did not say, and on a job description that is not a small error.

const PATOIS_HINT =
  "Jamaican Patois or Jamaican English, describing property repair work. " +
  "Transcribe what was said. Do not translate into standard English and do " +
  "not correct the grammar.";

const MAX_BYTES = 20 * 1024 * 1024;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Provider = { name: string; run: (b: Uint8Array, f: string) => Promise<string> };

function providers(): Provider[] {
  const out: Provider[] = [];

  // Cloudflare Workers AI runs Whisper on the account Yaadly already pays
  // nothing for. The free allowance covers a small operation comfortably, and
  // there is no second vendor, no second bill and no second key to rotate.
  // First in the chain for exactly that reason.
  //
  // Two models, tried in order. whisper-large-v3-turbo is the better one and
  // takes base64 in JSON; plain whisper takes the raw bytes and is the
  // fallback when the turbo model is busy or unavailable in the region.
  const cfAccount = Deno.env.get("CLOUDFLARE_ACCOUNT_ID") ?? "";
  const cfToken = Deno.env.get("CLOUDFLARE_API_TOKEN") ?? "";
  if (cfAccount && cfToken) {
    const base = `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/run`;
    out.push({
      name: "cloudflare-whisper",
      run: async (bytes) => {
        let b64 = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          b64 += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        b64 = btoa(b64);

        // turbo first
        const turbo = await fetch(`${base}/@cf/openai/whisper-large-v3-turbo`, {
          method: "POST",
          headers: { Authorization: `Bearer ${cfToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ audio: b64, task: "transcribe", language: "en" }),
          signal: AbortSignal.timeout(90000),
        });
        if (turbo.ok) {
          const j = await turbo.json();
          const t = String(j?.result?.text ?? "").trim();
          if (t) return t;
        }

        // then the plain model, which takes the bytes directly
        const plain = await fetch(`${base}/@cf/openai/whisper`, {
          method: "POST",
          headers: { Authorization: `Bearer ${cfToken}` },
          body: bytes as unknown as BodyInit,
          signal: AbortSignal.timeout(90000),
        });
        if (!plain.ok) {
          throw new Error(`cloudflare ${turbo.status}/${plain.status}: ${(await plain.text()).slice(0, 160)}`);
        }
        const j2 = await plain.json();
        return String(j2?.result?.text ?? "").trim();
      },
    });
  }

  const openai = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (openai) {
    out.push({
      name: "whisper",
      run: async (bytes, filename) => {
        const form = new FormData();
        form.append("file", new Blob([bytes as unknown as BlobPart]), filename);
        form.append("model", "whisper-1");
        form.append("prompt", PATOIS_HINT);
        const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${openai}` },
          body: form,
          signal: AbortSignal.timeout(90000),
        });
        if (!r.ok) throw new Error(`whisper ${r.status}: ${(await r.text()).slice(0, 160)}`);
        const j = await r.json();
        return String(j?.text ?? "").trim();
      },
    });
  }

  const deepgram = Deno.env.get("DEEPGRAM_API_KEY") ?? "";
  if (deepgram) {
    out.push({
      name: "deepgram",
      run: async (bytes) => {
        const r = await fetch(
          "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&language=en",
          {
            method: "POST",
            headers: {
              Authorization: `Token ${deepgram}`,
              "Content-Type": "application/octet-stream",
            },
            body: bytes as unknown as BodyInit,
            signal: AbortSignal.timeout(60000),
          },
        );
        if (!r.ok) throw new Error(`deepgram ${r.status}: ${(await r.text()).slice(0, 160)}`);
        const j = await r.json();
        return String(
          j?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "",
        ).trim();
      },
    });
  }

  const eleven = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
  if (eleven) {
    out.push({
      name: "elevenlabs-scribe",
      run: async (bytes, filename) => {
        const form = new FormData();
        form.append("file", new Blob([bytes as unknown as BlobPart]), filename);
        form.append("model_id", "scribe_v1");
        const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
          method: "POST",
          headers: { "xi-api-key": eleven },
          body: form,
          signal: AbortSignal.timeout(90000),
        });
        if (!r.ok) throw new Error(`elevenlabs ${r.status}: ${(await r.text()).slice(0, 160)}`);
        const j = await r.json();
        return String(j?.text ?? "").trim();
      },
    });
  }

  const assembly = Deno.env.get("ASSEMBLYAI_API_KEY") ?? "";
  if (assembly) {
    out.push({
      name: "assemblyai",
      run: async (bytes) => {
        const up = await fetch("https://api.assemblyai.com/v2/upload", {
          method: "POST",
          headers: { authorization: assembly },
          body: bytes as unknown as BodyInit,
          signal: AbortSignal.timeout(60000),
        });
        if (!up.ok) throw new Error(`assemblyai upload ${up.status}`);
        const { upload_url } = await up.json();
        const job = await fetch("https://api.assemblyai.com/v2/transcript", {
          method: "POST",
          headers: { authorization: assembly, "content-type": "application/json" },
          body: JSON.stringify({ audio_url: upload_url, speech_model: "universal" }),
        });
        if (!job.ok) throw new Error(`assemblyai start ${job.status}`);
        const { id } = await job.json();
        for (let i = 0; i < 45; i++) {
          await new Promise((res) => setTimeout(res, 2000));
          const p = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
            headers: { authorization: assembly },
          });
          const j = await p.json();
          if (j.status === "completed") return String(j.text ?? "").trim();
          if (j.status === "error") throw new Error(`assemblyai: ${j.error}`);
        }
        throw new Error("assemblyai timed out");
      },
    });
  }

  return out;
}

function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const trace = new Trace("yaad-transcribe", req);
  const root = trace.startSpan(`${req.method} /yaad-transcribe`, SpanKind.SERVER, httpAttrs(req));
  const done = (res: Response, status: number) => {
    root.setAttributes({ "http.response.status_code": status });
    root.end(); trace.flush(); return res;
  };
  const json = (b: unknown, status = 200) =>
    done(new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } }), status);

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    let bytes: Uint8Array | null = null;
    let filename = "note.ogg";

    const mediaId = String(body.mediaId ?? "").trim();
    if (mediaId) {
      const wa = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
      if (!wa) return json({ error: "WhatsApp media cannot be fetched: no access token." }, 503);
      const meta = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
        headers: { Authorization: `Bearer ${wa}` },
      });
      if (!meta.ok) { root.recordError(`meta media lookup ${meta.status}`); return json({ error: "Could not read that voice note." }, 502); }
      const info = await meta.json();
      const file = await fetch(String(info.url), { headers: { Authorization: `Bearer ${wa}` } });
      if (!file.ok) { root.recordError(`meta media fetch ${file.status}`); return json({ error: "Could not download that voice note." }, 502); }
      bytes = new Uint8Array(await file.arrayBuffer());
      filename = "whatsapp.ogg";
    } else {
      const audio = String(body.audio ?? "");
      if (!audio) return json({ error: "No audio supplied." }, 400);
      bytes = b64ToBytes(audio);
      filename = String(body.filename ?? "note.webm");
    }

    if (!bytes || bytes.byteLength === 0) return json({ error: "That recording was empty." }, 400);
    if (bytes.byteLength > MAX_BYTES) return json({ error: "That recording is too long." }, 413);
    root.setAttributes({ "yaadly.audio.bytes": bytes.byteLength });

    const chain = providers();
    if (chain.length === 0) {
      root.setAttributes({ "yaadly.transcribe.outcome": "no_provider" });
      return json({
        ok: false,
        error: "No speech provider is configured.",
        detail: "Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, which costs nothing on the account Yaadly already uses, and voice works on every channel with no code change. OPENAI_API_KEY, DEEPGRAM_API_KEY, ELEVENLABS_API_KEY and ASSEMBLYAI_API_KEY are accepted as failover.",
      }, 503);
    }

    let text = "";
    const tried: string[] = [];
    for (const p of chain) {
      try {
        text = await trace.span(`asr ${p.name}`, SpanKind.CLIENT, {
          "gen_ai.system": p.name,
          "gen_ai.operation.name": "transcribe",
        }, async () => await p.run(bytes as Uint8Array, filename));
        if (text) { root.setAttributes({ "yaadly.transcribe.provider": p.name }); break; }
        tried.push(`${p.name}: empty`);
      } catch (e) {
        tried.push(`${p.name}: ${String(e).slice(0, 120)}`);
        root.recordError(String(e).slice(0, 200));
      }
    }
    if (tried.length) root.setAttributes({ "yaadly.transcribe.tried": tried.join(" | ").slice(0, 400) });

    if (!text) {
      root.setAttributes({ "yaadly.transcribe.outcome": "failed" });
      return json({ ok: false, error: "That voice note could not be transcribed. It is saved, and a person will listen to it.", tried }, 502);
    }

    root.setAttributes({ "yaadly.transcribe.outcome": "ok", "yaadly.transcribe.chars": text.length });
    return json({ ok: true, text, provider: tried.length ? undefined : chain[0].name });
  } catch (e) {
    root.recordError(e);
    return json({ error: "Transcription failed." }, 500);
  }
});
