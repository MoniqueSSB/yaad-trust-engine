// Which vision model the live functions talk to, decided in one place.
//
// ── Why this file exists ──
//
// textmodel.ts was written because the text provider was a property of eight
// files rather than a decision. The vision provider was left in exactly the
// state textmodel.ts was created to fix: the NVIDIA chat completions URL was
// typed out in three separate functions, so "which country do site photos,
// walkthrough stills and a worker's proof of address go to" was answerable
// only by grepping, and changing it meant editing three files and deploying
// three functions. That is a data protection question wearing the costume of
// a refactor. Consolidated 5 September 2026.
//
// This adds no provider. NVIDIA was already the vision provider and still is.
// What changes is that it is now named once, and moving away from it is a
// secret change rather than a code change, the same as text.
//
// ── The three jobs, and why they stopped sharing one dial ──
//
// All three vision callers read one secret, NVIDIA_VISION_MODEL, while
// defaulting to different models: the evidence photo review defaulted to the
// 11b checkpoint, the sketch frames and the vetting read to 90b. So with the
// secret unset the three ran on different models by accident, and with it set
// they all moved together whether or not that was intended. Reading a client's
// evidence photographs, describing rooms in a walkthrough, and reading dates
// off a utility bill are three different jobs with three different tolerances
// for being wrong.
//
// Each job now has its own secret and falls back to NVIDIA_VISION_MODEL, so
// nothing changes for a project that has only ever set the old one, and any
// job can be moved on its own from the day somebody wants to move it.
//
// Which model reads evidence is a founder decision, not a default to inherit:
// that call sits closest to a stage approval, and the note in RUNBOOK section
// 12 is where the answer belongs once it is made.
//
// ── Region travels with the call ──
//
// providerAttrs in textmodel.ts carries yaadly.model.region on every text
// span. None of the three vision call sites carried it, so the one class of
// call that sends actual photographs of somebody's house and somebody's
// paperwork was the one class that could not be traced to a country. visionAttrs
// below fixes that, in the same shape, so both are answerable the same way.
//
// ── Job photographs go to Mistral, in the EU, since 15 September 2026 ──
//
// Founder decision, the same morning the Mistral account went on to
// pay-as-you-go with training switched off: "move the photos to Mistral".
// Evidence photographs and walkthrough stills now go to api.mistral.ai, the
// same provider and the same data processing terms as every piece of text.
// Reasons, in order: the NVIDIA free endpoint is the flakiest provider in the
// estate (35 second hangs and a 500 on the next attempt, recorded in
// yaad-notify-client); a photograph of somebody's house now goes to the EU
// under a signed DPA rather than to a free US endpoint; and it costs pennies.
//
// The vetting read is NOT moved. It sends an applicant's proof of address,
// TRN and certificates, and CLAUDE.md section 6 says no applicant document
// gets a new destination without Monique asking for it by name. She asked
// for the photos. So MISTRAL_VISION_JOBS below names the two jobs that moved,
// the vetting read still resolves to NVIDIA, and widening the set is her call.
//
// NVIDIA stays as the branch below Mistral rather than being deleted, for the
// vetting read and so that unsetting the Mistral key fails over to a provider
// the privacy page still discloses. It logs which country it went to.
//
// ── Adding a provider ──
//
// Do not add a branch. Set VISION_MODEL_KEY and VISION_MODEL_API, which take
// priority over everything here and accept any OpenAI-compatible vision
// endpoint. A new hard-coded branch is a new country receiving personal data,
// which is a founder decision and a line in the data inventory before it is a
// code change. CI fails a function that types the endpoint out itself. The
// Mistral branch above is the one exception, and it is dated and named.

export type VisionJob = "evidence" | "sketch" | "vetting";

export type VisionProvider = {
  /** Short name for logs and telemetry. */
  name: string;
  /** Full chat completions URL. */
  api: string;
  key: string;
  model: string;
  /** Where the request physically goes. Carried so it reaches telemetry. */
  region: string;
  /** Which of the three jobs asked, so one span attribute names it. */
  job: VisionJob;
};

/**
 * Per-job model settings.
 *
 * The default column is a last resort and not a recommendation. It preserves
 * exactly what each call site resolved to before this file existed, so moving
 * the decision here changed no behaviour on the day it landed.
 */
const JOBS: Record<VisionJob, { modelEnv: string; fallbackModel: string; agent: string }> = {
  evidence: {
    modelEnv: "NVIDIA_EVIDENCE_MODEL",
    fallbackModel: "meta/llama-3.2-11b-vision-instruct",
    agent: "photo_review",
  },
  sketch: {
    modelEnv: "NVIDIA_SKETCH_MODEL",
    // 11b, not 90b, since 6 September 2026. On the first real walkthrough the
    // 90b endpoint took three stills and answered nothing in forty seconds,
    // twice in a row, and the desk sat on "Looking at stills 1 to 3" with no
    // pack. The 11b is the same provider in the same country, answers in
    // seconds, and a room described a little less richly beats a room never
    // described. Set NVIDIA_SKETCH_MODEL to move it back without a deploy.
    fallbackModel: "meta/llama-3.2-11b-vision-instruct",
    agent: "sketch_frames",
  },
  vetting: {
    modelEnv: "NVIDIA_VETTING_MODEL",
    fallbackModel: "meta/llama-3.2-90b-vision-instruct",
    agent: "vetting_review",
  },
};

/** This job's own setting, then the shared one, then the job's own default. */
function modelFor(job: VisionJob): string {
  return Deno.env.get(JOBS[job].modelEnv)
    || Deno.env.get("NVIDIA_VISION_MODEL")
    || JOBS[job].fallbackModel;
}

/** The jobs whose images go to Mistral. Founder-named, 15 September 2026.
 *  "vetting" is deliberately absent: see the header. */
export const MISTRAL_VISION_JOBS: ReadonlySet<VisionJob> = new Set<VisionJob>(["evidence", "sketch"]);

export function pickVisionProvider(job: VisionJob): VisionProvider | null {
  // 1. Explicit override. Any OpenAI-compatible vision endpoint, no code change.
  const overrideKey = Deno.env.get("VISION_MODEL_KEY");
  const overrideApi = Deno.env.get("VISION_MODEL_API");
  if (overrideKey && overrideApi) {
    return {
      name: Deno.env.get("VISION_MODEL_PROVIDER") || "configured",
      api: overrideApi,
      key: overrideKey,
      model: Deno.env.get("VISION_MODEL_NAME") || modelFor(job),
      region: Deno.env.get("VISION_MODEL_REGION") || "unstated",
      job,
    };
  }

  // 2. Mistral, European Union, for job photographs only. See the header.
  // The model id is the same shape trap as textmodel.ts: set
  // MISTRAL_VISION_MODEL rather than editing here. mistral-small-latest reads
  // images; the per-job NVIDIA_* model secrets do not apply to this branch
  // because they name NVIDIA checkpoints.
  const mistral = Deno.env.get("MISTRAL_API_KEY");
  if (mistral && MISTRAL_VISION_JOBS.has(job)) {
    return {
      name: "mistral",
      api: "https://api.mistral.ai/v1/chat/completions",
      key: mistral,
      model: Deno.env.get("MISTRAL_VISION_MODEL") || "mistral-small-latest",
      region: "eu",
      job,
    };
  }

  // 3. NVIDIA's hosted NIM endpoint, United States. The home for the vetting
  // read, and for job photographs only when no Mistral key is set.
  //
  // Worth knowing before relying on it, from live testing on 3 September 2026
  // recorded in yaad-notify-client: a clean 15 second answer, a request that
  // ran past 35 seconds with nothing back, and a flat 500 on the very next
  // attempt. Callers retry a timeout or a 5xx once and do not retry a refusal.
  const nvidia = Deno.env.get("NVIDIA_API_KEY");
  if (nvidia) {
    if (MISTRAL_VISION_JOBS.has(job)) {
      console.warn(`visionmodel: MISTRAL_API_KEY is not set, ${job} photographs are going to NVIDIA (United States)`);
    }
    return {
      name: "nvidia_nim",
      api: "https://integrate.api.nvidia.com/v1/chat/completions",
      key: nvidia,
      model: modelFor(job),
      region: "us",
      job,
    };
  }

  // No third branch and no silent fallback, for the same reason textmodel.ts
  // has none: a provider that is not the choice is a route to a country
  // nobody chose, waiting on one missing secret. Failing loudly is correct.
  return null;
}

/** The error to return when no vision provider is configured at all. */
export const NO_VISION_PROVIDER_MESSAGE =
  "No vision model is configured. Set MISTRAL_API_KEY (job photographs) or NVIDIA_API_KEY (vetting, and the fallback) in the Edge Function secrets.";

/**
 * Span attributes for a vision provider, matching providerAttrs in
 * textmodel.ts. Region travels with every call on purpose: a data protection
 * question is much easier to answer from telemetry than from memory.
 */
export function visionAttrs(p: VisionProvider): Record<string, string> {
  return {
    "gen_ai.system": p.name,
    "gen_ai.operation.name": "chat",
    "gen_ai.request.model": p.model,
    "server.address": new URL(p.api).host,
    "yaadly.model.region": p.region,
    "yaadly.agent.name": JOBS[p.job].agent,
  };
}
