// Sample Oversight Retainer monthly report. Invented clients, build and
// builder. Money figures are the agreed price and the builder's own figures;
// the report tracks them and never estimates what the work should cost.
const { fill, rows, numbered, vals, ticks, text, signed, column } = require("./fill");
const T = require("../services/oversight");

const R = "OR-S-0003";

module.exports = fill(T, {
  reference: R,
  statusOn: "Fortnightly",
  coverFields: [
    ["Prepared for", "Kevin and Tanya Lewis, Birmingham"], ["Property", "Plot at Sandy Bay, Clarendon"],
    ["Project", "New two bedroom house"], ["Builder", "Blue Mahoe Builders Ltd"],
    ["Report number", "3"], ["Period covered", "1 to 30 September 2026"],
    ["Information current to", "Wednesday 30 September 2026"], ["Reference", R],
  ],
}, [
  ["A. This month in one page", "table", 0, column(1, [
    ["On track", "At risk", "Time, money and quality have moved to at risk. Nothing is off track."],
    ["On track", "At risk", "Forecast finish is two weeks after the agreed date, after rain and a late block delivery."],
    ["On track", "At risk", "A change has been priced by the builder and not yet agreed (section G)."],
    ["On track", "At risk", "Exposed steel at two columns, raised on 9 September, still open on 23 September."],
    ["On track", "On track", "Nothing seen."],
    ["On track", "On track", "Work on site matches the agreed scope."],
  ])],
  ["A. This month in one page", "kv", 0, vals([
    "Walls up on all sides and the ring beam poured on 24 September",
    "The roof not being on before the end of the hurricane season",
    "Whether to add the extra window in bedroom 2, by Friday 9 October (section J)",
  ])],
  ["A. This month in one page", "kv", 1, vals(["31 January 2027", "14 February 2027", "Two weeks later", "J$9,400,000", "J$4,150,000", "J$1,300,000 paid this month"])],

  ["C. Site attendance", "table", 0, numbered([
    ["9 Sep", "10:15", "11:40", "Kemar Lewis", "Yes, Mr. Clarke (foreman)", "Six", "Dry", "1 to 7"],
    ["23 Sep", "09:50", "11:05", "Kemar Lewis", "Yes, Mr. Clarke (foreman)", "Four", "Showers", "8 to 12"],
  ])],
  ["C. Site attendance", "table", 1, rows([
    ["Site attendance, on the dates above", "Kemar Lewis", "Yaadly site inspector", "In person"],
    ["Reviewed the evidence and wrote this report", "Monique Sewell-Bennett", "Project manager, seven years UK construction", "Remote"],
  ])],

  ["D. Progress", "lines", 0, text("Blockwork finished on all sides. Window and door openings formed. Ring beam steel fixed and the ring beam poured on 24 September. Rain stopped work on five days between 14 and 22 September.")],
  ["D. Progress", "lines", 1, text("Roof timbers and zinc sheets ordered, roof framed and covered, as the builder has stated it in his message of 28 September. Plumbing first fix to start once the roof is on.")],

  ["E. Programme", "table", 0, numbered([
    ["Foundations", "31 July", "Done 29 July", "", "On track", ""],
    ["Walls to ring beam", "15 September", "Done 24 September", "9", "At risk", "Rain and a late block delivery"],
    ["Roof on", "31 October", "14 November", "14", "At risk", "Builder's forecast, 28 September"],
    ["Windows and doors fitted", "30 November", "14 December", "14", "At risk", "Follows the roof"],
    ["Plumbing and electrics, first fix", "15 December", "29 December", "14", "At risk", ""],
    ["Finishes", "20 January 2027", "3 February 2027", "14", "At risk", ""],
    ["Handover", "31 January 2027", "14 February 2027", "14", "At risk", ""],
  ])],

  ["F. Money", "table", 0, column(1, [
    ["J$9,000,000", "J$9,000,000", "None", ""],
    ["J$400,000", "J$400,000", "None", "Change 1, agreed 20 August"],
    ["J$9,400,000", "J$9,400,000", "None", ""],
    ["J$2,850,000", "J$4,150,000", "J$1,300,000", "Stage 3 paid, see below"],
    ["Nil", "Nil", "None", ""],
    ["J$6,550,000", "J$5,250,000", "J$1,300,000", "Stage 3 paid"],
    ["Nil", "J$180,000", "J$180,000", "Change 2, the builder's price"],
    ["J$9,400,000", "J$9,580,000", "J$180,000", "If change 2 is agreed"],
  ])],
  ["F. Money", "table", 1, rows([
    ["10 Sep", "Stage 3: walls to ring beam level", "J$1,300,000", "Photographs of all four walls at ring beam level from the 9 September visit, and the steel before the pour", "Yes"],
  ])],

  ["G. Changes to the work", "table", 0, numbered([
    ["Tiled veranda instead of plain concrete", "You", "J$400,000", "None", "Agreed", "20 August"],
    ["Extra window in bedroom 2, on the back wall", "You", "J$180,000", "Two working days", "Priced", ""],
  ])],

  ["H. Quality and safety", "table", 0, numbered([
    ["Steel bars showing at the base of two columns after the pour, not covered", "Front corners", "4, 5, 11", "Mr. Clarke", "9 Sep", "Open"],
    ["Blocks stacked on soft ground, several cracked", "Yard", "6", "Mr. Clarke", "9 Sep", "Closed 23 Sep, now on pallets"],
  ])],
  ["H. Quality and safety", "tick", 0, ticks(["Yes, 9 September. Public liability, to March 2027", "Foundation inspection done 14 August. Roof next", "No"])],

  ["I. Risks", "table", 0, numbered([
    ["Roof not on before a named storm, with the walls and ring beam open to the weather", "High", "High", "Builder to order the roof timber now. Your decision on the window by 9 October so it does not hold the roof", "Monique Sewell-Bennett", "14 Oct"],
    ["Block supplier late again", "Medium", "Medium", "Builder getting a second supplier's quote", "Mr. Clarke", "14 Oct"],
    ["Exposed steel covered up without being treated", "Medium", "Medium", "Photographed before it is covered, on the next visit", "Kemar Lewis", "7 Oct"],
  ])],

  ["J. Decisions for you", "table", 0, numbered([
    ["Extra window in bedroom 2", "Agree it at the builder's J$180,000 and two working days, or turn it down", "Fri 9 Oct", "The back wall is closed in, and adding it later means cutting the blockwork", ""],
  ])],

  ["K. Escalations", "table", 0, numbered([
    ["17 Sep 11:20", "Tanya Lewis", "The builder asked for the roof stage payment early, to buy the timber", "Told the builder in writing that the roof stage is paid against the roof evidence, as agreed. Offered for you to pay the timber supplier directly instead. He accepted", "18 Sep"],
  ])],

  ["L. The monthly call", "kv", 0, vals(["Wednesday 30 September 2026, 19:00 UK", "Kevin and Tanya Lewis, Monique Sewell-Bennett", "40 minutes"])],
  ["L. The monthly call", "table", 0, numbered([
    ["Send the builder's change 2 price to Kevin and Tanya in writing", "Monique Sewell-Bennett", "1 Oct", "Done", "Email of 1 October"],
    ["Decide on the extra window", "Kevin and Tanya Lewis", "9 Oct", "Open", ""],
    ["Get the timber supplier's invoice in the Lewises' name", "Mr. Clarke", "7 Oct", "Open", ""],
    ["Photograph the two columns before they are covered", "Kemar Lewis", "7 Oct", "Open", ""],
  ])],
  ["L. The monthly call", "lines", 0, text("The timber is paid to the supplier directly, not through the builder. No roof stage payment until the roof evidence arrives. Next call Wednesday 28 October, same time.")],

  ["M. Photographs", "table", 0, numbered([
    ["10:18", "Front", "Whole front, fixed spot 1", "D"], ["10:20", "Back", "Whole back, fixed spot 2", "D"], ["10:24", "Left side", "Window openings", "D"],
    ["10:30", "Front left corner", "Exposed steel at the column base", "H1"], ["10:31", "Front right corner", "Exposed steel at the column base", "H1"], ["10:40", "Yard", "Blocks on soft ground", "H2"],
    ["10:55", "Ring beam", "Steel before the pour", "F"], ["09:52", "Front", "Whole front, fixed spot 1", "D"], ["09:54", "Back", "Whole back, fixed spot 2", "D"],
    ["10:05", "Ring beam", "After the pour", "D"], ["10:12", "Front corners", "Steel still showing", "H1"], ["10:20", "Yard", "Blocks now on pallets", "H2"],
  ])],

  ["N. What this report is and is not", "lines", 0, text("Nothing to declare.")],
  ["N. What this report is and is not", "sign", 0, signed(["Monique Sewell-Bennett", "Monique Sewell-Bennett", "1 October 2026", "Kevin and Tanya Lewis"])],
]);
