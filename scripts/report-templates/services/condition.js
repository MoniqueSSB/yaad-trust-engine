const { SOLE, CAPACITY, whoDidWhat, preparedBy, photoLog, disclosure, referralsTable } = require("../shared");

// One section per element: how it was seen, what is looked at, the findings.
const element = (letter, code, name, looks) => [
  { h: `${letter}. ${name}` },
  { kv: [["How it was seen", ""], ["What could not be seen, and why", ""], ["Worst rating in this section", ""]], cols: 3 },
  { small: "**What is looked at:** " + looks },
  { table: { head: ["#", "Finding, worst first", "Where", "Rating", "Photos", "What to do, and who"], widths: [0.45, 2.9, 1.2, 0.9, 0.7, 2.4], blank: 4, number: code } },
];

module.exports = {
  service: "Condition Report",
  code: "CR",
  title: "The condition of your property",
  blurb: "Every part of the property that could be seen, inspected and rated, from roof to boundary wall, with the worst first. What needs doing, how soon, and who to ask. Issued to you in draft for comment before it is signed off.",
  footer: SOLE,
  statuses: ["Draft for comment", "Issued"],
  coverFields: [
    ["Prepared for", ""], ["Property", ""],
    ["Parish", ""], ["Date of inspection", ""],
    ["Draft issued", ""], ["Final issued", ""],
    ["Attended by", ""], ["Reference", ""],
  ],
  preparedBy: preparedBy("Every finding in this report is rated by her and nobody else, from what was seen on site and the photographs taken there. " + CAPACITY + " What it does not do: value the property, confirm title, give a structural engineering opinion, set boundaries, or estimate what the repairs should cost."),
  blocks: [
    { contents: [
      ["A", "How to read this report", "the ratings and what each one asks of you"],
      ["B", "About this inspection", "who, when, the weather, what could be reached"],
      ["C", "The property", "what it is and how it is served"],
      ["D", "At a glance", "every section's worst rating, and the severe findings"],
      ["E", "Roof", "coverings, fixings, gutters, the roof from inside"],
      ["F", "Structure", "walls, columns, beams, slabs, movement"],
      ["G", "Water", "supply, storage, pipework, damp"],
      ["H", "Electrics", "as seen, not tested"],
      ["I", "Drainage", "rainwater, waste, septic and absorption pit"],
      ["J", "Termites and timber", "signs of activity and conditions that invite it"],
      ["K", "Security provision", "gates, grilles, locks, lighting"],
      ["L", "External works", "boundary, yard, retaining walls, trees"],
      ["M", "What to do now", "in order"],
      ["N", "Documents to get and questions for other professionals", "by profession"],
      ["O", "Your comments on the draft", "and what changed because of them"],
      ["P", "Photographs", "numbered and timed"],
      ["Q", "What this report is and is not", "limits, and the declaration"],
    ] },

    { h: "A. How to read this report" },
    { p: "Every finding carries one rating. Within each section the worst finding is written first. Each rating tells you what to do and how soon, so you can act on the report without having to interpret it." },
    { key: [
      ["Severe", "severe", "Deal with it now.", "Left alone it is likely to cause serious damage, a safety risk, or a much bigger repair. Get it investigated or repaired before anything else."],
      ["Moderate", "moderate", "Plan to deal with it.", "It needs repairing or replacing, but it is not urgent. Budget for it in the coming months."],
      ["Low", "low", "Normal upkeep.", "No repair needed now. Keep it maintained and watch it."],
    ] },
    { p: "Two other marks appear:" },
    { key: [
      ["Not inspected", "na", "Could not be seen or reached.", "The reason is written in that section. Not inspected is not the same as fine."],
      ["Referred on", "ref", "Needs another profession to answer.", "See section N."],
    ] },
    { small: "Yaadly never states a dimension: size is described in words, by comparison with something everybody knows (\"a crack as fine as a hair\", \"a crack a coin edge would fit in\", \"a stain about the size of a dinner plate\", \"most of the ceiling\"). Where a size matters to a decision, it is referred to a surveyor or engineer. Left and right are as you face the part being described; the front is the side facing the road." },

    { h: "B. About this inspection" },
    { kv: [
      ["Attended by", ""], ["Date", ""], ["Time in and out", ""],
      ["Weather on the day", ""], ["Weather in the days before", ""], ["Occupied or empty", ""],
      ["Furnished", "Yes  /  Part  /  No"], ["Access gained by", ""], ["Present", ""],
    ] },
    { p: "How the evidence was gathered: on foot, from the ground and from inside, to Yaadly's checklist, with a photograph of every part in sections E to L and a short video walk round. Roofs were seen from the ground. Nothing was climbed, opened up, lifted or moved, and no services were tested." },
    { tick: [["Moisture meter used", "Shows only whether a surface is damp or dry"], ["Walk round video taken", ""], ["Reviewed remotely", "From the photographs and video"]] },
    ...whoDidWhat("Attended the property and took the photographs"),
    disclosure("Nobody named above has"),
    { lines: 1 },

    { h: "C. The property" },
    { kv: [
      ["Type", ""], ["Approximate age", ""], ["Storeys", ""],
      ["Walls", ""], ["Roof", ""], ["Floors", ""],
      ["Water supply", "Mains  /  Tank  /  Both"], ["Waste", "Mains  /  Septic  /  Absorption pit"], ["Power", "Grid  /  Solar  /  Generator"],
    ] },

    { pb: true },
    { h: "D. At a glance" },
    { table: { head: ["Section", "Worst rating", "Severe", "Moderate", "Low", "Not inspected"], widths: [2.4, 1.3, 0.9, 0.9, 0.9, 1.2], rows: [
      ["E  Roof", "", "", "", "", ""], ["F  Structure", "", "", "", "", ""], ["G  Water", "", "", "", "", ""], ["H  Electrics", "", "", "", "", ""],
      ["I  Drainage", "", "", "", "", ""], ["J  Termites and timber", "", "", "", "", ""], ["K  Security provision", "", "", "", "", ""], ["L  External works", "", "", "", "", ""],
    ], firstBold: true } },
    { h3: "Found or not found" },
    { table: { head: ["", "Found", "Not found", "Where in this report"], widths: [3, 1, 1, 3], rows: [
      ["A risk to somebody's safety", "", "", ""], ["Active water getting in", "", "", ""], ["Signs of live termites", "", "", ""], ["Signs of structural movement", "", "", ""],
    ], firstBold: true } },
    { h3: "The severe findings" },
    { table: { head: ["Finding", "What it is", "What to do now"], widths: [0.8, 3.6, 3.4], blank: 4 } },
    { note: "This page is a summary. It is not the report, and it should not be relied on without the sections behind it.", tone: "warn" },

    { pb: true },
    ...element("E", "E", "Roof", "zinc sheet or tile covering and its gauge, fixings and their rust, ridge and end caps, hurricane straps or clips from rafter to wall plate (the weakest type seen, or unknown), wall plates for rot and termites, overhangs and eaves, a concrete roof slab for cracks and ponding, gutters and downpipes, stains on ceilings from inside."),
    ...element("F", "F", "Structure", "what can be seen of block walls, columns, beams and slabs: cracks by direction and how fine or wide they look, especially diagonal cracks at windows and doors; rust staining and concrete breaking away over steel; bulging, leaning or sagging; sloping or hillside ground. Whether a structure is sound is a question for a PERB registered engineer; this section records what was seen and whether to call one."),
    ...element("G", "G", "Water", "supply and meter, water tank and its stand or roof platform, tie downs, lid, overflow, pump and pressure tank, water heater, visible pipework, leaks under sinks and around toilets, whether walls and floors read damp or dry."),
    ...element("H", "H", "Electrics", "the board with its cover on, visible wiring, sockets and switches for damage or scorching, outside cables, solar and generator connections, as seen only. Nothing is tested or opened. Whether an installation is safe is for a licensed electrician, and anything that looks wrong is referred to one in section N."),
    ...element("I", "I", "Drainage", "gutters to ground, surface water around the house, rainwater kept apart from waste, inspection chambers, septic tank and absorption pit: covers, smell, wet ground, distance from the tank and any well."),
    ...element("J", "J", "Termites and timber", "signs that can be seen: mud tubes, small piles of tiny pellets under pin holes, blistered or hollow timber in the roof, doors, frames and cupboards, rot, timber touching soil, leaks that keep wood wet. Confirming termites, which kind, and how far the damage goes is for a pest control operator, and any sign is referred to one in section N."),
    ...element("K", "K", "Security provision", "gates and boundary, grilles and burglar bars, and whether bedroom grilles open from inside for escape in a fire, locks, outside lighting, alarm if any."),
    ...element("L", "L", "External works", "boundary and retaining walls, yard and driveway, paths and steps, drainage channels, trees and palms near the house or over the roof, outbuildings."),

    { h: "M. What to do now" },
    { p: "In the order to do it. Where a repair needs pricing, get at least two written quotes against the same description of the work." },
    { table: { head: ["#", "What to do", "Findings", "Who", "When"], widths: [0.35, 3.6, 1, 1.6, 1.2], blank: 6, number: true } },

    { h: "N. Documents to get and questions for other professionals" },
    { table: { head: ["#", "Document to get", "From", "Why", "Findings"], widths: [0.35, 2.6, 1.4, 2.8, 0.9], blank: 3, number: true } },
    referralsTable(4),

    { h: "O. Your comments on the draft" },
    { p: "The report is sent to you in draft first. Your comments are recorded here with what changed because of them. A rating is changed only where the comment gives new facts; it is not changed on request." },
    { table: { head: ["#", "Your comment", "Received", "What changed, or why not"], widths: [0.35, 3.4, 1, 3.4], blank: 4, number: true } },

    { h: "P. Photographs" },
    ...photoLog(20),

    { h: "Q. What this report is and is not" },
    { p: "It is a visual record of the parts of the property that could be seen and safely reached on the day, and a project manager's rating of what to do about each thing found. It is not a building survey or a structural engineering survey, a valuation, a legal or title opinion, or a boundary survey, and those questions are referred to a PERB registered engineer, a licensed valuer, an attorney and a commissioned land surveyor. Services were seen and not tested. Nothing was opened up, so hidden defects may exist that could not be found. It gives no estimate of repair costs. It describes condition on the day of the inspection only, and it is for the person named on the cover. It is not a warranty or a guarantee." },
    { h3: "Declaration" },
    { p: "I reviewed the evidence gathered at the property on the date above, by the person named in section B, and rated every finding myself. This report is a true account of that evidence, and I have not understated or overstated anything in it. I am a project manager, and this is not a building survey." },
    { sign: ["Attended by", "Date", "Reviewed and rated by", "Date"] },
  ],
};
