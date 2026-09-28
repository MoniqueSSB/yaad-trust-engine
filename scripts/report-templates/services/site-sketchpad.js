const { SOLE } = require("../shared");

// Paper for sketching a property by hand on site. It is not a Sketch Pack,
// which the agent builds from a walkthrough video, and nothing reads it. Same
// rule as the Sketch Pack all the same: not to scale, and no dimension ever,
// because measured drawings for reward are regulated work in Jamaica.
const level = (name) => [
  { pb: true },
  { kv: [["Level", name], ["Property", ""], ["Date", ""]], cols: 3 },
  { grid: { label: "Sketch. Not to scale. Size in words only.", height: 212 } },
];

module.exports = {
  service: "Site Sketchpad",
  code: "SK",
  compact: true,
  title: "Site sketch, by hand",
  blurb: "",
  footer: SOLE,
  statuses: [],
  coverFields: [],
  preparedBy: "",
  blocks: [
    { kv: [["Property", ""], ["Parish", ""], ["Date", ""], ["Sketched by", ""], ["For", "Job  /  Report  /  Own record"], ["Reference", ""]] },
    { note: "**Not to scale, and no dimensions.** This is an indicative sketch to show layout and where things are. Describe size in words (\"about the width of a door\", \"most of the wall\"), never in metres or feet. A measured drawing is a surveyor's work.", tone: "warn" },
    { h: "Key" },
    { table: { head: ["Mark", "Means"], widths: [1.2, 6.6], rows: [
      ["Single line", "Wall"],
      ["Gap in the line with an arc", "Door, and which way it opens"],
      ["Three short lines across a wall", "Window"],
      ["Circled number with an arrow", "Where a photograph was taken, and which way the camera faced"],
      ["Letter in a triangle", "A finding, keyed to the list overleaf"],
      ["W", "Water tank.  T  Septic tank or pit.  E  Electric meter or board."],
      ["Dotted line", "Could not be reached or seen"],
    ] } },
    { h: "Rooms and spaces" },
    { table: { head: ["#", "Room or space", "Level", "Photos", "What was seen, size in words"], widths: [0.35, 1.8, 0.9, 0.9, 4], blank: 8, number: true } },
    ...level("Ground floor"),
    ...level("Upper floor"),
    ...level("Roof, yard and boundary"),
    { pb: true },
    { h: "Photograph positions" },
    { table: { head: ["Photo", "Time", "Level", "Standing where, facing which way", "What it shows"], widths: [0.7, 0.9, 1, 2.8, 2.8], blank: 16, number: true } },
    { h: "Findings marked on the sketch" },
    { table: { head: ["Mark", "What", "Where", "Photos"], widths: [0.7, 4.2, 2, 1], blank: 8 } },
    { lines: 3, label: "Could not be reached or seen, and why" },
  ],
};
