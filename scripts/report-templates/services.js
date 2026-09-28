// The templates, in the order the desk lists them. The slug is the file name
// on the desk (templates/<slug>.pdf and .docx); the kind is the report kind
// the agent drafts for this service, or null where the template is used by
// hand only, which today is the site sketchpad.
module.exports = [
  { slug: "deposit-protection-check", kind: "deposit_check", file: "deposit-check" },
  { slug: "visual-check", kind: "visual_check", file: "visual-check" },
  { slug: "condition-report", kind: "condition", file: "condition" },
  { slug: "technical-sign-off", kind: "technical_signoff", file: "technical" },
  { slug: "property-care", kind: "property_care", file: "property-care" },
  { slug: "oversight-retainer", kind: "oversight", file: "oversight" },
  { slug: "full-project-management", kind: "pm_stage", file: "full-pm" },
  { slug: "site-sketchpad", kind: null, file: "site-sketchpad" },
].map((t) => ({ ...t, doc: require("./services/" + t.file) }));
