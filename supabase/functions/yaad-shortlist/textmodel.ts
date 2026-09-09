// Which text model the live functions talk to, decided in one place.
//
// ── Why this file exists ──
//
// Until 30 August 2026 the answer was "MiniMax", hard-coded as a pair of
// constants in eight separate Edge Functions. That made the provider a
// property of eight files rather than a decision, and the provider is a
// decision: MiniMax is hosted in China, and everything a client types and
// everything a worker says over WhatsApp was passing through it. China has no
// UK adequacy decision, and Jamaica's Data Protection Act 2020 restricts
// transfers where the destination lacks adequate protection.
//
// Founder decision, 30 August 2026: move to Mistral, hosted in the EU, which
// speaks the OpenAI chat completions shape so the call sites barely change and
// which offers a signed data processing agreement. The timing was deliberately
// left open, because the data flowing through these functions in August was
// synthetic and a China transfer of invented job cards is not the risk the
// DPIA is about. The line was REAL CLIENT AND WORKER DATA, arriving with the
// December pilot.
//
// ── The move happened on 4 September 2026 ──
//
// MISTRAL_API_KEY and MISTRAL_MODEL were set as Edge Function secrets and every
// function picked them up on its next invocation. No deploy, no code change,
// no nine-file edit. That was the whole point of moving the decision into this
// file ahead of the decision itself, and it worked exactly as designed.
//
// ── The MiniMax fallback, removed 4 September, reinstated 5 September ──
//
// The branch was removed the day Mistral went live, on the reasoning that a
// provider that is no longer the choice is a silent route to China waiting on
// one missing secret. On 5 September 2026 Monique asked for it back as a
// fallback for when the Mistral key does not load, was told plainly what that
// means (any time Mistral is unconfigured, client and worker text goes to
// China), and reaffirmed it. Founder decision, recorded in DECISIONS.md.
//
// So it is back, on three conditions that make it a decision rather than an
// accident:
//   1. pickTextProvider() reaches it ONLY when no Mistral key is set. A
//      Mistral key that is present and failing gets the retry ladder in
//      fetchModel first. On 6 September 2026 Monique added: the file must
//      still be produced when Mistral is rate limited. So chatWithFailover()
//      hands a call that is STILL 429 or 5xx after its retries to MiniMax,
//      per call, logged each time, and only when MINIMAX_API_KEY is set.
//   2. It is opt-in. With MINIMAX_API_KEY unset there is still no third
//      branch, and every caller gets NO_PROVIDER_MESSAGE.
//   3. It is never quiet. Every time it is chosen it writes a line to the
//      function log naming the provider and the country, so "where did this
//      message go" is answerable from the logs even with tracing off.
// docs/privacy.html says the same thing to the people whose text it is.
//
// Every model span still carries yaadly.model.region, so "where did this
// client's message actually go" is answerable from telemetry rather than from
// memory. Note that as of 4 September 2026 no OTLP endpoint is configured on
// this project, so nothing is actually reading those spans yet. That is why
// RUNBOOK §9 step two proves the switch with a live call rather than a trace.
//
// ── The model id, which is where this goes wrong ──
//
// Set MISTRAL_MODEL. Do not rely on the default below. Model ids move: the
// previous default here was mistral-large-latest, which Mistral stopped
// serving, and the first replacement tried was mistral-medium-3-5-26-04, which
// is a model NAME from Mistral's overview table and not an API id at all. Both
// failed. The id form is mistral-small-latest, mistral-medium-latest, or a
// dated snapshot such as mistral-medium-2604.
//
// ── Adding a provider ──
//
// Do not add a branch. Set the four TEXT_MODEL_* secrets instead: they take
// priority over everything here, so a future move is a secret change and not
// a deploy. A new hard-coded branch in this file is a new country receiving
// personal data, which is a founder decision and a line in the data
// inventory before it is a code change.

export type TextProvider = {
  /** Short name for logs and telemetry. */
  name: string;
  /** Full chat completions URL. */
  api: string;
  key: string;
  model: string;
  /** Where the request physically goes. Carried so it reaches telemetry. */
  region: string;
};

export function pickTextProvider(): TextProvider | null {
  // 1. Explicit override. Any OpenAI-compatible endpoint, no code change.
  const overrideKey = Deno.env.get("TEXT_MODEL_KEY");
  const overrideApi = Deno.env.get("TEXT_MODEL_API");
  if (overrideKey && overrideApi) {
    return {
      name: Deno.env.get("TEXT_MODEL_PROVIDER") || "configured",
      api: overrideApi,
      key: overrideKey,
      model: Deno.env.get("TEXT_MODEL_NAME") || "unspecified",
      region: Deno.env.get("TEXT_MODEL_REGION") || "unstated",
    };
  }

  // 2. Mistral, the EU endpoint. The home, live since 4 September 2026.
  //
  // The default below is a last resort, not a recommendation. Set
  // MISTRAL_MODEL rather than editing here, and read the model id note at
  // the top of this file before assuming a default still resolves.
  const mistral = Deno.env.get("MISTRAL_API_KEY");
  if (mistral) {
    return {
      name: "mistral",
      api: "https://api.mistral.ai/v1/chat/completions",
      key: mistral,
      model: Deno.env.get("MISTRAL_MODEL") || "mistral-small-latest",
      region: "eu",
    };
  }

  // 3. MiniMax, in China. The fallback, and only when no Mistral key is set.
  // See the header: reinstated 5 September 2026 on Monique's reaffirmed
  // instruction. It is opt-in through MINIMAX_API_KEY and it announces itself
  // in the log on every call it is chosen for, because a reroute of personal
  // data to another country is a thing to be able to see afterwards.
  const minimax = minimaxProvider("MISTRAL_API_KEY is not set");
  if (minimax) return minimax;

  // No fourth branch. With neither key set every caller gets
  // NO_PROVIDER_MESSAGE, which is a loud failure rather than a quiet guess.
  return null;
}

/**
 * The MiniMax provider, if its key is set, announced in the log with the
 * reason it is being reached for. Null when MINIMAX_API_KEY is unset, which
 * is the state the estate is in unless somebody sets it on purpose.
 */
function minimaxProvider(reason: string): TextProvider | null {
  const key = Deno.env.get("MINIMAX_API_KEY");
  if (!key) return null;
  console.error(
    `textmodel: ${reason}, falling back to MiniMax (China). ` +
    "Text sent on this call leaves the EU.",
  );
  return {
    name: "minimax",
    api: "https://api.minimax.io/v1/chat/completions",
    key,
    model: Deno.env.get("MINIMAX_MODEL") || "MiniMax-M2.7",
    region: "cn",
  };
}

/**
 * The provider to try when the one in hand has refused with a rate limit or
 * a server error, or null when there is nowhere else to go.
 *
 * Asked for on 6 September 2026: "I want my file to be produced even when the
 * limit is used on Mistral." Before this, a 429 from Mistral on a report
 * draft or a sketch assembly was the end of it: no retry, no second provider,
 * a 502 to the desk. Now the call is retried with the Retry-After honoured
 * (fetchModel), and only if Mistral still says no does this hand the call to
 * MiniMax, if and only if MINIMAX_API_KEY is set. With it unset, which is the
 * state today, this returns null and the failure stays loud.
 *
 * This widens the header's condition 1. A Mistral key that is present and
 * rate limited now CAN fall through, per call, logged each time. It is the
 * founder's instruction and DECISIONS.md carries it.
 */
export function pickFallbackProvider(after: TextProvider, reason: string): TextProvider | null {
  if (after.name === "minimax") return null;
  return minimaxProvider(`${after.name} ${reason}`);
}

export type FetchModelOpts = {
  timeoutMs: number;
  retryDelayMs?: number;
  /** How long a Retry-After may ask us to wait before we give up instead. Default MAX_RETRY_WAIT_MS. */
  maxRetryWaitMs?: number;
  /** How many times to retry a 429 or 5xx. Default 1, which is right for a webhook. A desk call can afford more. */
  retries?: number;
  /** A caller's own deadline, combined with the timeout. The inbound webhook passes its request budget here. */
  signal?: AbortSignal;
};

function deadline(opts: FetchModelOpts): AbortSignal {
  const t = AbortSignal.timeout(opts.timeoutMs);
  return opts.signal ? AbortSignal.any([opts.signal, t]) : t;
}

/**
 * Which answers from the first provider are worth taking to the second.
 *
 * 429 and 5xx: the provider is there and busy or broken. 401 and 403, added
 * 6 September 2026 when the Mistral key on the project started being refused
 * as invalid and Monique said "use the MiniMax key when Mistral fails": the
 * provider is refusing OUR CREDENTIALS, which says nothing about whether
 * another provider will take the same request. A 400 stays out. That is the
 * request itself being wrong, and it is wrong everywhere.
 */
export function failsOver(status: number): boolean {
  return status === 429 || status === 401 || status === 403 || status >= 500;
}

/**
 * One chat completion, with the retry ladder and then the failover.
 *
 * `payload` is the request without `model`; the model comes from whichever
 * provider actually answers. The provider that answered comes back with the
 * response so the caller can put the right name and region on its span.
 */
export async function chatWithFailover(
  prov: TextProvider,
  payload: Record<string, unknown>,
  opts: FetchModelOpts,
): Promise<{ provider: TextProvider; res: Response }> {
  const call = (p: TextProvider) => fetchModel(p.api, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
    body: JSON.stringify({ ...payload, model: p.model }),
  }, opts);

  let res = await call(prov);
  if (!failsOver(res.status)) return { provider: prov, res };

  const fallback = pickFallbackProvider(prov, `http ${res.status} after retries`);
  if (!fallback) return { provider: prov, res };

  try { await res.text(); } catch (_) { /* discarded on purpose, see fetchModel */ }
  res = await call(fallback);
  return { provider: fallback, res };
}

/**
 * One fetch, retried once when the answer is worth asking for again.
 *
 * ── Why this exists ──
 *
 * Added 4 September 2026, after the agent audit found `readTheJob` treating a
 * 429 exactly like a refusal: return null, and the client gets the hardcoded
 * generic opener instead of an answer. One rate limit, one lost reply.
 *
 * Mistral's free tier allows roughly ONE REQUEST PER SECOND against a cap of
 * about a billion tokens a month. At Yaadly's volume the monthly cap is
 * irrelevant, an intake call is around 3,000 tokens so it would take some
 * 300,000 messages to reach, and the per-second limit is the only one that can
 * realistically bite: two people writing in during the same second, or a
 * client sending three photographs that each land as their own webhook.
 * Waiting a beat and asking again fixes precisely that.
 *
 * ── Why only once, and why this short ──
 *
 * This runs inside a Twilio webhook, and Twilio abandons a webhook that has
 * not answered in about 15 seconds. A generous retry ladder would turn a rate
 * limit into a timeout, which is the same silence for the client and harder to
 * diagnose. One retry after a short pause stays well inside the budget.
 *
 * Only 429 and 5xx are retried. A 400 or a 401 will fail identically the
 * second time: a wrong model id and a wrong key are not conditions that pass
 * with patience, and retrying them just doubles the wait before the fallback.
 */
export async function fetchModel(
  url: string,
  init: RequestInit,
  opts: FetchModelOpts,
): Promise<Response> {
  const delay = opts.retryDelayMs ?? 1200;
  const budget = opts.maxRetryWaitMs ?? MAX_RETRY_WAIT_MS;
  const retries = opts.retries ?? 1;
  const once = () => fetch(url, { ...init, signal: deadline(opts) });

  let res: Response;
  try {
    res = await once();
  } catch (e) {
    // A timeout or a dropped connection. Worth one more go for the same
    // reason a 503 is: the request never reached a decision.
    await new Promise((r) => setTimeout(r, delay));
    return await once();
  }

  // More than one retry, added 6 September 2026 for the desk callers. A
  // Twilio webhook keeps the default of one because it has fifteen seconds in
  // total; a person at the desk drafting a report can wait longer for the
  // file than for a 502, and said so.
  for (let attempt = 1; attempt <= retries && (res.status === 429 || res.status >= 500); attempt++) {
    // The body is read and discarded on purpose. Leaving it unread on a
    // response nobody will use leaks the connection in Deno.
    try { await res.text(); } catch (_) { /* nothing to do with it */ }

    // Retry-After, added 5 September 2026. Before this the retry always waited
    // the same fixed 1200ms and never looked at the header. On 4 September the
    // Mistral 429s were watched doing exactly that: fire, wait 1200ms, get 429
    // again. A server that has told you how long to wait and been ignored will
    // say no a second time, so the retry was spending the caller's budget to
    // buy a second identical failure.
    //
    // Twilio gives an inbound webhook roughly fifteen seconds, so a long wait
    // is not available to us even when it would work. The rule is therefore:
    // wait what we are told if it fits, and if it does not fit, DO NOT RETRY.
    // Failing immediately is the better answer, because it leaves time to send
    // the person a real reply instead of timing out silently mid-wait.
    const waitMs = retryAfterMs(res.headers.get("retry-after"));
    if (waitMs !== null && waitMs > budget) {
      console.error(
        `fetchModel: http ${res.status}, Retry-After is ${Math.round(waitMs / 1000)}s, ` +
        `longer than the ${budget}ms budget. Not retrying.`,
      );
      return res;
    }
    const pause = waitMs ?? delay;
    console.error(
      `fetchModel: http ${res.status}, retry ${attempt} of ${retries} in ${pause}ms` +
      (waitMs !== null ? " (Retry-After)" : ""),
    );
    await new Promise((r) => setTimeout(r, pause));
    res = await once();
    if (res.status === 429 || res.status >= 500) {
      try { await res.text(); } catch (_) { /* nothing to do with it */ }
    }
  }
  return res;
}

/**
 * The longest we will sit on a Retry-After before giving up instead.
 *
 * Sized against the tightest caller, the Twilio inbound webhook, which has
 * about fifteen seconds in total and has already spent some of it. Four
 * seconds leaves room for the retried call itself and for writing a reply.
 */
export const MAX_RETRY_WAIT_MS = 4000;

/**
 * Retry-After in milliseconds, or null when the header is absent or unusable.
 *
 * The header comes in two forms and providers use both: delay-seconds, and an
 * HTTP date. A negative or nonsensical value is treated as absent rather than
 * as zero, because "retry immediately" from a server that just rate limited us
 * is not a thing to believe.
 */
export function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const raw = header.trim();
  if (raw === "") return null;

  if (/^\d+$/.test(raw)) {
    const ms = Number(raw) * 1000;
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }

  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  const ms = at - Date.now();
  return ms > 0 ? ms : null;
}

/**
 * The model's answer with its thinking removed.
 *
 * MiniMax-M2.7 reasons inside a <think> block before it answers, and on
 * 6 September 2026 the sketch assembler read that block as the answer and
 * reported "not in JSON". yaad-inbound had already learned this on its own.
 * Every caller that parses a model's text should go through here first.
 */
export function answerText(content: unknown): string {
  return String(content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/**
 * The first JSON object in a model's answer, or null. First { to last },
 * after the thinking is removed, so a sentence before or after the object
 * does not matter.
 */
export function firstJsonObject(content: unknown): Record<string, unknown> | null {
  const s = answerText(content);
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { return null; }
}

/** The error to return when no provider is configured at all. */
export const NO_PROVIDER_MESSAGE =
  "No text model is configured. Set MISTRAL_API_KEY in the Edge Function secrets (MINIMAX_API_KEY is the fallback).";

/**
 * Span attributes for a provider. Region travels with every call on purpose:
 * a data protection question is much easier to answer from telemetry than
 * from memory.
 */
export function providerAttrs(p: TextProvider): Record<string, string> {
  return {
    "gen_ai.system": p.name,
    "gen_ai.request.model": p.model,
    "server.address": new URL(p.api).host,
    "yaadly.model.region": p.region,
  };
}
