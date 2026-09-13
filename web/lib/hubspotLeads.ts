/**
 * A WhatsApp lead becomes a contact and a deal in HubSpot.
 *
 * WHOSE DECISION THIS WAS. The 4 September audit found the HubSpot module
 * complete and connected to nothing: a job arriving by WhatsApp created no
 * contact, no deal and no note, and the CRM had no idea any of it was
 * happening. It was left unbuilt on purpose, because sending a client's name,
 * number and property parish to a third party is a new destination for
 * personal data, and CLAUDE.md section 10 puts that with Monique rather than
 * with a session. She asked for it directly. Recorded in DECISIONS.md as her
 * call, with the counter-argument that it is a second source of truth for a
 * job when the desk already works.
 *
 * WHAT LEAVES, AND WHAT DELIBERATELY DOES NOT. Only the shape of the job:
 * their name if they gave one, the number they messaged from, the parish, the
 * trade, the urgency, the job code and which door they came through.
 *
 * The free-text description does NOT leave, and that is the important one. It
 * is whatever somebody typed on WhatsApp, it routinely contains the address,
 * who is alone in the house, when the house is empty, and a transcript of a
 * voice note in their own words. None of that is needed to run a sales
 * pipeline, so none of it goes. The address, the photographs and the client's
 * email are held back for the same reason.
 *
 * WHEN IT FIRES. Once, when a client has confirmed the read-back and the job
 * is real. Not on a greeting, not mid-conversation, not on a message the
 * assistant could not make a job out of. A CRM full of people who said "hi" is
 * a CRM nobody opens.
 *
 * IDEMPOTENT, because it has to be. yaad-inbound can call this more than once
 * for one job: a redelivery, a client confirming twice, a retry. Every write
 * below searches first on a key that identifies the thing, `yaadly_job_id` for
 * the deal and the phone number for the contact, so a second call updates
 * rather than duplicates. Without that, the board would quietly overstate the
 * pipeline, which is the one number an investor conversation turns on.
 */

import { hubspotFetch, HubSpotError } from "./hubspotPipeline";
import { PIPELINE_ID, DEAL_STAGES, DEAL_PROPERTIES } from "./hubspotConfig";

/* ── ONE CUSTOM PROPERTY, AND EVERYTHING ELSE STANDARD ────────────────────
 *
 * Checked against the live portal (149211575) on 4 September 2026 before this
 * was written, and it was worth checking: most of the properties
 * hubspotConfig.ts describes do not exist there. That file is a specification
 * of what should be created, not a record of what has been, and reading it as
 * the latter is how this sync would have failed on its first real lead with a
 * 400 naming a property nobody had made.
 *
 * HubSpot rejects an entire write if it carries one property it does not
 * recognise. So the surface is deliberately tiny: `phone` and `firstname` on
 * the contact, `dealname`, `pipeline`, `dealstage` and `description` on the
 * deal, all of which are standard and always exist, plus exactly one custom
 * property, `yaadly_job_id`.
 *
 * That one is not optional and cannot be replaced by something clever. It is
 * the idempotency key, searched with an exact match before every write, and
 * without it a redelivered message makes a second deal. The obvious
 * alternative, searching the deal NAME for the job code, is not exact:
 * HubSpot tokenises on word boundaries and a code full of hyphens does not
 * reliably match, and an idempotency check that is usually right is worse
 * than none because the failure is silent and cumulative.
 *
 * Parish, trade, urgency and the channel go into the standard `description`
 * field instead of four custom properties. They are the same facts either
 * way; this way nothing has to be created before the sync works, and there is
 * one thing to set up rather than six. */

export type Lead = {
  /** The job's own code. The idempotency key, and never optional. */
  jobId: string;
  /** E.164 where we have it. The contact's identity when there is no email. */
  phone?: string;
  name?: string;
  parish?: string;
  trade?: string;
  urgency?: string;
  /** whatsapp, sms, web, form, email. Mapped to the CRM's own wording below. */
  source?: string;
};

export type LeadResult = {
  contactId: string | null;
  dealId: string;
  created: boolean;
};

const SOURCE_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp", sms: "SMS", web: "Website chat",
  form: "Job form", email: "Email", desk: "Desk",
};

/** Digits only, so a search matches however the number was typed. HubSpot's
 *  own phone search is fussy about formatting and this sidesteps it. */
const digits = (v: string) => v.replace(/\D/g, "");

type SearchResult = { results?: { id: string }[] };

/** The contact this number already belongs to, or null.
 *
 *  Searched on the last ten digits rather than the whole string, because the
 *  number on a HubSpot contact may have been typed by a person and the one on
 *  a WhatsApp message is always E.164. This is a CRM lookup and not an
 *  authorisation check, so it is deliberately more forgiving than
 *  same_phone(): the worst case here is one merged contact record, not a
 *  stranger approving a payment. */
async function findContactByPhone(phone: string): Promise<string | null> {
  const tail = digits(phone).slice(-10);
  if (tail.length < 9) return null;
  const body = await hubspotFetch("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "phone", operator: "CONTAINS_TOKEN", value: `*${tail}` }] }],
      properties: ["phone"],
      limit: 1,
    }),
  }) as SearchResult | null;
  return body?.results?.[0]?.id ?? null;
}

async function findDealByJobId(jobId: string): Promise<string | null> {
  const body = await hubspotFetch("/crm/v3/objects/deals/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: DEAL_PROPERTIES.jobId.name, operator: "EQ", value: jobId }] }],
      properties: [DEAL_PROPERTIES.jobId.name],
      limit: 1,
    }),
  }) as SearchResult | null;
  return body?.results?.[0]?.id ?? null;
}

/** Only the keys that carry a value. HubSpot treats an empty string as an
 *  instruction to clear the property, so sending "" for a parish nobody has
 *  told us yet would wipe one somebody had already filled in by hand. */
function present(props: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(props).filter(([, v]) => typeof v === "string" && v.trim() !== ""),
  ) as Record<string, string>;
}

/**
 * Put a lead into the CRM, or bring the existing one up to date.
 *
 * Throws HubSpotError like everything else in this module. The caller decides
 * what that is worth: for the WhatsApp path it is worth a log line and nothing
 * more, because a CRM that missed a lead is a worse day and a client who was
 * not answered is a worse business.
 */
export async function upsertLead(lead: Lead): Promise<LeadResult> {
  if (!lead.jobId?.trim()) {
    throw new HubSpotError("A lead needs the job code. It is the only thing that stops a second sync making a second deal.");
  }

  // ── the idempotency key, checked before anything at all is written ─────
  //
  // This ran after the contact upsert until a test caught it. If the deal
  // search fails, which is exactly what happens when the one custom property
  // has not been created, a contact had already been written, so a broken
  // setup left a trail of contacts behind on every retry. Nothing is written
  // now until the thing that prevents duplicates is known to work.
  let existing: string | null;
  try {
    existing = await findDealByJobId(lead.jobId);
  } catch (e) {
    // The one setup step this feature has. Said in words rather than left as
    // HubSpot's own 400, which names the property but not what to do.
    throw new HubSpotError(
      `The deal property "${DEAL_PROPERTIES.jobId.name}" does not exist in this HubSpot portal, so a lead `
      + `cannot be synced without risking a duplicate deal every time. Create it as a single-line text `
      + `property on Deals (see RUNBOOK.md, "Turning the HubSpot lead sync on"). Underlying error: `
      + (e instanceof Error ? e.message : String(e)),
    );
  }

  // ── the person ─────────────────────────────────────────────────────────
  let contactId: string | null = null;
  if (lead.phone) {
    contactId = await findContactByPhone(lead.phone);
    // Standard properties only. contact_type and trade_specialization do exist
    // in this portal, but parish_of_property and how_they_found_us do not, and
    // one unrecognised property fails the whole write.
    const contactProps = present({
      phone: lead.phone,
      firstname: lead.name,
    });
    if (contactId) {
      await hubspotFetch(`/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`, {
        method: "PATCH",
        body: JSON.stringify({ properties: contactProps }),
      });
    } else {
      const madeContact = await hubspotFetch("/crm/v3/objects/contacts", {
        method: "POST",
        body: JSON.stringify({ properties: contactProps }),
      }) as { id?: string } | null;
      contactId = madeContact?.id ?? null;
    }
  }

  // ── the job ────────────────────────────────────────────────────────────
  // The facts that are cleared to leave, written as a sentence in the standard
  // description rather than as four custom properties that would each have to
  // be created first. Still no free text from the client: every value here
  // came off the classified card, not out of what they typed.
  const shape = [
    lead.trade ? `Trade: ${lead.trade}.` : "",
    lead.parish ? `Parish: ${lead.parish}.` : "",
    lead.urgency ? `Urgency: ${lead.urgency}.` : "",
    lead.source ? `Arrived by ${SOURCE_LABEL[lead.source] ?? lead.source}.` : "",
    `Yaadly job ${lead.jobId}.`,
  ].filter(Boolean).join(" ");

  const dealProps = present({
    dealname: `${lead.trade || "Property work"}, ${lead.parish || "Jamaica"} (${lead.jobId})`,
    pipeline: PIPELINE_ID,
    description: shape,
    [DEAL_PROPERTIES.jobId.name]: lead.jobId,
  });

  if (existing) {
    // The stage is deliberately absent from this update. A deal that has
    // already moved to Client Paid must not be dragged back to Inquiry by a
    // late redelivery of the message that created it; setDealStage() owns
    // every stage move and refuses to go backwards for exactly this reason.
    await hubspotFetch(`/crm/v3/objects/deals/${encodeURIComponent(existing)}`, {
      method: "PATCH",
      body: JSON.stringify({ properties: dealProps }),
    });
    return { contactId, dealId: existing, created: false };
  }

  const made = await hubspotFetch("/crm/v3/objects/deals", {
    method: "POST",
    body: JSON.stringify({
      properties: { ...dealProps, dealstage: DEAL_STAGES.INQUIRY_SCOPING },
    }),
  }) as { id?: string } | null;
  const dealId = made?.id;
  if (!dealId) throw new HubSpotError("HubSpot created a deal and did not return its id.");

  if (contactId) {
    // v4 default association. Failing to associate is not worth losing the
    // deal over: the deal exists and carries the job code, so a person can
    // join them by hand, whereas throwing here would lose both.
    try {
      await hubspotFetch(
        `/crm/v4/objects/contacts/${encodeURIComponent(contactId)}/associations/default/deals/${encodeURIComponent(dealId)}`,
        { method: "PUT", body: JSON.stringify([]) },
      );
    } catch (e) {
      console.error(`hubspot lead: deal ${dealId} was created but not linked to contact ${contactId}:`, e);
    }
  }

  return { contactId, dealId, created: true };
}
