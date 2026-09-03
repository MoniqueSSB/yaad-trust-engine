/**
 * Inbound webhook: a payment or job event moves the HubSpot deal.
 *
 * THIS IS THE PART THAT WAS MISSING. hubspotPipeline.ts documents that its
 * caller must verify the webhook, and until this file existed there was no
 * caller, so anyone who could guess a deal ID could have walked it to Funds
 * Held. Everything below exists to make that false.
 *
 * WHY IT LIVES HERE AND NOT IN supabase/functions. Every other webhook in this
 * repo is a Supabase edge function, and this one is the exception on purpose:
 * the HubSpot client is TypeScript in web/lib, and a Deno copy of it would be
 * a second implementation of money-adjacent stage logic, free to drift from
 * the first. One implementation, imported, beats two that agree today.
 *
 * FAIL CLOSED. A missing secret is 503 and nothing moves. An endpoint that
 * guards money does not get a development mode.
 *
 * This paragraph used to draw the contrast with yaad-whatsapp-webhook, which
 * treated a missing secret as "skip the check" on the grounds that the worst
 * case was a junk enquiry row. Both halves of that have since stopped being
 * true and the comment is corrected rather than deleted, because the reasoning
 * is the useful part:
 *
 *   yaad-whatsapp-webhook was deleted on 1 September 2026 (see DECISIONS.md).
 *   It spoke to Meta's Cloud API directly and never received real traffic.
 *   Real WhatsApp intake runs through yaad-inbound, over Twilio.
 *
 *   yaad-inbound had the same fail-open and no longer does, as of 3 September
 *   2026. The "junk enquiry row" reasoning had expired: that function can now
 *   agree quotes, agree Kickoff Packs, choose workers and approve stages, and
 *   approving a stage raises a worker pay invoice. It now refuses a Twilio
 *   request it could not verify, the same call this file made first.
 *
 * THE SENDER PICKS AN EVENT, NEVER A STAGE. The payload names something that
 * happened; this file decides which stage that implies. Accepting a stage ID
 * from the request would let a caller with a valid signature jump a deal
 * straight to Completed and Paid, or reopen a cancelled one, neither of which
 * is theirs to decide.
 */

import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/webhookSignature";
import {
  HubSpotError,
  advanceDealToFundsHeld,
  advanceDealToEvidenceSubmitted,
  advanceDealToClientApproved,
  advanceDealToCompletedPaid,
  type StageMove,
} from "@/lib/hubspotPipeline";

/**
 * The only transitions a webhook may cause, and all of them move forward.
 *
 * Cancelling is absent deliberately. It carries a refund, and refund_client is
 * on HUMAN_ONLY_DECISIONS in yaad/guardrails.py. cancelDeal() exists in the
 * module for a human-driven path to call; it is not reachable from the
 * internet through here.
 *
 * client_approved records that the client accepted the evidence. The human
 * still makes that decision in the portal. Recording it moves no money:
 * releasing funds is its own human decision, and is not this endpoint.
 */
const EVENTS: Record<string, (dealId: string) => Promise<StageMove>> = {
  payment_held: advanceDealToFundsHeld,
  evidence_submitted: advanceDealToEvidenceSubmitted,
  client_approved: advanceDealToClientApproved,
  worker_paid: advanceDealToCompletedPaid,
};

function json(body: Record<string, unknown>, status: number, headers?: HeadersInit) {
  return NextResponse.json(body, { status, headers });
}

export async function POST(req: Request) {
  const secret = process.env.HUBSPOT_STAGE_WEBHOOK_SECRET;
  if (!secret) {
    // Not the sender's fault, and not something a retry fixes on its own, but
    // 503 is honest: the endpoint is not configured to be trusted yet.
    console.error("hubspot/stage: HUBSPOT_STAGE_WEBHOOK_SECRET is not set. Refusing every request.");
    return json({ error: "Webhook verification is not configured" }, 503);
  }

  // Raw bytes, before any parsing. The signature covers exactly what was sent.
  const rawBody = await req.text();

  const verdict = await verifyWebhookSignature({
    secret,
    rawBody,
    signatureHeader: req.headers.get("x-yaadly-signature"),
    timestampHeader: req.headers.get("x-yaadly-timestamp"),
  });

  if (!verdict.ok) {
    // The reason is logged, never returned. Telling an unauthenticated caller
    // whether the signature was absent, stale or simply wrong hands them a
    // free oracle for tuning the next attempt.
    console.warn(`hubspot/stage: rejected unverified request (${verdict.reason})`);
    return json({ error: "Invalid signature" }, 401);
  }

  let payload: { dealId?: unknown; event?: unknown };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "Body is not valid JSON" }, 400);
  }

  const dealId = typeof payload.dealId === "string" ? payload.dealId.trim() : "";
  const event = typeof payload.event === "string" ? payload.event : "";

  if (!dealId) return json({ error: "dealId is required" }, 400);
  if (!Object.hasOwn(EVENTS, event)) {
    return json({ error: `Unknown event. Expected one of: ${Object.keys(EVENTS).join(", ")}` }, 400);
  }

  try {
    const move = await EVENTS[event](dealId);
    // changed:false is a success. A redelivered webhook, or one that arrived
    // after the deal had already moved past this point, must get a 2xx so the
    // sender stops rather than retrying something that is already true.
    return json({ ok: true, ...move }, 200);
  } catch (e) {
    if (e instanceof HubSpotError) {
      console.error(`hubspot/stage: deal ${dealId} event ${event} failed: ${e.message}`);

      // A cancelled deal is a real conflict, not a fault. Do not ask for a retry.
      if (e.status === 409) return json({ error: "Deal is cancelled. Reopening it is a manual decision." }, 409);

      if (e.retryable) {
        const headers = e.retryAfterMs
          ? { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) }
          : undefined;
        return json({ error: "HubSpot is temporarily unavailable. Retry." }, 503, headers);
      }

      // Permanent: a bad token, a missing scope, a deal that does not exist.
      // Retrying will fail identically, so say so and let it dead-letter.
      return json({ error: "HubSpot rejected the update. This will not succeed on retry." }, 502);
    }

    console.error("hubspot/stage: unexpected failure", e);
    return json({ error: "Unexpected failure" }, 500);
  }
}

// Machine to machine only. No browser has business here, so there is no OPTIONS
// handler and no CORS.
//
// There is deliberately no GET either. Next returns 405 by itself for any
// method a route does not export, so writing one would only be a slower way of
// getting the same answer. Route Handlers are also uncached by default, and
// only GET can opt into caching, so not exporting it removes the question
// entirely. Checked against node_modules/next/dist/docs, per web/AGENTS.md.
