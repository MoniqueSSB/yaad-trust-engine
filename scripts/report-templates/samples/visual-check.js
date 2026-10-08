// Sample Visual Check. Invented client, property and checker. A record only:
// every line says what the photographs show, and none says whether it matters.
const { fill, rows, numbered, vals, text, signed } = require("./fill");
const T = require("../services/visual-check");

const R = "VC-S-0001";
const line = (n, item, mark, photos, shows) => [String(n), item, mark, photos, shows];

module.exports = fill(T, {
  reference: R,
  statusOn: "Visual Check",
  coverFields: [
    ["Prepared for", "Denise Walker, Manchester"], ["Property", "Two bedroom bungalow, Hibiscus Way, Portmore"],
    ["Parish", "St. Catherine"], ["Date of visit", "Saturday 17 October 2026"],
    ["Checklist agreed on", "Wednesday 14 October 2026, by WhatsApp"], ["Reference", R],
  ],
}, [
  ["B. This visit", "kv", 0, vals([
    "Andre Morris, checker", "10:00", "10:06",
    "11:22", "Dry and sunny. Heavy rain reported the night before by the neighbour", "Key from the client's cousin, Mrs. P. Walker, handed over at the gate",
    "Mrs. P. Walker, at the gate only", "41", "Yes, phone clock matched the network time on arrival",
  ])],
  ["B. This visit", "table", 0, rows([
    ["Checker: attended and took the photographs", "Andre Morris", "Yaadly checker", "In person"],
    ["Reviewed the evidence and wrote this report", "Monique Sewell-Bennett", "Project manager, seven years UK construction", "Remote"],
  ])],
  ["B. This visit", "lines", 0, text("Nothing to declare.")],
  ["B. This visit", "lines", 1, text("The roof could only be photographed from the yard and the road. The locked storeroom at the back of the yard could not be opened: the key on the ring did not fit, and the client was told by WhatsApp at 10:48.")],

  ["C. What you asked us to capture", "table", 0, rows([
    line(1, "Crack on the back wall you saw in the tenant's photo", "Recorded", "7, 8, 9", "A crack runs from the top right corner of the kitchen window up towards the roof line, rear wall, outside. It is as fine as a hair at the bottom and about as wide as a coin edge near the top. Paint has flaked along it near the top."),
    line(2, "Water tank on the roof platform", "Part", "14, 15", "Tank, stand and lid photographed from the yard. The lid is in place. The overflow pipe and the inside of the tank could not be seen from the ground."),
    line(3, "Front gate lock, which the tenant said was sticking", "Recorded", "1, 2", "Padlock and hasp on the front gate. Rust on the hasp. The padlock opened with the key at the second turn."),
    line(4, "Ceiling stain in the back bedroom", "Recorded", "26, 27", "A brown ring stain on the ceiling in the corner nearest the back wall, about the size of a dinner plate. The ceiling surface was dry to the touch where it could be reached from a chair."),
    line(5, "Anything the tenant left behind", "Recorded", "30, 31, 32", "A mattress, two plastic chairs and a bag of clothes in bedroom 2. A gas cylinder in the kitchen, valve closed."),
  ])],

  ["D. Outside", "table", 0, rows([
    line(1, "Front of the property, from the road", "Recorded", "3", "Front wall, gate, front door and windows in one frame. Grass in the front yard is long."),
    line(2, "Gate, entrance and boundary, all sides", "Recorded", "1, 4, 5, 6", "Block boundary wall on three sides, chain link fence on the left side. Two blocks missing from the top of the back wall near the right corner."),
    line(3, "Each outside wall, one photograph per side", "Recorded", "3, 7, 10, 11", "Four sides photographed. Crack on the rear wall as in item C1. Green staining low down on the left side wall beside the downpipe."),
    line(4, "Roof, as seen from the ground", "Part", "12, 13", "Zinc roof seen from the yard and the road. Two sheets at the back edge show rust along their lower edge. The ridge and the far slope could not be seen."),
    line(5, "Gutters and downpipes", "Recorded", "10, 13", "Gutter on the front only. The left downpipe ends above the ground with no shoe, and the ground under it is bare soil."),
    line(6, "Windows, grilles and outside doors", "Recorded", "3, 16, 17", "Grilles on every window. One louvre blade missing in the bathroom window. Back door grille locked."),
    line(7, "Yard, driveway, paths and drainage channels", "Recorded", "18, 19", "Concrete driveway with a crack across it near the gate. Drainage channel along the right side has leaves and soil in it."),
    line(8, "Water tank and outside pipework", "Part", "14, 15, 20", "As in item C2. Outside pipe to the tank runs along the back wall, painted, no drips seen."),
    line(9, "Anything built, started or changed since the last record", "Recorded", "", "This is the first record of this property. Nothing to compare with."),
  ])],

  ["E. Inside", "table", 0, rows([
    line(1, "Living room", "Recorded", "21, 22", "Empty apart from a curtain rail lying on the floor. Walls and ceiling painted, no marks seen on the ceiling."),
    line(2, "Kitchen", "Recorded", "23, 24", "Cupboard door under the sink hanging from one hinge. Inside of the cupboard dry. Gas cylinder as in item C5."),
    line(3, "Bedroom 1, front", "Recorded", "25", "Empty. Wardrobe doors closed. Nothing seen on the ceiling."),
    line(4, "Bedroom 2, back", "Recorded", "26, 27, 30, 31", "Ceiling stain as in item C4. Items left by the tenant as in item C5."),
    line(5, "Bathroom", "Recorded", "28, 29", "Louvre blade missing from the window. Black marks in the corner of the shower where the wall meets the tray."),
    line(6, "Passage", "Recorded", "33", "Electric board on the passage wall, cover closed."),
  ])],

  ["F. Water, power and drains", "table", 0, rows([
    line(1, "Electric meter and the board, cover closed", "Recorded", "33, 34", "Meter on the front wall, display lit. Board cover closed, no scorch marks on the outside of the cover."),
    line(2, "Water meter", "Recorded", "35", "Meter box at the front boundary. Lid in place. Dial photographed."),
    line(3, "Water heater and visible pipework", "Recorded", "36", "Solar water heater panel seen on the roof from the road. Pipework under the kitchen sink dry."),
    line(4, "Toilets, sinks and showers", "Recorded", "28, 29, 37", "One toilet, one basin, one shower, kitchen sink. Toilet lid down. Nothing run or flushed, as agreed."),
    line(5, "Septic tank or absorption pit cover", "Recorded", "38, 39", "Concrete cover in the back yard, in place. Grass around it longer and greener than the rest of the yard."),
  ])],

  ["G. Photographs", "table", 0, numbered([
    ["10:07", "Front gate", "Padlock and hasp", "C3"], ["10:07", "Front gate", "Padlock, close", "C3"], ["10:09", "Road", "Front of the property", "D1"],
    ["10:11", "Left boundary", "Chain link fence", "D2"], ["10:12", "Back boundary", "Missing blocks, back wall", "D2"], ["10:13", "Right boundary", "Block wall", "D2"],
    ["10:15", "Rear wall", "Crack from kitchen window", "C1"], ["10:15", "Rear wall", "Crack, top end, close", "C1"], ["10:16", "Rear wall", "Crack, bottom end, close", "C1"],
    ["10:18", "Left side wall", "Downpipe and staining", "D3"], ["10:19", "Right side wall", "Whole side", "D3"], ["10:21", "Back yard", "Roof, back edge", "D4"],
    ["10:22", "Road", "Roof, front slope", "D4"], ["10:24", "Back yard", "Water tank and stand", "C2"], ["10:24", "Back yard", "Tank lid", "C2"],
    ["10:27", "Bathroom window", "Missing louvre blade", "D6"], ["10:27", "Back door", "Grille locked", "D6"], ["10:29", "Driveway", "Crack near the gate", "D7"],
    ["10:30", "Right side", "Drainage channel", "D7"], ["10:31", "Rear wall", "Pipe to the tank", "D8"],
  ])],
  ["G. Photographs", "small", 0, () => ({ small: "Photographs 21 to 41 are in the full set sent with this record. The log above shows the first twenty as an example. The full resolution set is sent as a separate folder named " + R + "." })],

  ["H. What this record is and is not", "sign", 0, signed(["Andre Morris", "17 October 2026", "Monique Sewell-Bennett", "18 October 2026"])],
]);
