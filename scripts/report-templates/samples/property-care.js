// Sample Property Care visit. Invented client, home and visitor. The home is
// lived in by the client's mother: the visit covers the building only, and
// passes on what she asks, nothing about her health or welfare (decision of
// 4 October 2026).
const { fill, rows, numbered, vals, ticks, text, signed, column } = require("./fill");
const T = require("../services/property-care");

const R = "PC-S-0004";
const ok = (photos = "", seen = "") => ["OK", "Same", photos, seen];

module.exports = fill(T, {
  reference: R,
  statusOn: "Routine visit",
  coverFields: [
    ["Prepared for", "Errol Grant, New York"], ["Property", "His mother's home, Poinciana Avenue, Spanish Town"],
    ["Parish", "St. Catherine"], ["Home size", "Standard"],
    ["Visit date", "Tuesday 13 October 2026"], ["Visit number in plan", "4"],
    ["Plan", "Monthly"], ["Reference", R],
  ],
}, [
  ["B. This visit", "kv", 0, vals([
    "Shanice Brown", "14:00", "14:55",
    "Overcast, dry. Rain in the morning", "Mrs. Grant opened the gate", "Mrs. Grant, and a spare set with Yaadly",
    "None", "None", "Mrs. Grant",
  ])],
  ["B. This visit", "table", 0, rows([
    ["Visitor: attended and took the photographs", "Shanice Brown", "Yaadly visitor", "In person"],
    ["Reviewed the evidence and wrote this report", "Monique Sewell-Bennett", "Project manager, seven years UK construction", "Remote"],
  ])],
  ["B. This visit", "lines", 0, text("Mrs. Grant's bedroom was not entered, at her request. Everything else on the checklist was reached.")],

  ["C. Needs your decision", "table", 0, numbered([
    ["Back gutter pulling away from the fascia at the left end, further than last month", "Back of the house", "Worse", "9, 10", "A trade to quote through Yaadly before the next heavy rain", ""],
    ["Brown stain on the kitchen ceiling above the sink, about the size of a saucer, dry to the touch", "Kitchen", "New", "14", "A Visual Check of the roof above the kitchen, or watch it next visit", ""],
    ["Wasp nest under the front eave, beside the front door", "Front", "New", "4", "Pest control to remove it", ""],
  ])],

  ["D. Readings", "table", 0, column(1, [
    ["48213", "47905", "308", ""],
    ["1832", "1815", "17", ""],
    ["Three quarters", "Full", "Down", "Rain in the morning; the pump was running"],
    ["Not applicable", "", "", "Occupied home"],
    ["Half", "Three quarters", "Down", "Mrs. Grant says a new one is ordered"],
  ])],

  ["E. Outside", "table", 0, column(2, [
    ok("1", "Gate locks. Padlock stiff to open, see section I."),
    ok("2, 3", "Wall complete on all sides."),
    ok("", "Swept."),
    ["Attention", "Same", "5", "Breadfruit tree branches touching the back roof edge. Noted last visit."],
    ok("6, 7", "Sheets, ridge and edges as last month from the ground."),
    ["Attention", "Worse", "9, 10", "Back gutter pulling away at the left end. Section C."],
    ok("8", ""),
    ok("", ""),
    ok("", ""),
    ok("", "Front light came on at the switch."),
    ok("", "Nothing at the gate."),
    ok("", "None seen."),
  ])],

  ["F. Inside", "table", 0, numbered([
    ["Living room", "OK", "OK", "OK", "Same", "11", ""],
    ["Kitchen", "Attention", "OK", "OK", "New", "12, 14", "Ceiling stain above the sink. Section C."],
    ["Bedroom 1", "No access", "No access", "No access", "", "", "Not entered, at Mrs. Grant's request."],
    ["Bedroom 2", "OK", "OK", "OK", "Same", "13", ""],
    ["Bathroom", "OK", "OK", "OK", "Resolved", "15", "Louvre blade replaced since last visit."],
  ])],

  ["G. Water, power and drains", "table", 0, column(2, [
    ok("", "On. The home is lived in."),
    ok("", "Kitchen and bathroom run, hot and cold."),
    ok("", ""),
    ok("16", "Dry under both sinks and round the water heater."),
    ok("7", "Lid on, overflow clear, pump cutting in and out."),
    ok("", "No tripped switches."),
    ["OK", "Same", "", "Not applicable. The home is lived in."],
    ok("17", "Cover in place, no smell."),
  ])],

  ["H. Pests, damp and storm", "table", 0, column(2, [
    ok("", "None seen."),
    ok("", "None seen."),
    ["Attention", "New", "4", "Wasp nest under the front eave. Section C."],
    ok("", "None."),
    ok("", "Two buckets of rainwater by the back door emptied, with Mrs. Grant's agreement."),
    ["OK", "Same", "18", "Zinc sheets stacked by the back fence, tied down."],
  ])],

  ["I. If somebody lives here", "kv", 0, vals(["Yes", "Yes", "Miss Campbell, the neighbour, at the gate", "Errol Grant, and Miss Campbell next door", "Not held. This service covers the building only", "Nobody. Nothing on this visit needed it"])],
  ["I. If somebody lives here", "lines", 0, text("\"Tell Errol the gate padlock is getting hard to open and I would like a new one before Christmas.\"")],

  ["J. Carried forward", "table", 0, rows([
    ["Visit 2, 11 August", "Back gutter loose at the left end", "Back", "Worse", "Errol, quote asked for through Yaadly", ""],
    ["Visit 3, 15 September", "Breadfruit branches touching the roof edge", "Back", "Same", "Errol, to arrange", ""],
    ["Visit 3, 15 September", "Louvre blade missing, bathroom window", "Bathroom", "Resolved", "The family", "30 September"],
  ])],

  ["K. Photographs", "table", 0, numbered([
    ["14:03", "Gate", "Gate and padlock", "E1"], ["14:05", "Left boundary", "Wall", "E2"], ["14:06", "Right boundary", "Wall", "E2"],
    ["14:08", "Front eave", "Wasp nest", "C3"], ["14:10", "Back", "Breadfruit tree and roof edge", "E4"], ["14:11", "Road", "Roof, front", "E5"],
    ["14:12", "Back yard", "Roof, back, and tank", "E5, G5"], ["14:13", "Walls", "All four sides", "E7"], ["14:15", "Back", "Gutter, left end", "C1"],
    ["14:15", "Back", "Gutter, close", "C1"], ["14:24", "Living room", "From the doorway", "F1"], ["14:26", "Kitchen", "From the doorway", "F2"],
    ["14:30", "Bedroom 2", "From the doorway", "F4"], ["14:27", "Kitchen", "Ceiling stain", "C2"], ["14:33", "Bathroom", "Window", "F5"],
    ["14:35", "Kitchen", "Under the sink", "G4"],
  ])],

  ["L. Leaving the property", "tick", 0, ticks(["Mrs. Grant locked up behind us", "Yes", "On, as the home is lived in", "No alarm"])],
  ["L. Leaving the property", "kv", 0, vals(["Tuesday 10 November 2026, afternoon", "Tuesday 13 October 2026, 18:05", "None needed"])],
  ["L. Leaving the property", "sign", 0, signed(["Shanice Brown", "13 October 2026", "Monique Sewell-Bennett", "13 October 2026"])],
]);
