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
