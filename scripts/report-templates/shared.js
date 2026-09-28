// Pieces every template carries, written once.
const SOLE = "Supplied by Monique Sewell-Bennett, sole trader";
const LTD = "Yaadly Ltd, England and Wales no. 17358077";

const preparedBy = (extra) =>
  `**Prepared by Monique Sewell-Bennett**, seven years of UK construction and IoT project management, supplying professional services as a sole trader. ${extra}`;

// What she is, said plainly, so no report reads as the work of a profession
// she does not hold. Set 28 September 2026 on her instruction: the templates
// fit what she can legally and physically do, not what a surveyor issues.
const CAPACITY = "She is a project manager. She is not a chartered surveyor, a structural engineer, or a licensed electrician, plumber or pest control operator, and nothing in this report is offered as their work.";

// Who stood on the site and who wrote the report are often two people while
// she is in London, and a report has to say which, honestly.
const whoDidWhat = (attendRole) => [
  { h3: "Who did what" },
  { table: { head: ["Role", "Name", "Capacity", "How"], widths: [2.2, 1.8, 2.2, 1.6], rows: [
    [attendRole, "", "", "In person"],
    ["Reviewed the evidence and wrote this report", "Monique Sewell-Bennett", "Project manager, seven years UK construction", "In person  /  Remote"],
  ], firstBold: true } },
];

// The four things always sent to a named professional, from the services page.
const referOn = [
  "Valuation goes to a licensed valuer.",
  "Title and legal opinion go to an attorney.",
  "Structural engineering goes to a PERB registered engineer.",
  "Boundaries go to a commissioned land surveyor.",
];

const referralsTable = (n = 4) => ({
  table: { head: ["#", "Question", "Refer to", "Why it is outside this report", "Linked finding"], widths: [0.4, 3.2, 1.6, 2.6, 1], blank: n, number: true },
});

const photoLog = (n = 14, heading = true) => [
  ...(heading ? [] : []),
  { p: "Every photograph is numbered in the order it was taken and carries the time the camera recorded. A finding elsewhere in this report points to its photographs by these numbers." },
  { table: { head: ["Photo", "Time taken", "Where", "What it shows", "Linked item"], widths: [0.7, 1, 1.6, 4, 1], blank: n, number: true } },
  { small: "The full resolution photograph set is sent with this report as a separate folder, named with the reference on the cover." },
];

const disclosure = (who) => ({
  note: `**Related party disclosure.** ${who} no personal, family or business connection to the owner, the occupier, or anybody who carried out work at this property, and receives nothing from any of them. If that is not true, it is written here instead:`,
});

module.exports = { SOLE, LTD, CAPACITY, whoDidWhat, preparedBy, referOn, referralsTable, photoLog, disclosure };
