/**
 * Inbound webhook: a confirmed job becomes a contact and a deal in HubSpot.
 *
 * WHY THIS IS AN HTTP HOP AND NOT A FUNCTION CALL. yaad-inbound is Deno on
 * Supabase; the HubSpot client is TypeScript in web/lib running on Cloudflare
 * Workers. A Deno copy of it would be a second implementation of CRM writes,
 * free to drift from the first, which is the reasoning app/api/hubspot/stage
 * already records for itself. So yaad-inbound signs a small payload and posts
 * it here, and there stays one place that knows how to talk to HubSpot.
 *
 * SAME SIGNATURE SCHEME as the stage webhook, its own secret. Both are
 * Yaadly's own services calling in, but a secret per purpose means a leak of
 * one does not hand over the other, and these two do very different things:
 * that one moves a deal along a money pipeline, this one creates records.
 *
 * FAIL CLOSED ON THE SECRET, like its sibling. A missing secret is 503 and
 * nothing is written. Unlike its sibling, the CALLER treats every failure here
 * as unimportant, because it is: a CRM that missed a lead is a worse day, and
 * a client who did not get answered is a worse business. The severity belongs
 * at the caller, not here.
 *
 * WHAT THIS ENDPOINT WILL NOT ACCEPT. A deal stage, or anything that moves
 * money. It creates a deal at Inquiry and Scoping and updates the shape of an
 * existing one. Every stage move in this system goes through
 * /api/hubspot/stage, which decides the stage from an event and refuses to go
 * backwards. Splitting them that way is what stops a lead sync being a way to
 * walk a deal anywhere it likes.
 */

import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/webhookSignature";
import { HubSpotError } from "@/lib/hubspotPipeline";
import { upsertLead, type Lead } from "@/lib/hubspotLeads";

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status });
}

const str = (v: unknown, max = 200) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

export async function POST(req: Request) {
  const secret = process.env.HUBSPOT_LEAD_WEBHOOK_SECRET;
  if (!secret) {
    console.error("hubspot/lead: HUBSPOT_LEAD_WEBHOOK_SECRET is not set. Refusing every request.");
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
    // Logged, never returned. Telling an unauthenticated caller whether the
    // signature was absent, stale or wrong hands them a free oracle.
    console.warn(`hubspot/lead: rejected unverified request (${verdict.reason})`);
    return json({ error: "Invalid signature" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return json({ error: "Body is not valid JSON" }, 400);
  }

  const jobId = str(payload.jobId, 64);
  if (!jobId) return json({ error: "jobId is required" }, 400);

  // Read field by field rather than spreading the payload into the CRM. A
  // signed caller is still not a reason to write whatever arrives: this list
  // is the data protection boundary, and it is short on purpose. The job's
  // description, address and photographs are not on it, and must not be added
  // without asking Monique first.
  const lead: Lead = {
    jobId,
    phone: str(payload.phone, 32),
    name: str(payload.name, 80),
    parish: str(payload.parish, 40),
    trade: str(payload.trade, 60),
    urgency: str(payload.urgency, 30),
    source: str(payload.source, 20),
  };

  try {
    const out = await upsertLead(lead);
    // created:false is a success. A redelivery, or a client who confirmed
    // twice, must get a 2xx and stop rather than retrying something already
    // true.
    return json({ ok: true, ...out }, 200);
  } catch (e) {
    if (e instanceof HubSpotError) {
      console.error(`hubspot/lead: ${jobId} failed: ${e.message}`);
      if (e.retryable) return json({ error: "HubSpot is temporarily unavailable. Retry." }, 503);
      return json({ error: "HubSpot rejected the write. This will not succeed on retry." }, 502);
    }
    console.error("hubspot/lead: unexpected failure", e);
    return json({ error: "Unexpected failure" }, 500);
  }
}

// Machine to machine only. No browser has business here, so no OPTIONS, no
// CORS, and no GET: Next answers 405 by itself for a method a route does not
// export, and not exporting GET keeps it uncacheable by construction.
