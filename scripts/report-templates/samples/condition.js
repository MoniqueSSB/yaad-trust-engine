// Sample Condition Report. Invented client, property and inspector. Sizes in
// words only, and anything that needs a licensed trade is referred on.
const { fill, rows, vals, ticks, text, signed, column } = require("./fill");
const T = require("../services/condition");

const R = "CR-S-0001";
const el = (code, list) => rows(list.map((r, i) => [code + (i + 1), ...r]));

module.exports = fill(T, {
  reference: R,
  statusOn: "Issued",
  coverFields: [
    ["Prepared for", "Paul and Sandra Reid, Toronto"], ["Property", "Three bedroom bungalow, Cassia Drive, Portmore"],
    ["Parish", "St. Catherine"], ["Date of inspection", "Monday 12 October 2026"],
    ["Draft issued", "Wednesday 14 October 2026"], ["Final issued", "Friday 16 October 2026"],
    ["Attended by", "Kemar Lewis"], ["Reference", R],
  ],
}, [
  ["B. About this inspection", "kv", 0, vals([
    "Kemar Lewis", "Monday 12 October 2026", "09:30 to 12:10",
    "Dry, hot, light wind", "Heavy rain on the Saturday and Sunday before", "Empty for about a year",
    "Part: beds and a dining table", "Keys from the clients' neighbour, Mr. D. Grant", "Kemar Lewis only",
  ])],
  ["B. About this inspection", "tick", 0, ticks(["Yes", "Yes, a walk round of the whole property", "Yes, by Monique Sewell-Bennett"])],
  ["B. About this inspection", "table", 0, rows([
    ["Attended the property and took the photographs", "Kemar Lewis", "Yaadly site inspector", "In person"],
    ["Reviewed the evidence and wrote this report", "Monique Sewell-Bennett", "Project manager, seven years UK construction", "Remote"],
  ])],
  ["B. About this inspection", "lines", 0, text("Nothing to declare.")],

  ["C. The property", "kv", 0, vals(["Detached bungalow", "The clients say it was built in the late 1980s", "One", "Concrete block, rendered and painted", "Zinc sheet on timber", "Concrete, tiled", "Both: mains, with a tank on a roof platform", "Absorption pit", "Grid"])],

  ["D. At a glance", "table", 0, column(1, [
    ["Severe", "1", "1", "1", ""], ["Moderate", "", "1", "1", ""], ["Moderate", "", "1", "1", ""], ["Severe", "1", "", "1", ""],
    ["Moderate", "", "1", "1", ""], ["Severe", "1", "", "", ""], ["Moderate", "", "1", "1", ""], ["Moderate", "", "1", "1", ""],
  ])],
  ["D. At a glance", "table", 1, column(1, [
    ["Found", "", "H1, the open outside socket"], ["Found", "", "E1, back bedroom ceiling"], ["Found", "", "J1, mud tubes on the back door frame"], ["Found", "", "F1, crack from the back bedroom window. Referred to an engineer"],
  ])],
  ["D. At a glance", "table", 2, rows([
    ["E1", "Water getting in through the back slope of the roof, showing as a wet stain on the back bedroom ceiling", "Get a roofer to find and seal the leak before the next heavy rain"],
    ["H1", "Outside socket by the back door with its cover missing and a loose cable beside it", "Switch that circuit off at the board and have a licensed electrician make it safe"],
    ["J1", "Mud tubes up the back door frame, and the frame sounds hollow when tapped", "Have a pest control operator inspect and treat before any timber is repaired"],
  ])],

  ["E. Roof", "kv", 0, vals(["From the ground, all four sides, and the ceilings from inside", "The far side of the ridge and the roof timbers. There is no hatch into the roof space", "Severe"])],
  ["E. Roof", "table", 0, el("E", [
    ["Wet stain on the back bedroom ceiling, about the size of a dinner plate, reading wet on the moisture meter", "Bedroom 3, corner nearest the back wall", "Severe", "14, 15", "Roofer to find and seal the leak. Now"],
    ["Rust along the lower edge of several sheets, and two nails lifted, on the back slope", "Back slope", "Moderate", "5, 6", "Roofer to quote for the sheets when the leak is fixed"],
    ["Front gutter part full of leaves and soil", "Front", "Low", "3", "Clear it before the next storm"],
  ])],
  ["F. Structure", "kv", 0, vals(["On foot, outside and inside", "Foundations, and wall surfaces behind furniture", "Moderate"])],
  ["F. Structure", "table", 0, el("F", [
    ["Diagonal crack running from the top corner of the window up towards the roof line, hair fine at the bottom and a coin edge wide at the top. Showing inside and outside", "Bedroom 3, back wall", "Moderate", "7, 8, 16", "Engineer to look at it before it is filled (section N)"],
    ["Fine cracks in the render across the front wall, in a map pattern", "Front wall", "Low", "2", "Fill and paint at the next redecoration"],
  ])],
  ["G. Water", "kv", 0, vals(["From the ground and from inside", "The inside of the tank and the top of the platform", "Moderate"])],
  ["G. Water", "table", 0, el("G", [
    ["No tie downs can be seen holding the tank to its roof platform", "Roof platform, back", "Moderate", "9", "Have the platform and tie downs checked before the hurricane season ends"],
    ["Kitchen tap drips when closed", "Kitchen", "Low", "18", "Replace the washer"],
  ])],
  ["H. Electrics", "kv", 0, vals(["As seen only. Nothing tested or opened", "Inside the board, and wiring in the walls and roof", "Severe"])],
  ["H. Electrics", "table", 0, el("H", [
    ["Outside socket with its cover missing, and a cable running loose beside it down the wall", "Beside the back door", "Severe", "10, 11", "Licensed electrician. Now"],
    ["Board cover in place. No labels on any circuit", "Passage", "Low", "19", "Ask the electrician to label it on the same visit"],
  ])],
  ["I. Drainage", "kv", 0, vals(["On foot, all round the house", "Inside the absorption pit", "Moderate"])],
  ["I. Drainage", "table", 0, el("I", [
    ["Ground over the absorption pit soft and wet two days after the rain stopped, with a smell", "Back yard", "Moderate", "12", "Have the pit looked at and emptied if needed"],
    ["Left downpipe ends above bare soil right against the wall, with no shoe or channel", "Left side", "Low", "4", "Fit a shoe and lead the water away from the wall"],
  ])],
  ["J. Termites and timber", "kv", 0, vals(["Doors, frames and cupboards, inside and out", "Roof timbers. There is no access to the roof space", "Severe"])],
  ["J. Termites and timber", "table", 0, el("J", [
    ["Mud tubes running up the back door frame from the floor, and the lower part of the frame sounds hollow when tapped", "Back door", "Severe", "13, 17", "Pest control operator to inspect and treat. Now"],
  ])],
  ["K. Security provision", "kv", 0, vals(["On foot, outside and inside", "Nothing", "Moderate"])],
  ["K. Security provision", "table", 0, el("K", [
    ["Grilles on all three bedroom windows are fixed. None opens from inside, so there is no way out of a bedroom in a fire", "All bedrooms", "Moderate", "20", "Fit an opening grille with an inside latch in at least one bedroom"],
    ["Outside light at the back has no bulb", "Back door", "Low", "10", "Replace the bulb"],
  ])],
  ["L. External works", "kv", 0, vals(["On foot", "The back of the boundary wall, from the neighbour's side", "Moderate"])],
  ["L. External works", "table", 0, el("L", [
    ["Large mango tree with branches over the back slope of the roof", "Back yard", "Moderate", "5", "Have it cut back before a storm, clear of the roof"],
    ["Crack across the driveway near the gate", "Driveway", "Low", "1", "Watch it"],
  ])],

  ["M. What to do now", "table", 0, rows([
    ["1", "Switch the back door socket circuit off at the board and have it made safe", "H1", "Licensed electrician", "This week"],
    ["2", "Find and seal the roof leak", "E1", "Roofer", "Before the next heavy rain"],
    ["3", "Termite inspection and treatment", "J1", "Pest control operator", "Within two weeks"],
    ["4", "Cut back the mango tree and check the tank tie downs", "L1, G1", "Tree cutter, roofer", "Before the end of November"],
    ["5", "Engineer to look at the bedroom 3 crack", "F1", "PERB registered engineer", "Within a month"],
    ["6", "Price the remaining moderate items with two written quotes each", "E2, I1, K1", "Through Yaadly", "When the above are done"],
  ])],
  ["N. Documents to get and questions for other professionals", "table", 0, rows([
    ["1", "Any record of termite treatment at the property", "The clients' own papers, or the previous owner", "To tell whether J1 is new activity", "J1"],
    ["2", "Any receipt or record for the tank platform and tie downs", "The clients", "The clients say it was strapped in 2019", "G1"],
  ])],
  ["N. Documents to get and questions for other professionals", "table", 1, rows([
    ["1", "Is the crack from the bedroom 3 window a sign of movement, and does it need more than filling?", "PERB registered engineer", "A structural judgement", "F1"],
    ["2", "Is the outside circuit safe to use once the socket is replaced?", "Licensed electrician", "Electrics were seen, not tested", "H1"],
    ["3", "Are the termites live, which kind, and how far into the frame and roof timbers?", "Pest control operator", "Only signs can be seen", "J1"],
    ["4", "Is the absorption pit failing or only full?", "Plumber or septic contractor", "It was not opened", "I1"],
  ])],
  ["O. Your comments on the draft", "table", 0, rows([
    ["1", "\"The tank was strapped in 2019, we have the receipt.\"", "15 October", "Noted in N. The rating on G1 stays Moderate until the straps are seen, because the receipt does not show their condition now"],
    ["2", "\"Can you say which bedroom is bedroom 3?\"", "15 October", "Added: the back bedroom, nearest the kitchen"],
  ])],
  ["P. Photographs", "table", 0, rows([
    ["1", "09:34", "Gate", "Driveway crack", "L2"], ["2", "09:36", "Front wall", "Render cracks", "F2"], ["3", "09:38", "Front", "Gutter", "E3"],
    ["4", "09:41", "Left side", "Downpipe", "I2"], ["5", "09:44", "Back yard", "Back slope and mango tree", "E2, L1"], ["6", "09:45", "Back slope", "Rust and lifted nails", "E2"],
    ["7", "09:48", "Back wall", "Crack, outside", "F1"], ["8", "09:48", "Back wall", "Crack, top end", "F1"], ["9", "09:52", "Back yard", "Tank on its platform", "G1"],
    ["10", "09:55", "Back door", "Socket and cable", "H1, K2"], ["11", "09:55", "Back door", "Socket, close", "H1"], ["12", "10:01", "Back yard", "Ground over the pit", "I1"],
    ["13", "10:04", "Back door", "Mud tubes on the frame", "J1"], ["14", "10:20", "Bedroom 3", "Ceiling stain", "E1"], ["15", "10:21", "Bedroom 3", "Moisture meter on the stain", "E1"],
    ["16", "10:23", "Bedroom 3", "Crack, inside", "F1"], ["17", "10:30", "Back door", "Frame from inside", "J1"], ["18", "10:36", "Kitchen", "Tap", "G2"],
    ["19", "10:40", "Passage", "Board, cover closed", "H2"], ["20", "10:45", "Bedroom 1", "Fixed grille", "K1"],
  ])],
  ["Q. What this report is and is not", "sign", 0, signed(["Kemar Lewis", "12 October 2026", "Monique Sewell-Bennett", "16 October 2026"])],
]);
