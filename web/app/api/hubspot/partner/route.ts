/**
 * Inbound webhook: a "Press, partnership or investment" enquiry becomes a
 * contact and a deal on the Partnerships pipeline.
 *
 * A sibling of ../lead/route.ts and deliberately the same shape: same
 * signature scheme, same fail-closed 503 on a missing secret, same rule that
 * a signed caller is still not a reason to write whatever arrives. It shares
 * HUBSPOT_LEAD_WEBHOOK_SECRET with the lead route on purpose. The secret per
 * purpose rule exists to keep record creation apart from stage moves, which
 * touch money; this route creates records, like its sibling, and a second
 * secret would be a second thing to set in two places for no new boundary.
 *
 * WHAT THIS WILL NOT ACCEPT: the message. It is whatever somebody typed into a
 * box on a public form. It stays on the desk. Nor a stage, nor a category, nor
 * a country: Monique sets those by hand once she has read the enquiry.
 */

import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/webhookSignature";
import { HubSpotError } from "@/lib/hubspotPipeline";
import { upsertPartner, type Partner } from "@/lib/hubspotLeads";

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status });
}

const str = (v: unknown, max = 200) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

export async function POST(req: Request) {
  const secret = process.env.HUBSPOT_LEAD_WEBHOOK_SECRET;
  if (!secret) {
    console.error("hubspot/partner: HUBSPOT_LEAD_WEBHOOK_SECRET is not set. Refusing every request.");
    return json({ error: "Webhook verification is not configured" }, 503);
  }

  const rawBody = await req.text();
  const verdict = await verifyWebhookSignature({
    secret,
    rawBody,
    signatureHeader: req.headers.get("x-yaadly-signature"),
    timestampHeader: req.headers.get("x-yaadly-timestamp"),
  });
  if (!verdict.ok) {
    console.warn(`hubspot/partner: rejected unverified request (${verdict.reason})`);
    return json({ error: "Invalid signature" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return json({ error: "Body is not valid JSON" }, 400);
  }

  const enquiryId = str(payload.enquiryId, 64);
  if (!enquiryId) return json({ error: "enquiryId is required" }, 400);

  // Field by field. This list is the data protection boundary. The message is
  // not on it and must not be added without asking Monique first.
  const partner: Partner = {
    enquiryId,
    name: str(payload.name, 120),
    email: str(payload.email, 200),
    phone: str(payload.phone, 32),
    source: str(payload.source, 20),
  };

  try {
    const out = await upsertPartner(partner);
    return json({ ok: true, ...out }, 200);
  } catch (e) {
    if (e instanceof HubSpotError) {
      console.error(`hubspot/partner: ${enquiryId} failed: ${e.message}`);
      if (e.retryable) return json({ error: "HubSpot is temporarily unavailable. Retry." }, 503);
      return json({ error: "HubSpot rejected the write. This will not succeed on retry." }, 502);
    }
    console.error("hubspot/partner: unexpected failure", e);
    return json({ error: "Unexpected failure" }, 500);
  }
}

// Machine to machine only: no GET, no OPTIONS, no CORS, same as the lead route.
