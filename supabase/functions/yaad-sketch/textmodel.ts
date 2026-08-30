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
// Founder decision, 30 August 2026: move to an EU endpoint before the pilot
// carries real data. Mistral, because it is hosted in the EU, it speaks the
// OpenAI chat completions shape so the eight call sites barely change, and it
// offers a signed data processing agreement.
//
// ── How the move actually happens ──
//
// Set MISTRAL_API_KEY as an Edge Function secret. That is the whole switch.
// The order below prefers it, so the moment the secret exists every function
// is on the EU endpoint, and until it exists they keep working on MiniMax
// rather than falling over.
//
// That fallback is a deliberate, temporary and NOISY one. A quiet fallback to
// China is exactly how a migration gets declared done and silently is not, so
// every caller records the provider and its region on the span, and this file
// logs a warning each time the legacy path is taken. Once MISTRAL_API_KEY is
// set and RUNBOOK step 9 has confirmed the switch, delete the MiniMax branch.
// It is four lines and it should not outlive the pilot.
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

  // 3. MiniMax. Legacy, in China, on the way out. Delete once the EU key is
  //    set and the switch is confirmed.
  const minimax = Deno.env.get("MINIMAX_API_KEY");
  if (minimax) {
    console.warn(
      "textmodel: falling back to MiniMax (China). MISTRAL_API_KEY is not set on this project, "
        + "so the EU migration is NOT complete. See RUNBOOK step 9.",
    );
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
