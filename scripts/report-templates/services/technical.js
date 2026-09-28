const { SOLE, whoDidWhat, preparedBy, photoLog, disclosure, referralsTable } = require("../shared");

module.exports = {
  service: "Technical Sign-off",
  code: "TS",
  title: "Stage inspection and sign-off",
  blurb: "One stage of work, inspected by somebody who did not do it, against a standard written down before the visit. Released, released with conditions, or not released, with the reason for every line.",
  footer: SOLE,
  statuses: ["Released", "Released with conditions", "Not released"],
  coverFields: [
    ["Prepared for", ""], ["Property", ""],
    ["Stage inspected", ""], ["Trade", ""],
    ["Work carried out by", ""], ["Trade inspector and qualification", ""],
    ["Date of inspection", ""], ["Reference", ""],
  ],
  preparedBy: preparedBy("The workmanship is judged by a qualified inspector for that trade, named with their qualification in this report. She arranges the inspection, confirms the inspector is independent of the work, checks the record is complete, and issues it. She does not judge trade workmanship herself. The person who inspected the work is never the person who did it, and both are named on this report. A sign-off is an opinion on the work that could be seen on the day. It is not a warranty and it does not take away the builder's responsibility for the work."),
  blocks: [
    { contents: [
      ["A", "The result", "on one page"],
      ["B", "How to read this report", "the result and the marks on each line"],
      ["C", "About this inspection", "who, when, what was asked for"],
      ["D", "What the work was checked against", "written down before the visit"],
      ["E", "The checks", "line by line, with what was found"],
      ["F", "Put right list", "what must be done before release"],
      ["G", "Re-inspection", "when a put right is checked"],
      ["H", "Questions for other professionals", "outside a workmanship inspection"],
      ["I", "Photographs", "numbered and timed"],
      ["J", "What this sign-off is and is not", "and the signatures"],
    ] },

    { h: "A. The result" },
    { tick: [
      ["Released", "The stage meets the standard in section D. The next stage can start."],
      ["Released with conditions", "It can go ahead once the items named below are put right. They must be closed before the work is covered up."],
      ["Not released", "Do not start the next stage, and do not cover this work up. The put right list is in section F."],
    ] },
    { kv: [["Conditions, by item number", ""], ["Put right items open", ""], ["Re-inspection needed", "Yes  /  No"]], cols: 3 },
    { lines: 3, label: "In plain English" },

    { h: "B. How to read this report" },
    { p: "This stage is a **hold point**: the next stage of work should not start, and this work should not be covered up, until it is released in writing. Once concrete is poured or a wall is plastered, what is underneath cannot be checked again." },
    { h3: "Each line carries one of these" },
    { key: [
      ["Pass", "ok", "Meets the standard in section D.", "What was found is written against it, in words."],
      ["Fail", "severe", "Does not meet the standard.", "It goes on the put right list in section F."],
      ["Not seen", "na", "Could not be seen or reached.", "The reason is written against it. Not seen is not a pass."],
      ["Referred on", "ref", "Needs another profession.", "See section H."],
    ] },
    { h3: "Each put right item is dealt with in one of these ways" },
    { key: [
      ["Repair", "moderate", "Brought up to the standard.", ""],
      ["Redo", "moderate", "Taken out and done again to the standard.", ""],
      ["Replace", "severe", "The material or item is rejected and replaced.", ""],
      ["Accept as is", "na", "Your decision, never ours.", "Only in writing from you, with the reason recorded, and never for anything that affects safety."],
    ] },

    { h: "C. About this inspection" },
    { kv: [
      ["Inspection asked for by", ""], ["Asked for on", ""], ["Notice given", ""],
      ["Time in", ""], ["Time out", ""], ["Weather", ""],
      ["Present on site", ""], ["Builder or trade present", "Yes  /  No"], ["Job or contract reference", ""],
    ] },
    ...whoDidWhat("Trade inspector: attended and judged the workmanship"),
    { kv: [["Inspector's trade qualification", ""], ["Issued by, or where it can be checked", ""]], cols: 2 },
    disclosure("The inspector has"),
    { lines: 1 },

    { h: "D. What the work was checked against" },
    { p: "Written down before the visit, so the standard is never decided after the work is seen. The client and the trade both have a copy." },
    { table: { head: ["#", "Standard or document", "Reference, date or version", "Held by"], widths: [0.35, 3.6, 2.4, 1.6], rows: [
      ["1", "Agreed scope of work for this job", "", ""],
      ["2", "Drawings, if any", "", ""],
      ["3", "Manufacturer's installation instructions", "", ""],
      ["4", "Jamaica Building Code, where it applies", "", ""],
      ["5", "", "", ""],
    ] } },

    { pb: true },
    { h: "E. The checks" },
    { p: "Every line has a pass mark written before the visit that can be seen to be true or not, never \"looks fine\": \"every tile bedded, none hollow when tapped\", \"no gap between frame and wall\", \"falls to the drain, no standing water after a bucket test\"." },
    { table: { head: ["#", "What was checked", "Pass mark", "How", "Found", "Result", "Photos"], widths: [0.35, 2.4, 2, 0.8, 1.2, 0.8, 0.7], blank: 14, number: true, tall: false } },
    { small: "How: seen, or tested (tapped, run, filled, switched on). Found: what was actually there, in words. Yaadly states no dimension; where a tolerance matters, it is referred to an engineer or surveyor." },

    { h: "F. Put right list" },
    { table: { head: ["#", "Line", "What is wrong", "Where", "What must be done", "How dealt with", "By", "Photos"], widths: [0.35, 0.5, 2, 1, 2, 1, 0.8, 0.7], blank: 6, number: true } },
    { small: "Each item states the fact and the requirement it misses, not an opinion. Who pays for a re-inspection follows who was at fault, as set out in the agreement." },

    { h: "G. Re-inspection" },
    { table: { head: ["Item", "Re-inspected on", "Before photo", "After photo", "Result", "Closed by"], widths: [0.7, 1.2, 1, 1, 1.2, 1.6], blank: 6 } },
    { tick: [["Released", ""], ["Released with conditions", ""], ["Not released", ""]] },

    { h: "H. Questions for other professionals" },
    { p: "A workmanship inspection judges the work against the standard for the trade. It does not judge whether the design is adequate. Structural engineering goes to a PERB registered engineer; valuation, title and boundaries go to the right licensed professional." },
    referralsTable(3),

    { h: "I. Photographs" },
    ...photoLog(12),

    { h: "J. What this sign-off is and is not" },
    { p: "It is an opinion, to the best of the inspector's knowledge and belief, that the work that could be seen on the day met the standard in section D. It does not cover work that was hidden, covered or could not be reached; it does not judge the adequacy of the design or the structure; it does not say how the work will perform in future; it is not a warranty or a guarantee; and it does not take away any of the builder's responsibility for the work. Leaving something off the put right list does not make it acceptable." },
    { p: "It does not replace the inspections the municipal corporation makes at its own stages, such as foundation, steel and decking, or any certificate a regulator issues." },
    { h3: "Signatures" },
    { p: "**Inspector's declaration.** I inspected the work described on the date above. The results in section E and the put right list in section F are my own judgement of the workmanship against the standard in section D." },
    { sign: ["Trade inspector", "Date", "Issued for Yaadly by", "Date"] },
    { sign: ["Trade, to confirm receipt", "Date", "Client, to confirm receipt", "Date"] },
    { tick: [["Copy to client", ""], ["Copy to trade", ""], ["Copy to file", ""]] },
  ],
};
