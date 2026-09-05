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
// The MiniMax branch that used to sit below has been REMOVED, which is step
// three of RUNBOOK §9. It was correct while it was the current choice. It
// stops being correct the moment Mistral is the choice, because then it is no
// longer a provider, it is a silent fallback to China waiting for one missing
// secret. There is deliberately nothing to fall back to now: with no provider
// configured every caller gets NO_PROVIDER_MESSAGE and fails loudly, which is
// the right failure. Do not reintroduce it.
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

  // There is no third branch, on purpose. MiniMax (China) was here until
  // 4 September 2026 and was removed the day Mistral went live, because a
  // provider that is no longer the choice is not a fallback, it is a silent
  // route to a country the privacy page says we do not use. Failing loudly
  // is the correct behaviour: see NO_PROVIDER_MESSAGE below.
  return null;
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
  opts: { timeoutMs: number; retryDelayMs?: number },
): Promise<Response> {
  const delay = opts.retryDelayMs ?? 1200;
  const once = () => fetch(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs) });

  let res: Response;
  try {
    res = await once();
  } catch (e) {
    // A timeout or a dropped connection. Worth one more go for the same
    // reason a 503 is: the request never reached a decision.
    await new Promise((r) => setTimeout(r, delay));
    return await once();
  }

  if (res.status === 429 || res.status >= 500) {
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
    if (waitMs !== null && waitMs > MAX_RETRY_WAIT_MS) {
      console.error(
        `fetchModel: http ${res.status}, Retry-After is ${Math.round(waitMs / 1000)}s, ` +
        `longer than the ${MAX_RETRY_WAIT_MS}ms budget. Not retrying.`,
      );
      return res;
    }
    const pause = waitMs ?? delay;
    console.error(
      `fetchModel: http ${res.status}, retrying once in ${pause}ms` +
      (waitMs !== null ? " (Retry-After)" : ""),
    );
    await new Promise((r) => setTimeout(r, pause));
    return await once();
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

/** The error to return when no provider is configured at all. */
export const NO_PROVIDER_MESSAGE =
  "No text model is configured. Set MISTRAL_API_KEY in the Edge Function secrets.";

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
