const { SOLE, preparedBy, disclosure, referralsTable } = require("../shared");

// The same sections, in the same order, as the document the desk prints for a
// drafted Deposit Protection Check (reportDocumentHtml in concierge.html), so
// a check done by hand and a check drafted by the agent read as one product.
// The checklist lines and the payment terms are the house standard from
// supabase/functions/yaad-report/index.ts; keep the three in step.
const CHECKLIST = [
  "Contractor named on the quote", "Business registration or TRN", "Verifiable address and a number other than WhatsApp", "Independent trace of the business",
  "Quote in writing and dated", "Quote itemised by element of work", "Labour and materials separated", "Quantities and specification stated",
  "Who supplies the materials", "Who owns the materials once paid for", "Who receives deliveries on site", "Waste removal and clean up",
  "Payment structure written down", "Payment to an account in the contractor's own name", "No request for cash", "What the client is exposed to at each stage", "Receipt for anything already paid",
  "Insurance held by the contractor", "Who else will work on site", "Guarantee on the finished work", "Permissions needed for the work",
  "Start date, working duration and completion date", "What happens if the contractor is late", "What happens if the client stops the work", "How a disagreement is settled",
];
const TERMS = [
  ["Money before work", "Nothing before the materials are on site. The first payment is stage 1 of the schedule."],
  ["Who is paid", "An account in the contractor's own name, confirmed in writing, or the materials supplier directly."],
  ["How it is paid", "Bank transfer only. Never cash, and never a transfer to a person collecting on their behalf."],
  ["Materials", "Supplier invoices made out in your name. Pay the supplier directly if the contractor agrees."],
  ["Stages", "Paid in stages, each only against the evidence in the payment schedule."],
  ["When a stage is paid", "Within two working days of the evidence arriving, so the contractor is never kept waiting once the work is proven."],
  ["Receipts", "A written receipt for every payment, dated, naming the stage."],
  ["The last payment", "Paid only once a snag list is agreed and every item on it is signed off."],
  ["Currency", "Each stage fixed in Jamaican dollars in writing, so an exchange rate move does not change what is owed."],
  ["If work stops", "If no work happens for ten working days without a written reason, no further stage is paid until you have both agreed a new date in writing."],
  ["Changes", "No extra work is paid unless it is agreed in writing before it starts."],
];

module.exports = {
  service: "Deposit Protection Check",
  code: "DPC",
  title: "Before you send the deposit",
  blurb: "Your builder and their quote, checked before any money moves. What is wrong with the arrangement as it stands, the payment terms to put in its place, and exactly what to send the builder, in plain English.",
  footer: SOLE,
  statuses: ["Draft", "Issued"],
  coverFields: [
    ["Prepared for", ""], ["Property", ""],
    ["Prepared", ""], ["Reference", ""],
  ],
  preparedBy: preparedBy("Every finding in this report is rated, and the verdict written, by her and nobody else. What it does not do: value the property, confirm title, give a structural opinion, or estimate what the work should cost."),
  blocks: [
    { contents: [
      ["A", "How to read this report", "the ratings and what each one asks of you"],
      ["B", "About this review", "who, when, what was received, what was checked"],
      ["C", "At a glance", "the verdict, the red flags, the documents to get"],
      ["D", "What to do now", "the next steps, in order"],
      ["E", "The red flags", "each one, why it matters, what to do, where it came from"],
      ["F", "The quote, marked up", "the builder's own page, numbered against the red flags"],
      ["G", "Payment terms", "as the builder proposed them, and what to put in their place"],
      ["H", "Payment schedule", "the order money moves in, and the evidence before each stage"],
      ["I", "The message to send your builder", "ready to copy"],
      ["J", "What was checked", "the full list, including what was fine"],
      ["K", "Scope of work and changes", "what is agreed, what is not, how a change is handled"],
      ["L", "Questions for other professionals", "by profession"],
      ["M", "What this review is and is not", "limits, and the reviewer's declaration"],
      ["N", "Appendix: what the documents said", "word for word"],
    ] },

    { h: "A. How to read this report" },
    { p: "Every red flag carries one of three ratings. Each rating tells you what to do about it and by when, so you can act on this report without having to interpret it." },
    { key: [
      ["Severe", "severe", "Do not pay anything until this is resolved in writing.", "Paying first leaves you exposed in a way that is hard or impossible to recover from abroad."],
      ["Moderate", "moderate", "Resolve before the second payment.", "It will not stop the job starting, but left alone it is where a dispute later comes from."],
      ["Low", "low", "Get it in writing when convenient.", "Good practice, and a builder who agrees easily is a good sign."],
    ] },
    { p: "In the checklist, each line carries one of these:" },
    { key: [
      ["Provided", "ok", "The builder has given it, in writing.", ""],
      ["Not provided", "gap", "Not in anything received.", "A gap in the paperwork, not an accusation."],
      ["Not found", "gap", "Looked for independently and could not be found.", ""],
      ["Referred on", "ref", "A question for another profession.", "See section L."],
      ["Not applicable", "na", "Does not arise on this job.", ""],
    ] },

    { h: "B. About this review" },
    { kv: [["Reviewer", ""], ["Review type", "Desk review  /  With a site visit"], ["Reference", ""], ["Drafted", ""], ["Report issued", ""], ["Next payment asked for", ""]] },
    disclosure("The reviewer has"),
    { lines: 1 },
    { table: { head: ["#", "Document received", "Dated", "Form"], widths: [0.35, 4.4, 1.4, 1.8], blank: 5, number: true } },
    { lines: 2, label: "Checked independently by the reviewer" },

    { pb: true },
    { h: "C. At a glance" },
    { kv: [["Verdict, in one line", ""]], cols: 1 },
    { lines: 3, label: "The verdict, in a paragraph" },
    { table: { head: ["", "As the builder proposed it", "As this report proposes it"], widths: [1, 3, 3], rows: [["Payment", "", ""], ["Detail", "", ""]], firstBold: true } },
    { table: { head: ["#", "Red flag", "Rating", "Resolve by"], widths: [0.35, 4.4, 1.2, 2], blank: 6, number: true } },
    { h3: "Documents to get before you pay. Tick each one as it arrives." },
    { table: { head: ["Document", "Needed for", "Received"], widths: [4.6, 1.8, 1.2], blank: 5 } },

    { h: "D. What to do now" },
    { table: { head: ["#", "Step", "Who", "When"], widths: [0.35, 4.6, 1.4, 1.4], blank: 6, number: true } },

    { pb: true },
    { h: "E. The red flags" },
    { p: "One block per red flag. The rating is written by the reviewer, never drafted." },
    ...[1, 2, 3].flatMap((n) => [
      { h3: `Red flag ${n}` },
      { kv: [["Heading", ""], ["Rating", "Severe  /  Moderate  /  Low"], ["Where it came from", ""]], cols: 3 },
      { table: { head: ["What was found", "Why it matters", "What to do"], widths: [1, 1, 1], rows: [["", "", ""]], tall: true } },
    ]),

    { h: "F. The quote, marked up" },
    { p: "The builder's quote reproduced line by line, as written, with the number of each red flag it bears on beside it." },
    { table: { head: ["Line", "As the builder wrote it", "Red flags"], widths: [0.6, 6, 1], blank: 10, number: true } },

    { pb: true },
    { h: "G. Payment terms" },
    { p: "The left column is what the builder proposed. The right column is Yaadly's standard, the same on every check." },
    { table: { head: ["Term", "As the builder proposed it", "What to agree instead"], widths: [1.4, 2.6, 3.8], rows: TERMS.map(([t, i]) => [t, "", i]), firstBold: true } },

    { h: "H. Payment schedule" },
    { p: "The order money should move in, and what must exist before each stage is paid. No stage is a share or a percentage here: the shares are agreed between you and the builder." },
    { table: { head: ["Stage", "When", "Evidence before it is paid"], widths: [0.8, 3, 4], blank: 5, number: true } },

    { h: "I. The message to send your builder" },
    { p: "Ready to copy and send as it stands." },
    { lines: 10 },

    { pb: true },
    { h: "J. What was checked" },
    { table: { head: ["#", "Checked", "State", "Note"], widths: [0.35, 3.6, 1.3, 2.7], rows: CHECKLIST.map((c, i) => [String(i + 1), c, "", ""]) } },

    { h: "K. Scope of work and changes" },
    { table: { head: ["What the quote covers", "What the quote does not say"], widths: [1, 1], blank: 6 } },
    { p: "**How a change is handled.** Stop, write down what changed and what it does to time and price, and agree it in writing before carrying on." },

    { h: "L. Questions for other professionals" },
    referralsTable(4),

    { h: "M. What this review is and is not" },
    { p: "It is a review of the contractor, the quote and the arrangement as they stood in the documents received, on the date above. It does not value the property, confirm title or ownership, give a structural opinion, set a boundary, or estimate what the work should cost, and those questions are referred on in section L. It is not a warranty or a guarantee that the contractor will perform." },
    { h3: "Declaration" },
    { p: "I reviewed the documents listed in section B. Every finding in this report is rated, and the verdict written, by me. It is a true account of what the documents said and what I found." },
    { sign: ["Reviewer", "Date", "Sent to", "Date"] },

    { pb: true },
    { h: "N. Appendix: what the documents said" },
    { p: "Word for word, so the report can be checked against its source." },
    { lines: 16 },
  ],
};
