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

/**
 * Yaadly's deal lifecycle, mapped onto HubSpot's real stage IDs.
 *
 * FUNDS_HELD WAS RENAMED TO CLIENT_PAID on 4 September 2026, and the label
 * with it. On 3 September Yaadly became principal on every lane: the client
 * buys the job from Yaadly at one agreed price, and Yaadly engages and pays
 * the tradesperson. There is no pot of the client's money sitting anywhere
 * waiting to be released, so a board column reading "Funds Held" described a
 * structure the business had stopped operating, in the one place the file's
 * own header warns about: stage labels surface in deal notifications and
 * workflow emails, so a wrong name does reach clients.
 *
 * The stage ID underneath is untouched. Renaming a label in the HubSpot UI
 * does not change its internal ID, which is exactly why relabelling is the
 * supported path and deleting and recreating is not.
 */
export const DEAL_STAGES = {
  INQUIRY_SCOPING: "appointmentscheduled",
  QUOTE_SENT: "qualifiedtobuy",
  CLIENT_PAID: "presentationscheduled",
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
  presentationscheduled: "Client Paid",
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
 * Stages where the client has paid Yaadly and Yaadly has not yet paid the
 * tradesperson. Anything about paying a worker or refunding a client should
 * ask this rather than compare stage IDs by hand, so the rule lives in one
 * place.
 *
 * Renamed from FUNDS_HELD_STAGES / isHoldingFunds on 4 September 2026. The
 * membership is identical; the old names described Yaadly as holding somebody
 * else's money, which under the principal structure is both wrong and the
 * specific reading CLAUDE.md section 8 exists to prevent.
 */
export const OWED_TO_WORKER_STAGES: readonly DealStageId[] = [
  DEAL_STAGES.CLIENT_PAID,
  DEAL_STAGES.EVIDENCE_SUBMITTED,
  DEAL_STAGES.CLIENT_APPROVED,
];

export function isOwedToWorker(stageId: string): boolean {
  return OWED_TO_WORKER_STAGES.includes(stageId as DealStageId);
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
  certificationStatus: { name: "certification_status", label: "Certification status", type: "dropdown", options: ["ID Verified", "Trade Certification", "None"] },
  // The eighteen trades from data/job-taxonomy.js, which is the generated
  // source of truth for every trade dropdown in the product and is what the
  // WhatsApp assistant, the job form and the board all use. This field carried
  // a different, shorter list of eight with different names ("Carpentry",
  // "General repairs"), so a worker's trade in the CRM could not be matched to
  // a worker's trade anywhere else without a translation nobody had written.
  // Corrected 4 September 2026. If job-taxonomy.js changes, change this.
  tradeSpecialization: { name: "trade_specialization", label: "Trade specialization", type: "dropdown", options: [
    "Plumbing", "Roofing", "Electrical", "Tiling", "Masonry & Concrete",
    "Painting & Decorating", "Grille & Gate Welding", "Air Conditioning",
    "Landscaping", "General Handyman", "Solar Install", "Water Tank & Pump",
    "Locks & Security Doors", "Windows & Glazing", "Carpentry & Joinery",
    "Drainage & Septic", "Fencing", "CCTV & Alarms",
  ] },
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
  // NAMES ONLY, NO PRICES, 4 September 2026. This dropdown carried "Deposit
  // Protection Check £149, Project Setup Pack £399, Oversight Retainer
  // £350/mo", and by the time anybody looked all three were wrong: the first
  // two prices had moved, the retainer was published at £395, and Project
  // Setup Pack was deactivated in the catalogue by 20260903h. A price written
  // into a CRM dropdown label is a fourth copy of a number that already lives
  // in service_catalogue, docs/services.html and faq.ts, and it is the copy
  // nobody remembers to update. service_catalogue is the only place a price
  // may come from; this field says which service, and nothing else.
  //
  // The list is the nine rows with active = true, read live on 4 Sep 2026.
  service: { name: "service", label: "Service", type: "dropdown", options: [
    "Visual Check",
    "Deposit Protection Check",
    "Condition Report",
    "Technical Sign-off",
    "Oversight Retainer",
    "Oversight Retainer, On The Ground",
    "Property Care, standard home",
    "Property Care, large home",
    "Property Care, villa",
  ] },
  currency: { name: "currency", label: "Currency paid in", type: "dropdown", options: ["GBP", "USD", "CAD"] },
  quoteValueReviewed: { name: "quote_value_reviewed", label: "Quote value reviewed", type: "number" },
  parish: { name: "parish", label: "Parish", type: "dropdown", options: PARISHES },
  workType: { name: "work_type", label: "Work type", type: "dropdown", options: ["Labour only", "Materials + labour", "Full project management"] },
  // The job's own code, and the reason a lead can be synced twice without
  // producing two deals. Added 4 September 2026 with the WhatsApp lead sync:
  // a redelivered message, a client who confirms twice, or a retry all reach
  // the same job, and without something to search on, each one would create a
  // fresh deal and the board would start lying about the size of the pipeline.
  //
  // THE ONLY ENTRY IN THIS FILE THE LEAD SYNC ACTUALLY DEPENDS ON. Everything
  // else here is a specification of what should be created in HubSpot, not a
  // record of what has been: checked against the live portal on 4 September
  // 2026, and most of it does not exist there. Since HubSpot rejects an entire
  // write for one unrecognised property, hubspotLeads.ts uses standard
  // properties plus this one and nothing else. Must exist as a single-line
  // text property; see RUNBOOK.md, "Turning the HubSpot lead sync on".
  jobId: { name: "yaadly_job_id", label: "Yaadly job code", type: "text" },
} satisfies Record<string, PropertyDef>;

export const TICKET_PROPERTIES = {
  issueCategory: { name: "issue_category", label: "Issue category", type: "dropdown", options: ["Payment dispute", "Work quality", "Missing materials", "Communication", "Other"] },
  resolutionDeadline: { name: "resolution_deadline", label: "Resolution deadline", type: "date" },
  issueSeverity: { name: "issue_severity", label: "Issue severity", type: "dropdown", options: ["Low", "Medium", "High", "Critical"] },
} satisfies Record<string, PropertyDef>;
