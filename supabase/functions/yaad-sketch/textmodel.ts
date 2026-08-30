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
// Founder decision, 30 August 2026, in two parts and both of them deliberate.
//
// The endpoint to move TO is Mistral: hosted in the EU, speaks the OpenAI chat
// completions shape so the eight call sites barely change, and offers a signed
// data processing agreement.
//
// WHEN to move is not yet. MiniMax stays for now. The data flowing through
// these functions today is synthetic and buildathon shaped, and a China
// transfer of invented job cards is not the risk the DPIA is about. The line
// is REAL CLIENT AND WORKER DATA, which arrives with the December pilot in
// Kingston and Portmore.
//
// ── How the move happens when it happens ──
//
// Set MISTRAL_API_KEY as an Edge Function secret. That is the whole switch.
// The order below prefers it, so the moment the secret exists every function
// is on the EU endpoint. No deploy, no code change, no eight-file edit. That
// was the point of moving the decision into this file ahead of the decision
// itself. RUNBOOK step 9 has the three steps.
//
// The MiniMax branch below is therefore the CURRENT CHOICE, not a failure
// state, and it does not shout on every call: an alarm somebody has been told
// to ignore has stopped being an alarm. What it does instead is leave a trace.
// Every model span carries yaadly.model.region, so "where did this client's
// message actually go" is answered from telemetry rather than from memory, and
// the day the answer needs to be "eu" it is checkable in one query.
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

  // 2. Mistral, the EU endpoint. The intended home.
  //
  // Model ids move. Confirm the current one on Mistral's model page before
  // relying on this default, and set MISTRAL_MODEL rather than editing here.
  const mistral = Deno.env.get("MISTRAL_API_KEY");
  if (mistral) {
    return {
      name: "mistral",
      api: "https://api.mistral.ai/v1/chat/completions",
      key: mistral,
      model: Deno.env.get("MISTRAL_MODEL") || "mistral-large-latest",
      region: "eu",
    };
  }

  // 3. MiniMax, in China. The current choice while the data is synthetic, by
  //    founder decision of 30 Aug 2026. Not a fallback and not an error, so it
  //    does not log. The region rides on every span instead, which is the
  //    honest signal: silent when nobody is asking, conclusive when they are.
  //
  //    This branch comes out when Mistral goes in, before the December pilot
  //    carries real client and worker data.
  const minimax = Deno.env.get("MINIMAX_API_KEY");
  if (minimax) {
    return {
      name: "minimax",
      api: "https://api.minimax.io/v1/chat/completions",
      key: minimax,
      model: Deno.env.get("MINIMAX_MODEL") || "MiniMax-M2.7",
      region: "cn",
    };
  }

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
