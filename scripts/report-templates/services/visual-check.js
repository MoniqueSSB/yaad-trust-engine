const { SOLE, whoDidWhat, preparedBy, photoLog, disclosure } = require("../shared");

const rows = (list) => list.map((r, i) => [String(i + 1), r, "", "", ""]);
const head = (area) => ["#", area, "Recorded", "Photos", "What the photographs show"];
const W = [0.35, 2.8, 1.1, 0.9, 3.6];

module.exports = {
  service: "Visual Check",
  code: "VC",
  title: "Photographic record of condition",
  blurb: "A dated, timestamped photographic record of your property as it stood on the day, taken against a checklist agreed with you before the visit. It records what was there. It does not rate, judge or advise.",
  footer: SOLE,
  statuses: ["Visual Check", "Job check on a booked job"],
  coverFields: [
    ["Prepared for", ""], ["Property", ""],
    ["Parish", ""], ["Date of visit", ""],
    ["Checklist agreed on", ""], ["Reference", ""],
  ],
  preparedBy: preparedBy("The checker who attends records and photographs. They do not rate what they see, give an opinion on it, or advise. If you want a view on what the photographs show, that is a Condition Report or a Technical Sign-off."),
  blocks: [
    { contents: [
      ["A", "How to read this record", "what it is, and the one mark on each line"],
      ["B", "This visit", "who, when, how long, what could not be reached"],
      ["C", "What you asked us to capture", "your own items, first"],
      ["D", "Outside", "gate to roof line"],
      ["E", "Inside", "room by room"],
      ["F", "Water, power and drains", "as seen, not tested"],
      ["G", "Photographs", "every one, numbered and timed"],
      ["H", "What this record is and is not", "and the declaration"],
    ] },

    { h: "A. How to read this record" },
    { p: "This is a **record**, not a report. The checker walked the property against the checklist agreed with you, photographed every item on it, and wrote down plainly what each photograph shows. There are no ratings, no opinions, and no advice in it, on purpose." },
    { p: "Each line carries one mark:" },
    { key: [
      ["Recorded", "ok", "Photographed as agreed.", "The photograph numbers are written against it."],
      ["Part", "moderate", "Only part of it could be photographed.", "What was missed, and why, is written against it."],
      ["No access", "na", "Could not be reached or seen.", "The reason is written against it."],
    ] },
    { small: "\"What the photographs show\" is a plain description of what is in the frame, with the place and a size in words where it helps: \"crack running from the top corner of the back door to the ceiling, rear wall\". It is never a judgement such as \"serious\" or \"nothing to worry about\". Left and right are as you face the part being photographed; the front is the side facing the road. Every photograph is taken on the visit itself, with the device clock checked on arrival, and none is edited." },

    { h: "B. This visit" },
    { kv: [
      ["Attended by", ""], ["Scheduled time", ""], ["Time in", ""],
      ["Time out", ""], ["Weather", ""], ["Access gained by", ""],
      ["Anybody else present", ""], ["Photographs taken", ""], ["Camera or phone date checked", "Yes  /  No"],
    ] },
    ...whoDidWhat("Checker: attended and took the photographs"),
    disclosure("The checker has"),
    { lines: 1 },
    { p: "Anything on the checklist that could not be reached, and why:" },
    { lines: 2 },

    { h: "C. What you asked us to capture" },
    { p: "The items you named when you booked, recorded first so they are never lost in the general walk round." },
    { table: { head: head("Your item"), widths: W, blank: 5, number: true } },

    { h: "D. Outside" },
    { table: { head: head("Outside"), widths: W, rows: rows([
      "Front of the property, from the road",
      "Gate, entrance and boundary, all sides",
      "Each outside wall, one photograph per side",
      "Roof, as seen from the ground",
      "Gutters and downpipes",
      "Windows, grilles and outside doors",
      "Yard, driveway, paths and drainage channels",
      "Water tank and outside pipework",
      "Anything built, started or changed since the last record",
    ]) } },

    { h: "E. Inside" },
    { p: "One wide photograph of every room from the doorway, then close ups of anything the eye is drawn to." },
    { table: { head: ["#", "Room", "Recorded", "Photos", "What the photographs show"], widths: W, blank: 9, number: true } },

    { h: "F. Water, power and drains" },
    { p: "As seen. Nothing is tested, switched on or opened up." },
    { table: { head: head("Services"), widths: W, rows: rows([
      "Electric meter and the board, cover closed",
      "Water meter",
      "Water heater and visible pipework",
      "Toilets, sinks and showers",
      "Septic tank or absorption pit cover",
    ]) } },

    { h: "G. Photographs" },
    ...photoLog(20),

    { h: "H. What this record is and is not" },
    { p: "It is a photographic record of what could be seen, in the areas that could be reached, on the day and at the times above. It is not an inspection, a survey or an opinion on condition, it does not say whether anything is a defect or what it would cost to put right, and it is not a valuation, a structural, legal or boundary opinion, or insurance. Nothing was lifted, opened up, tested or moved." },
    { h3: "Declaration" },
    { p: "I attended the property on the date above. The photographs in this record were taken by me on that visit and have not been altered, and the descriptions are what the photographs show." },
    { p: "**Reviewer.** I have checked that this record covers the agreed checklist and that the descriptions match the photographs. I have added no opinion to it." },
    { sign: ["Checker", "Date", "Reviewed and issued by", "Date"] },
  ],
};
