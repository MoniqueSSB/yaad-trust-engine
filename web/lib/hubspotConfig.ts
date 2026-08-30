/**
 * Single source of truth for HubSpot's schema and deal pipeline.
 *
 * Pipeline `default` ("Sales Pipeline"), verified live against the portal on
 * 30 Aug 2026. The seven stage IDs below are real.
 *
 * WHY THE KEYS DO NOT MATCH HUBSPOT'S LABELS: HubSpot ships this pipeline
 * named for a software sales cycle ("Decision Maker Bought-In"). Yaadly's
 * lifecycle is different, so the keys describe what the stage means to us and
 * the values are whatever HubSpot happens to call it. Renaming a stage's label
 * in the HubSpot UI does NOT change its internal ID, so these values stay
 * correct after the pipeline is relabelled. IDs only change if a stage is
 * deleted and recreated, which is why relabelling is the supported path.
 *
 * NAMING: the banned-term list in yaad/guardrails.py line 18 applies to stage
 * names too, not just client copy. Stage labels surface in deal notifications
 * and workflow emails, so a name that breaks the rule does reach clients.
 *
 * NOTE: no secrets here. The HubSpot service key lives in .env as
 * HUBSPOT_TOKEN and must never be committed.
 *
 * Not to be confused with STAGES in ./portal/journey.ts, which is the delivery
 * journey shown to clients. This file is the CRM side only.
 */

export const PIPELINE_ID = "default";

/** Yaadly's deal lifecycle, mapped onto HubSpot's real stage IDs. */
export const DEAL_STAGES = {
  INQUIRY_SCOPING: "appointmentscheduled",
  QUOTE_SENT: "qualifiedtobuy",
  FUNDS_HELD: "presentationscheduled",
  EVIDENCE_SUBMITTED: "decisionmakerboughtin",
  CLIENT_APPROVED: "contractsent",
  COMPLETED_PAID: "closedwon",
  CANCELLED: "closedlost",
} as const;

export type DealStageKey = keyof typeof DEAL_STAGES;
export type DealStageId = (typeof DEAL_STAGES)[DealStageKey];

/**
 * What each stage should be relabelled to in HubSpot. Settings > Data
 * Management > Objects > Deals > Pipelines. Relabel, never delete and recreate.
 */
export const STAGE_LABELS: Record<DealStageId, string> = {
  appointmentscheduled: "Inquiry and Scoping",
  qualifiedtobuy: "Quote Sent",
  presentationscheduled: "Funds Held",
  decisionmakerboughtin: "Evidence Submitted",
  contractsent: "Client Approved",
  closedwon: "Completed and Paid",
  closedlost: "Cancelled",
};

const STAGE_KEY_BY_ID = Object.fromEntries(
  Object.entries(DEAL_STAGES).map(([key, id]) => [id, key]),
) as Record<DealStageId, DealStageKey>;

/** HubSpot webhooks send the stage ID, not our key. Translate on the way in. */
export function stageKeyById(stageId: string): DealStageKey | null {
  return STAGE_KEY_BY_ID[stageId as DealStageId] ?? null;
}

/**
 * Stages where the client has paid but the worker has not been released.
 * Anything that releases or refunds money should ask this rather than compare
 * stage IDs by hand, so the rule lives in one place.
 */
export const FUNDS_HELD_STAGES: readonly DealStageId[] = [
  DEAL_STAGES.FUNDS_HELD,
  DEAL_STAGES.EVIDENCE_SUBMITTED,
  DEAL_STAGES.CLIENT_APPROVED,
];

export function isHoldingFunds(stageId: string): boolean {
  return FUNDS_HELD_STAGES.includes(stageId as DealStageId);
}

export type PropertyDef = {
  name: string;
  label: string;
  type: "dropdown" | "number" | "date" | "text";
  options?: readonly string[];
};

const PARISHES = [
  "Kingston", "St Andrew", "St Thomas", "Portland", "St Mary", "St Ann",
  "St Catherine", "Manchester", "Clarendon", "St Elizabeth", "Westmoreland",
  "Hanover", "St James", "Trelawny",
] as const;

export const CONTACT_PROPERTIES = {
  contactType: { name: "contact_type", label: "Contact type", type: "dropdown", options: ["Client", "Worker", "Inspector", "Other"] },
  certificationStatus: { name: "certification_status", label: "Certification status", type: "dropdown", options: ["JCF Police Check", "ID Verified", "Trade Certification", "None"] },
  tradeSpecialization: { name: "trade_specialization", label: "Trade specialization", type: "dropdown", options: ["Roofing", "Plumbing", "Electrical", "Carpentry", "Masonry", "Painting", "Tiling", "General repairs"] },
  yearsOfExperience: { name: "years_of_experience", label: "Years of experience", type: "number" },
  countryOfResidence: { name: "country_of_residence", label: "Country of residence", type: "dropdown", options: ["UK", "US", "Canada", "Jamaica"] },
  parishOfProperty: { name: "parish_of_property", label: "Parish of property", type: "dropdown", options: PARISHES },
  relationshipToProperty: { name: "relationship_to_property", label: "Relationship to property", type: "dropdown", options: ["Owner", "Family home", "Inherited", "Building new"] },
  howTheyFoundUs: { name: "how_they_found_us", label: "How they found us", type: "dropdown", options: ["WhatsApp", "Referral", "Instagram", "Word of mouth", "Search", "Other"] },
} satisfies Record<string, PropertyDef>;

export const DEAL_PROPERTIES = {
  projectType: { name: "project_type", label: "Project type", type: "dropdown", options: ["Repair", "Renovation", "New build", "Maintenance"] },
  estimatedStart: { name: "estimated_start", label: "Estimated start", type: "date" },
  estimatedCompletion: { name: "estimated_completion", label: "Estimated completion", type: "date" },
  service: { name: "service", label: "Service", type: "dropdown", options: ["Deposit Protection Check £149", "Project Setup Pack £399", "Oversight Retainer £350/mo"] },
  currency: { name: "currency", label: "Currency paid in", type: "dropdown", options: ["GBP", "USD", "CAD"] },
  quoteValueReviewed: { name: "quote_value_reviewed", label: "Quote value reviewed", type: "number" },
  parish: { name: "parish", label: "Parish", type: "dropdown", options: PARISHES },
  workType: { name: "work_type", label: "Work type", type: "dropdown", options: ["Labour only", "Materials + labour", "Full project management"] },
} satisfies Record<string, PropertyDef>;

export const TICKET_PROPERTIES = {
  issueCategory: { name: "issue_category", label: "Issue category", type: "dropdown", options: ["Payment dispute", "Work quality", "Missing materials", "Communication", "Other"] },
  resolutionDeadline: { name: "resolution_deadline", label: "Resolution deadline", type: "date" },
  issueSeverity: { name: "issue_severity", label: "Issue severity", type: "dropdown", options: ["Low", "Medium", "High", "Critical"] },
} satisfies Record<string, PropertyDef>;
