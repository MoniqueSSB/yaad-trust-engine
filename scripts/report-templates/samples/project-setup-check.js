// Sample Project Setup Check. Invented client, builder and quote. The quote
// amounts are the builder's own figures as quoted; the report never says what
// the work should cost.
const { fill, rows, numbered, vals, text, signed, column } = require("./fill");
const T = require("../services/deposit-check");

const R = "PSC-S-0001";
const flag = (n, heading, rating, from, found, why, todo) => [
  { h3: `Red flag ${n}` },
  { kv: [["Heading", heading], ["Rating", rating], ["Where it came from", from]], cols: 3 },
  { table: { head: ["What was found", "Why it matters", "What to do"], widths: [1, 1, 1], rows: [[found, why, todo]], tall: true } },
];
const FLAGS = [
  [1, "Most of the money asked for before any work, to somebody else's account", "Severe", "Quote line 5 and 6, WhatsApp of 3 October",
    "60% of the total (J$1,110,000) is asked for to start. It can be paid in cash or to \"my partner account\". No materials are on site and no work has started.",
    "Once that money leaves you there is nothing on site to show for it, and it sits in the account of somebody you have no agreement with. From London you would have no practical way to get it back.",
    "Pay nothing yet. Agree the stages in section H, the first only once materials are on site, and pay only to an account in the builder's own name."],
  [2, "The business cannot be traced beyond a Facebook page", "Severe", "Independent check, 6 October",
    "No TRN or business registration was given. No business of this name was found on the Companies Office of Jamaica search. The only address is a WhatsApp number.",
    "If the work goes wrong you need a named, findable person or business to hold to the agreement.",
    "Ask for his TRN and a home or yard address, in writing, before any payment."],
  [3, "The quote is one line per job, with no breakdown", "Moderate", "Quote lines 1 and 2",
    "Labour and materials are lumped together. Nothing says what sheets, ridge cap, tiles, toilet or shower mixer are being supplied, or how many.",
    "Without a description you cannot check what arrives on site, and any later disagreement about \"what was included\" has nothing to settle it.",
    "Ask for the quote itemised: each element, materials and labour separately, with the product named."],
];
const MORE = [
  [4, "No dates", "Moderate", "Quote line 7",
    "\"Start next week God willing\". No working duration or finish date, and nothing on what happens if it runs late.",
    "Roof work in October is in hurricane season. An open roof left for days is the risk.",
    "Agree a start date, a finish date, and that the roof is never left open overnight."],
  [5, "No guarantee on the finished work", "Low", "Not in the quote",
    "Nothing in writing about leaks or defects after the job is finished.",
    "A builder who stands behind the work will usually agree to put it in writing.",
    "Ask for a written promise to come back and put right any leak in the new roof for an agreed period."],
  [6, "Who clears the old roof sheets and tiles", "Low", "Quote line 3",
    "\"Transport and cleanup\" is priced, but it does not say the old zinc, tiles and rubble leave the site.",
    "Debris left in the yard is a cost and, in a storm, a hazard.",
    "Get it in writing that all waste leaves the site before the last payment."],
];

module.exports = fill({ ...T, service: "Project Setup Check", code: "PSC" }, {
  reference: R,
  statusOn: "Issued",
  coverFields: [
    ["Prepared for", "Marcia Thompson, London"], ["Property", "Family house, Lignum Vitae Road, Old Harbour, St. Catherine"],
    ["Prepared", "Wednesday 7 October 2026"], ["Reference", R],
  ],
}, [
  ["B. About this review", "kv", 0, vals(["Monique Sewell-Bennett", "Desk review", R, "Tuesday 6 October 2026", "Wednesday 7 October 2026", "A deposit of J$1,110,000, asked for by Friday 9 October"])],
  ["B. About this review", "lines", 0, text("Nothing to declare.")],
  ["B. About this review", "table", 0, numbered([
    ["Handwritten quote from R.B. Building and Repairs (Rohan Brown)", "2 October 2026", "Photograph sent by WhatsApp"],
    ["WhatsApp messages from the builder to the client", "2 to 5 October 2026", "Screenshots"],
    ["Photographs of the back roof and the bathroom, taken by the client's brother", "28 September 2026", "WhatsApp photographs"],
  ])],
  ["B. About this review", "lines", 1, text("Companies Office of Jamaica online search for the business name: no match. A Facebook page under the same name, with photographs of roofing jobs posted since 2024. The phone number on the page matches the one on the quote.")],

  ["C. At a glance", "kv", 0, vals(["Do not send the deposit as asked. The job can go ahead safely on the terms in sections G and H."])],
  ["C. At a glance", "lines", 0, text("The builder looks like a working tradesman with a record of roofing jobs, and the quote covers what you asked for. What is wrong is the arrangement around it: most of the money before anything is on site, payable in cash or to another person, to a business that cannot be traced. None of that needs a new builder. It needs the payment terms changed and five documents in hand before the first payment.")],
  ["C. At a glance", "table", 0, rows([
    ["Payment", "60% to start, balance at the end", "Five stages, each paid against evidence, nothing before materials are on site"],
    ["Detail", "Cash, or a transfer to his partner's account", "Bank transfer to an account in his own name, confirmed in writing"],
  ])],
  ["C. At a glance", "table", 1, numbered([
    ["Most of the money asked for before any work, to somebody else's account", "Severe", "Before any payment"],
    ["The business cannot be traced beyond a Facebook page", "Severe", "Before any payment"],
    ["The quote is one line per job, with no breakdown", "Moderate", "Before the second payment"],
    ["No dates", "Moderate", "Before the second payment"],
    ["No guarantee on the finished work", "Low", "When convenient"],
    ["Who clears the old roof sheets and tiles", "Low", "When convenient"],
  ])],
  ["C. At a glance", "table", 2, rows([
    ["His TRN and a home or yard address", "Red flag 2", ""],
    ["Bank details for an account in his own name, in writing", "Red flag 1", ""],
    ["The quote itemised, materials and labour separately", "Red flag 3", ""],
    ["A start date and a finish date", "Red flag 4", ""],
    ["The materials supplier's quote, made out in your name", "Red flag 1", ""],
  ])],

  ["D. What to do now", "table", 0, numbered([
    ["Tell the builder you want to go ahead, and that the deposit will not be sent as asked. Use the message in section I.", "You", "Today"],
    ["Get the five documents listed in section C.", "Builder", "Before any payment"],
    ["Send them to us. We check them against this report and tell you in writing whether red flags 1 to 4 are closed.", "Yaadly", "Within two working days"],
    ["Pay the materials supplier directly, or the builder once the materials are on site with the delivery note.", "You", "Stage 1"],
    ["Have the roof timbers looked at before the new sheets go on (section L).", "You", "Stage 2"],
    ["Pay each later stage only against the evidence in section H.", "You", "Each stage"],
  ])],

  ["E. The red flags", "kv", 0, () => flag(...FLAGS[0])[1]],
  ["E. The red flags", "table", 0, () => flag(...FLAGS[0])[2]],
  ["E. The red flags", "kv", 1, () => flag(...FLAGS[1])[1]],
  ["E. The red flags", "table", 1, () => flag(...FLAGS[1])[2]],
  ["E. The red flags", "kv", 2, () => flag(...FLAGS[2])[1]],
  ["E. The red flags", "table", 2, () => [flag(...FLAGS[2])[2], ...MORE.flatMap((f) => flag(...f))]],

  ["F. The quote, marked up", "table", 0, numbered([
    ["Roof back section. Take off old zinc, put new zinc and new ridge cap. Labour and material $980,000", "3"],
    ["Bathroom. Break out old tile, new tile floor and wall, new toilet, new shower mixer. $720,000", "3"],
    ["Transport and cleanup $150,000", "6"],
    ["Total $1,850,000", ""],
    ["60% to start, balance when finish", "1"],
    ["Can pay cash or send to my partner account", "1"],
    ["Start next week God willing", "4"],
  ])],

  ["G. Payment terms", "table", 0, column(1, [
    ["60% to start"], ["Him, or his partner"], ["Cash or bank transfer"], ["Included in his price, bought by him"], ["Two payments only"],
    ["Not stated"], ["Not stated"], ["On finishing"], ["Jamaican dollars"], ["Not stated"], ["Not stated"],
  ])],

  ["H. Payment schedule", "table", 0, numbered([
    ["Materials delivered to site", "The supplier's invoice in your name, the delivery note, and photographs of the materials on site"],
    ["Old roof sheets off, timbers seen", "Photographs of every roof timber before new sheets go on, and the engineer's answer if any rot is found"],
    ["New roof sheets and ridge cap fixed", "Photographs of the whole roof from each side, the ridge, and the straps at the wall plate"],
    ["Bathroom tiled and fittings fixed", "Photographs of the floor and walls, and a video of the toilet flushing and the shower running"],
    ["Snag list signed off", "Every item on the agreed snag list photographed as put right, and the yard clear of waste"],
  ])],

  ["I. The message to send your builder", "lines", 0, text(
    "Hi Rohan, thanks for the quote. I want to go ahead with you. Before I pay anything I need a few things in writing, which I ask of everyone I work with:",
    "1. Your TRN and your address. 2. Bank details for an account in your own name. 3. The quote broken down, materials and labour separately, with the sheets, tiles and fittings named. 4. A start date and a finish date.",
    "I will pay in stages rather than a deposit: first when the materials are on site, then at each stage as the work is done, by bank transfer within two working days of you sending me the photos. I will send you the stages in writing. Let me know if that works and we can fix the start date. Marcia",
  )],

  ["J. What was checked", "table", 0, column(2, [
    ["Provided", "Rohan Brown, trading as R.B. Building and Repairs"], ["Not provided", "Red flag 2"], ["Not provided", "WhatsApp number only"], ["Not found", "Facebook page only. Red flag 2"],
    ["Provided", "Handwritten, dated 2 October"], ["Not provided", "Red flag 3"], ["Not provided", "Red flag 3"], ["Not provided", "Red flag 3"],
    ["Provided", "The builder, inside his price"], ["Not provided", ""], ["Not provided", "Your brother has offered"], ["Not provided", "Red flag 6"],
    ["Provided", "60% then balance. Red flag 1"], ["Not provided", "Red flag 1"], ["Not provided", "Cash offered. Red flag 1"], ["Provided", "Set out in section H"], ["Not applicable", "Nothing paid yet"],
    ["Not provided", "Ask, but rarely held by a sole tradesman"], ["Not provided", "Ask who his helpers are"], ["Not provided", "Red flag 5"], ["Referred on", "Section L"],
    ["Not provided", "Red flag 4"], ["Not provided", "Red flag 4"], ["Not provided", ""], ["Not provided", "Add to the written terms"],
  ])],

  ["K. Scope of work and changes", "table", 0, rows([
    ["Take off and replace the zinc on the back roof section", "Whether any roof timbers are replaced if found rotten"],
    ["New ridge cap", "Whether straps or clips are checked or added"],
    ["Break out and retile bathroom floor and walls", "What happens to the water while the bathroom is out"],
    ["New toilet and shower mixer", "Which products, and who chooses them"],
    ["Transport and clean up", "That all waste leaves the site"],
  ])],

  ["L. Questions for other professionals", "table", 0, numbered([
    ["Are the roof timbers under the back section sound enough to take new sheets, and are the straps to the wall adequate for a hurricane?", "PERB registered engineer", "A structural judgement, which this review does not make", "3"],
    ["The house is in your mother's name. Whose name should the agreement with the builder be in?", "Attorney", "A legal question", "2"],
  ])],

  ["M. What this review is and is not", "sign", 0, signed(["Monique Sewell-Bennett", "7 October 2026", "Marcia Thompson", "7 October 2026"])],

  ["N. Appendix: what the documents said", "lines", 0, text(
    "**Quote, handwritten, dated 2/10/26.** R.B. Building and Repairs. Roof back section. Take off old zinc, put new zinc and new ridge cap. Labour and material $980,000. Bathroom. Break out old tile, new tile floor and wall, new toilet, new shower mixer. $720,000. Transport and cleanup $150,000. Total $1,850,000. 60% to start, balance when finish.",
    "**WhatsApp, 3 October, 14:12.** \"Can pay cash or send to my partner account. Start next week God willing.\"",
    "**WhatsApp, 5 October, 09:40.** \"Need the deposit by Friday to hold the date, have another job waiting.\"",
  )],
]);
