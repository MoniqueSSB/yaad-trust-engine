// hubspotConfig.js — single source of truth for the Yaadly portal & HubSpot
// Pipeline: default (Sales Pipeline). Stage IDs are real HubSpot values.
// NOTE: no secrets here. HubSpot token lives in .env, never in this file.

const PIPELINE_ID = "default";

const STAGES = {
  APPOINTMENT_SCHEDULED:    { id: "appointmentscheduled",    label: "Appointment Scheduled" },
  QUALIFIED_TO_BUY:         { id: "qualifiedtobuy",         label: "Qualified To Buy" },
  PRESENTATION_SCHEDULED:   { id: "presentationscheduled",  label: "Presentation Scheduled" },
  DECISION_MAKER_BOUGHT_IN: { id: "decisionmakerboughtin",  label: "Decision Maker Bought-In" },
  CONTRACT_SENT:            { id: "contractsent",           label: "Contract Sent" },
  CLOSED_WON:               { id: "closedwon",              label: "Closed Won" },
  CLOSED_LOST:              { id: "closedlost",             label: "Closed Lost" },
};

const CONTACT_PROPERTIES = {
  contactType:             { name: "contact_type",             label: "Contact type",             type: "dropdown", options: ["Client", "Worker", "Inspector", "Other"] },
  certificationStatus:     { name: "certification_status",     label: "Certification status",     type: "dropdown", options: ["JCF Police Check", "ID Verified", "Trade Certification", "None"] },
  tradeSpecialization:     { name: "trade_specialization",     label: "Trade specialization",     type: "dropdown", options: ["Roofing", "Plumbing", "Electrical", "Carpentry", "Masonry", "Painting", "Tiling", "General repairs"] },
  yearsOfExperience:       { name: "years_of_experience",      label: "Years of experience",      type: "number" },
  countryOfResidence:      { name: "country_of_residence",     label: "Country of residence",     type: "dropdown", options: ["UK", "US", "Canada", "Jamaica"] },
  parishOfProperty:        { name: "parish_of_property",       label: "Parish of property",       type: "dropdown", options: ["Kingston", "St Andrew", "St Thomas", "Portland", "St Mary", "St Ann", "St Catherine", "Manchester", "Clarendon", "St Elizabeth", "Westmoreland", "Hanover", "St James", "Trelawny"] },
  relationshipToProperty:  { name: "relationship_to_property", label: "Relationship to property",  type: "dropdown", options: ["Owner", "Family home", "Inherited", "Building new"] },
  howTheyFoundUs:          { name: "how_they_found_us",        label: "How they found us",        type: "dropdown", options: ["WhatsApp", "Referral", "Instagram", "Word of mouth", "Search", "Other"] },
};

const DEAL_PROPERTIES = {
  projectType:         { name: "project_type",          label: "Project type",          type: "dropdown", options: ["Repair", "Renovation", "New build", "Maintenance"] },
  estimatedStart:      { name: "estimated_start",       label: "Estimated start",       type: "date" },
  estimatedCompletion: { name: "estimated_completion",  label: "Estimated completion",  type: "date" },
  service:             { name: "service",              label: "Service",              type: "dropdown", options: ["Deposit Protection Check £149", "Project Setup Pack £399", "Oversight Retainer £350/mo"] },
  currency:            { name: "currency",             label: "Currency paid in",     type: "dropdown", options: ["GBP", "USD", "CAD"] },
  quoteValueReviewed:  { name: "quote_value_reviewed",  label: "Quote value reviewed",  type: "number" },
  parish:              { name: "parish",               label: "Parish",               type: "dropdown", options: ["Kingston", "St Andrew", "St Thomas", "Portland", "St Mary", "St Ann", "St Catherine", "Manchester", "Clarendon", "St Elizabeth", "Westmoreland", "Hanover", "St James", "Trelawny"] },
  workType:            { name: "work_type",             label: "Work type",            type: "dropdown", options: ["Labour only", "Materials + labour", "Full project management"] },
};

const TICKET_PROPERTIES = {
  issueCategory:      { name: "issue_category",       label: "Issue category",       type: "dropdown", options: ["Payment dispute", "Work quality", "Missing materials", "Communication", "Other"] },
  resolutionDeadline: { name: "resolution_deadline",  label: "Resolution deadline",   type: "date" },
  issueSeverity:      { name: "issue_severity",       label: "Issue severity",        type: "dropdown", options: ["Low", "Medium", "High", "Critical"] },
};

module.exports = { PIPELINE_ID, STAGES, CONTACT_PROPERTIES, DEAL_PROPERTIES, TICKET_PROPERTIES };
