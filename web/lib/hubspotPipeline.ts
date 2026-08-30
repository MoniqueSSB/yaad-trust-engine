/**
 * Moves a HubSpot deal along Yaadly's job lifecycle.
 *
 * Stage IDs, lifecycle membership and the funds-held rule all come from
 * ./hubspotConfig. Nothing in this file hardcodes a stage ID or a label.
 *
 * NAMING: the stage this advances to is FUNDS_HELD. Guardrail 1 in
 * yaad/guardrails.py bans the e-word, and that scanner only screens text on
 * its way out of an agent. A HubSpot stage name never passes through it, so a
 * banned word in a stage constant would slip the net and then surface on the
 * deal board, in exports, in workflow emails, and in any screenshot that
 * reaches a client or an investor. The check cannot catch this one. We have to.
 *
 * NO SDK, DELIBERATELY: @hubspot/api-client would be a new dependency in
 * web/package.json for four HTTP calls, and it pulls a Node-shaped stack into
 * a bundle that runs on Cloudflare Workers. Global fetch is available in both
 * places. Revisit only if something here needs HubSpot's batch or association
 * helpers.
 *
 * SERVER ONLY. HUBSPOT_TOKEN is a private app token with write access to the
 * CRM. It is a Worker secret in production (`wrangler secret put
 * HUBSPOT_TOKEN`) and lives in web/.env.local for development. It must never
 * be given a NEXT_PUBLIC_ prefix, because that would inline it into the
 * browser bundle at build time and publish it.
 *
 * THE CALLER VERIFIES THE WEBHOOK, NOT THIS FILE. Nothing here can tell a real
 * payment confirmation from a forged one; it takes the deal ID on trust.
 * Whatever receives the inbound webhook checks the signature first and rejects
 * on failure, the way yaad-whatsapp-webhook checks Meta's X-Hub-Signature-256
 * before it does anything else. Without that, anyone who can guess a deal ID
 * can walk it to funds held.
 *
 * FAILURE IS LOUD. Every function here throws rather than logging and
 * returning. A swallowed error means the client's payment is confirmed, the
 * CRM says otherwise, no retry happens and nobody finds out until someone
 * looks at the board. HubSpotError carries `retryable` so the webhook handler
 * can answer non-2xx and let the sender redeliver on a transient fault, and
 * dead-letter the rest instead of spinning on a failure that will never clear.
 */

import {
  PIPELINE_ID,
  DEAL_STAGES,
  stageKeyById,
  type DealStageId,
} from "./hubspotConfig";

const API_BASE = "https://api.hubapi.com";

/**
 * Direction of travel, written out rather than derived from the key order of
 * DEAL_STAGES, because whether a job can move from A to B is a business rule
 * and must not change silently when somebody reorders the config for
 * readability.
 *
 * CANCELLED is deliberately absent. It is not the eighth step of the
 * lifecycle, it is a side exit reachable from anywhere, so giving it a rank
 * would make cancelling look like progress past "completed and paid".
 */
export const LIFECYCLE_ORDER: readonly DealStageId[] = [
  DEAL_STAGES.INQUIRY_SCOPING,
  DEAL_STAGES.QUOTE_SENT,
  DEAL_STAGES.FUNDS_HELD,
  DEAL_STAGES.EVIDENCE_SUBMITTED,
  DEAL_STAGES.CLIENT_APPROVED,
  DEAL_STAGES.COMPLETED_PAID,
];

export class HubSpotError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    opts: { status?: number | null; retryable?: boolean; retryAfterMs?: number | null } = {},
  ) {
    super(message);
    this.name = "HubSpotError";
    this.status = opts.status ?? null;
    this.retryable = opts.retryable ?? false;
    this.retryAfterMs = opts.retryAfterMs ?? null;
  }
}

/**
 * Fail at boot, not on the first webhook at 2am. Call this wherever the
 * service starts. The check inside token() is the backstop, not the plan.
 */
export function assertConfigured(): true {
  if (!process.env.HUBSPOT_TOKEN) {
    throw new HubSpotError(
      "HUBSPOT_TOKEN is not set. Locally: add it to web/.env.local. In production: wrangler secret put HUBSPOT_TOKEN.",
    );
  }
  return true;
}

function token(): string {
  assertConfigured();
  return process.env.HUBSPOT_TOKEN as string;
}

type HubSpotBody = Record<string, unknown> | null;

async function hubspotFetch(path: string, init: RequestInit = {}): Promise<HubSpotBody> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch (cause) {
    // DNS, TLS, socket. Always worth another go.
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new HubSpotError(`Could not reach HubSpot: ${detail}`, { retryable: true });
  }

  const text = await res.text();
  const body = text ? safeJson(text) : null;

  if (res.ok) return body;

  // 429 and 5xx are worth redelivering. A 401 or 403 is a bad token or a
  // missing scope: it will fail identically on every retry, so it should stop
  // the line and reach a human rather than spin.
  const retryable = res.status === 429 || res.status >= 500;
  const retryAfter = res.headers.get("retry-after");

  let message = `HubSpot ${init.method ?? "GET"} ${path} failed with ${res.status}`;
  if (res.status === 401) {
    message += ". The private app token is wrong, expired, or from another portal.";
  }
  if (res.status === 403) {
    message += ". The private app is most likely missing the crm.objects.deals.write scope.";
  }
  const apiMessage = body && typeof body.message === "string" ? body.message : null;
  if (apiMessage) message += `: ${apiMessage}`;

  throw new HubSpotError(message, {
    status: res.status,
    retryable,
    retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : null,
  });
}

function safeJson(text: string): HubSpotBody {
  try {
    return JSON.parse(text) as HubSpotBody;
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function stageRank(stageId: string | null): number | null {
  if (!stageId) return null;
  const i = LIFECYCLE_ORDER.indexOf(stageId as DealStageId);
  return i === -1 ? null : i;
}

export type Deal = {
  id: string;
  properties: { dealstage?: string; pipeline?: string; dealname?: string };
};

export async function getDeal(dealId: string): Promise<Deal> {
  const body = await hubspotFetch(
    `/crm/v3/objects/deals/${encodeURIComponent(dealId)}?properties=dealstage,pipeline,dealname`,
  );
  return body as unknown as Deal;
}

export type StageMove = {
  changed: boolean;
  from: string | null;
  to: DealStageId;
  reason?: string;
};

/**
 * Set a deal's stage, idempotently, and never drag it backwards.
 *
 * Webhooks get redelivered. Without the read before the write, a duplicate
 * "payment confirmed" arriving after the client had already approved the
 * evidence would haul the deal back to Funds Held, and the board would then be
 * lying about where somebody's money is.
 *
 * `changed: false` is a success, not an error. A redelivered webhook should
 * get a 2xx and stop, rather than being retried forever.
 */
export async function setDealStage(
  dealId: string,
  targetStageId: DealStageId,
  { allowBackwards = false }: { allowBackwards?: boolean } = {},
): Promise<StageMove> {
  if (!stageKeyById(targetStageId)) {
    throw new HubSpotError(
      `"${targetStageId}" is not a stage in hubspotConfig.ts. Pass DEAL_STAGES.X, never a stage label.`,
    );
  }

  const deal = await getDeal(dealId);
  const current = deal?.properties?.dealstage ?? null;

  if (current === targetStageId) {
    return { changed: false, from: current, to: targetStageId, reason: "already there" };
  }

  if (!allowBackwards && current === DEAL_STAGES.CANCELLED) {
    // Reopening a cancelled job has a refund attached to it. That is a human
    // decision, and HUMAN_ONLY_DECISIONS in yaad/guardrails.py says so.
    throw new HubSpotError(
      `Deal ${dealId} is Cancelled. Reopening it is a manual decision, not an automated one.`,
      { status: 409 },
    );
  }

  const currentRank = stageRank(current);
  const targetRank = stageRank(targetStageId);
  if (!allowBackwards && currentRank !== null && targetRank !== null && targetRank < currentRank) {
    return {
      changed: false,
      from: current,
      to: targetStageId,
      reason: `already past ${stageKeyById(targetStageId)}`,
    };
  }

  await hubspotFetch(`/crm/v3/objects/deals/${encodeURIComponent(dealId)}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { pipeline: PIPELINE_ID, dealstage: targetStageId } }),
  });

  return { changed: true, from: current, to: targetStageId };
}

/** A verified webhook has confirmed the client's payment is held. */
export function advanceDealToFundsHeld(dealId: string): Promise<StageMove> {
  return setDealStage(dealId, DEAL_STAGES.FUNDS_HELD);
}

/** The worker's before and after evidence has landed. */
export function advanceDealToEvidenceSubmitted(dealId: string): Promise<StageMove> {
  return setDealStage(dealId, DEAL_STAGES.EVIDENCE_SUBMITTED);
}

/**
 * The client accepted the evidence. This records the acceptance. It does not
 * release anything: releasing funds is on HUMAN_ONLY_DECISIONS in
 * yaad/guardrails.py and does not belong behind an automated stage move.
 */
export function advanceDealToClientApproved(dealId: string): Promise<StageMove> {
  return setDealStage(dealId, DEAL_STAGES.CLIENT_APPROVED);
}

/** The worker has been paid and the job is closed. */
export function advanceDealToCompletedPaid(dealId: string): Promise<StageMove> {
  return setDealStage(dealId, DEAL_STAGES.COMPLETED_PAID);
}

/** Reachable from anywhere, so it is the one move allowed to go backwards. */
export function cancelDeal(dealId: string): Promise<StageMove> {
  return setDealStage(dealId, DEAL_STAGES.CANCELLED, { allowBackwards: true });
}

export type PipelineCheck = {
  pipeline: string;
  stages: { key: string; id: DealStageId; liveLabel: string }[];
};

/**
 * Confirm hubspotConfig.ts still matches the live portal.
 *
 * The config is pinned to the seven default stage IDs. Those survive a label
 * rename but not a delete and recreate: rebuilding the pipeline in the UI
 * makes HubSpot hand out arbitrary integers, and every stage ID in the config
 * goes stale at once. Run this after any pipeline edit so that breakage shows
 * up as one clear message, rather than as deals quietly refusing to move.
 */
export async function verifyPipeline(): Promise<PipelineCheck> {
  const body = await hubspotFetch("/crm/v3/pipelines/deals");
  const results = (body?.results ?? []) as { id: string; label: string; stages: { id: string; label: string }[] }[];
  const pipeline = results.find((p) => p.id === PIPELINE_ID);
  if (!pipeline) {
    throw new HubSpotError(`Pipeline "${PIPELINE_ID}" does not exist in this portal.`);
  }

  const liveById = new Map(pipeline.stages.map((s) => [s.id, s.label]));
  const missing = Object.entries(DEAL_STAGES).filter(([, id]) => !liveById.has(id));
  if (missing.length > 0) {
    throw new HubSpotError(
      `Stage IDs in hubspotConfig.ts are not in the live pipeline: ` +
        `${missing.map(([k, id]) => `${k}=${id}`).join(", ")}. ` +
        `The pipeline was most likely deleted and recreated rather than relabelled.`,
    );
  }

  return {
    pipeline: pipeline.label,
    stages: Object.entries(DEAL_STAGES).map(([key, id]) => ({
      key,
      id,
      liveLabel: liveById.get(id) as string,
    })),
  };
}
