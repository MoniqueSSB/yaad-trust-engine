const { SOLE, whoDidWhat, preparedBy, photoLog } = require("../shared");

const item = (area, rows) => ({
  table: {
    head: ["#", area, "Today", "Since last visit", "Photos", "What was seen"],
    widths: [0.35, 2.6, 1.05, 1.25, 0.75, 3.2],
    rows: rows.map((r, i) => [String(i + 1), r, "", "", "", ""]),
    firstBold: false,
  },
});

module.exports = {
  service: "Property Care",
  code: "PC",
  title: "Property care visit record",
  blurb: "The same checklist, run the same way on every visit, so that anything new at your property stands out. What was seen, what has changed since last time, and what needs a decision from you.",
  footer: SOLE,
  statuses: ["Routine visit", "Pre storm", "Post storm", "Extra visit"],
  coverFields: [
    ["Prepared for", ""], ["Property", ""],
    ["Parish", ""], ["Home size", "Standard  /  Large or rental  /  Villa"],
    ["Visit date", ""], ["Visit number in plan", ""],
    ["Plan", "Monthly  /  Fortnightly  /  Weekly"], ["Reference", ""],
  ],
  preparedBy: preparedBy("The visit is a visual walk round of the areas that could be reached on the day. It is not a survey, a security patrol, or care for anybody living at the property."),
  blocks: [
    { contents: [
      ["A", "How to read this record", "the marks on each line"],
      ["B", "This visit", "who, when, how long, how access was gained"],
      ["C", "Needs your decision", "the short list, first"],
      ["D", "Readings", "the numbers taken every visit"],
      ["E", "Outside", "gate to roof line"],
      ["F", "Inside", "room by room"],
      ["G", "Water, power and drains", "run, flushed, checked"],
      ["H", "Pests, damp and storm", "the things that grow while nobody is home"],
      ["I", "If somebody lives here", "what was seen and passed on, nothing more"],
      ["J", "Carried forward", "open items from earlier visits"],
      ["K", "Photographs", "numbered and timed"],
      ["L", "Leaving the property", "and the next visit"],
    ] },

    { h: "A. How to read this record" },
    { p: "Every line is marked twice. **Today** is what was seen on this visit. **Since last visit** is what makes this record useful over time: anything marked New is the first place to look." },
    { h3: "Today" },
    { key: [
      ["OK", "ok", "Seen, nothing to report.", ""],
      ["Attention", "moderate", "Something to deal with.", "It is listed in section C with what we suggest."],
      ["Urgent", "severe", "You were called or messaged while we were still on site.", "The time you were told is written against it."],
      ["No access", "na", "Could not be seen on this visit.", "The reason is written against it. A no access line is not an OK."],
    ] },
    { h3: "Since last visit" },
    { key: [
      ["New", "severe", "Not there last time.", ""],
      ["Same", "na", "Unchanged since the last visit.", ""],
      ["Worse", "moderate", "Was noted before and has got worse.", ""],
      ["Resolved", "ok", "Was noted before and is now put right.", ""],
    ] },
    { small: "Observations are written as what was seen and where, with the size in words where it helps: \"water stain about the size of a dinner plate, bedroom 2 ceiling, corner nearest the road\". Not \"looks bad\", and never a measurement." },

    { h: "B. This visit" },
    { kv: [
      ["Attended by", ""], ["Time in", ""], ["Time out", ""],
      ["Weather on the day", ""], ["Access gained by", ""], ["Keys held by", ""],
      ["Alarm on arrival", "Set  /  Not set  /  None"], ["Alarm on leaving", "Set  /  Not set  /  None"], ["Anyone else present", ""],
    ] },
    ...whoDidWhat("Visitor: attended and took the photographs"),
    { p: "Areas that could not be reached on this visit, and why:" },
    { lines: 2 },

    { h: "C. Needs your decision" },
    { p: "The short list. Everything here is also marked on its line further down. We record and suggest a next step; the decision, and anything that costs money, is yours." },
    { table: { head: ["#", "What was found", "Where", "Status", "Photos", "Suggested next step", "Your decision"], widths: [0.35, 2.4, 1.2, 0.9, 0.7, 2.2, 1.6], blank: 5, number: true } },
    { small: "A suggested next step is usually one of: watch it on the next visit, a Visual Check or Condition Report for a closer look, or a trade to quote for the repair through Yaadly." },

    { h: "D. Readings" },
    { p: "Taken every visit, in the same place, so a slow change shows up as a number before it shows up as damage." },
    { table: { head: ["Reading", "This visit", "Last visit", "Change", "Note"], widths: [2.4, 1.3, 1.3, 1, 3], rows: [
      ["Electricity meter", "", "", "", ""],
      ["Water meter", "", "", "", ""],
      ["Water tank level (full, three quarters, half, low)", "", "", "", ""],
      ["Fridge or freezer temperature, if left running", "", "", "", ""],
      ["Gas cylinder level, if any", "", "", "", ""],
      ["", "", "", "", ""],
    ] } },

    { pb: true },
    { h: "E. Outside" },
    item("Outside", [
      "Gate, padlock and entrance",
      "Boundary wall or fence, all sides",
      "Yard, driveway and paths",
      "Trees and vegetation near the house or the roof",
      "Roof, as seen from the ground",
      "Gutters and downpipes",
      "External walls, all elevations",
      "Windows, grilles and burglar bars",
      "External doors and locks",
      "Outside lights",
      "Post, flyers, notices left at the gate",
      "Signs of entry, damage or somebody staying",
    ]),

    { h: "F. Inside" },
    { p: "One wide photograph of every room, from the doorway, from the same spot each visit." },
    { table: { head: ["#", "Room", "Ceiling", "Walls and floor", "Windows and locks", "Since last visit", "Photos", "What was seen"], widths: [0.35, 1.4, 0.8, 0.95, 0.95, 1.05, 0.7, 2.6], blank: 9, number: true } },

    { h: "G. Water, power and drains" },
    item("Services", [
      "Water supply on at the main, or left off as agreed",
      "Every tap run for a minute, hot and cold",
      "Every toilet flushed, every drain run",
      "Under sinks, around toilets and the water heater for leaks",
      "Water tank, lid, overflow and pump",
      "Electricity on, board checked for tripped switches",
      "Lights or timers left on as agreed",
      "Septic tank or absorption pit cover, smell, overflow",
    ]),

    { h: "H. Pests, damp and storm" },
    item("Checks", [
      "Termite signs: mud tubes, droppings, soft or hollow wood",
      "Rodent signs: droppings, gnawing, nesting",
      "Insects, wasp or bee nests",
      "Mould, mildew, damp smell",
      "Standing water outside (mosquito breeding)",
      "Loose items that would move in a strong wind",
    ]),
    { note: "**Hurricane season, June to November.** Before a named storm: shutters or boards, loose items stored, water tank topped up, drains clear, photographs from the fixed spots. After it, once roads are safe: the same photographs from the same spots, so the before and after can go straight to an insurer.", tone: "warn" },

    { h: "I. If somebody lives here" },
    { p: "For a home with a parent or relative living in it. The visitor notes what they see and passes messages on. They do not give personal care, medication, medical opinion or advice, handle money, or accept gifts. If they are worried, they call the emergency contact below and then you, and write the time here." },
    { kv: [
      ["Resident seen", "Yes  /  No"], ["Spoke with them", "Yes  /  No"], ["Anybody else present", ""],
      ["Emergency contact on file", ""], ["Their doctor on file", ""], ["Escalated to", ""],
    ] },
    { lines: 3, label: "What they asked us to pass on, in their words" },

    { h: "J. Carried forward" },
    { p: "Items still open from earlier visits. They stay on this list until they are marked resolved, so nothing drops off between visits." },
    { table: { head: ["First noted", "Item", "Where", "Status today", "Who is dealing with it", "Closed on"], widths: [1.1, 2.6, 1.3, 1.1, 1.8, 1.1], blank: 5 } },

    { h: "K. Photographs" },
    ...photoLog(16),

    { h: "L. Leaving the property" },
    { tick: [["Doors and grilles locked", ""], ["Windows shut", ""], ["Water set as agreed", ""], ["Alarm set", ""]] },
    { kv: [["Next visit", ""], ["Record sent to you on", ""], ["Urgent call made at", ""]] },
    { h3: "What this record is and is not" },
    { p: "It is a visual record of what could be seen, on the day, in the areas that could be reached. It is not a survey, a structural opinion, a valuation, a security service, or insurance, and it does not replace the checks your insurer asks for unless your insurer has agreed that it does. Anything outside what a visual check can tell you is referred to the right professional and written in section C." },
    { sign: ["Visited by", "Date", "Reviewed and issued by", "Date"] },
  ],
};
