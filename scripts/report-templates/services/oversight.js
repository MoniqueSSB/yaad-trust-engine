const { SOLE, whoDidWhat, preparedBy, photoLog, disclosure } = require("../shared");

module.exports = {
  service: "Oversight Retainer",
  code: "OR",
  title: "Monthly oversight report",
  blurb: "Where your build stands this month: what was seen on site, progress against the programme, money against what was agreed, what went wrong, and the decisions only you can make. The same layout every month, so the trend is visible.",
  footer: SOLE,
  statuses: ["Fortnightly", "Weekly"],
  coverFields: [
    ["Prepared for", ""], ["Property", ""],
    ["Project", ""], ["Builder", ""],
    ["Report number", ""], ["Period covered", ""],
    ["Information current to", ""], ["Reference", ""],
  ],
  preparedBy: preparedBy("She observes, records and reports. She does not design, instruct the builder, certify the work, or estimate what it should cost, and this report does not make her responsible for the builder's work."),
  blocks: [
    { contents: [
      ["A", "This month in one page", "status, the main win, the main risk, what we need from you"],
      ["B", "How the status is set", "the rule behind each rating"],
      ["C", "Site attendance", "every visit this month"],
      ["D", "Progress", "done this month, planned next month"],
      ["E", "Programme", "each milestone against the agreed date"],
      ["F", "Money", "against what was agreed, and what changed"],
      ["G", "Changes to the work", "every change, and who agreed it"],
      ["H", "Quality and safety", "what was seen, and what happened next"],
      ["I", "Risks", "what could go wrong, and who is watching it"],
      ["J", "Decisions for you", "with a date and what happens if it is missed"],
      ["K", "Escalations", "every message on the WhatsApp line"],
      ["L", "The monthly call", "who, what was agreed, the actions"],
      ["M", "Photographs", "progress, from the same spots each visit"],
      ["N", "What this report is and is not", "and the declaration"],
    ] },

    { h: "A. This month in one page" },
    { table: { head: ["", "Last month", "This month", "Why"], widths: [1.5, 1.2, 1.2, 5], rows: [
      ["Overall", "", "", ""], ["Time", "", "", ""], ["Money", "", "", ""], ["Quality", "", "", ""], ["Safety", "", "", ""], ["Scope", "", "", ""],
    ], firstBold: true } },
    { kv: [["The main thing achieved", ""], ["The main risk", ""], ["The decision we need from you", ""]], cols: 1 },
    { kv: [["Agreed finish", ""], ["Forecast finish", ""], ["Change in a month", ""], ["Agreed total", ""], ["Paid to date", ""], ["Change in a month", ""]] },

    { h: "B. How the status is set" },
    { p: "Three ratings only, and each one is set by a stated rule, not by feel. Last month's rating sits next to this month's so you can see which way it is moving." },
    { key: [
      ["On track", "ok", "Within what was agreed.", "No action needed from you."],
      ["At risk", "moderate", "An early warning.", "Something needs attention now so it does not become a problem. The fix is in section I or J."],
      ["Off track", "severe", "Outside what was agreed.", "A recovery plan is written in section I and a decision may be needed from you."],
    ] },
    { table: { head: ["Area", "On track", "At risk", "Off track"], widths: [1.2, 2.6, 2.6, 2.6], rows: [
      ["Time", "Forecast finish within 1 week of the agreed finish", "1 to 4 weeks late", "More than 4 weeks late, or no forecast from the builder"],
      ["Money", "Paid and requested within the agreed total plus agreed changes", "Changes asked for but not yet agreed, up to 10% of the agreed total", "Over 10%, or money asked for without matching work on site"],
      ["Quality", "No open put right items older than 2 weeks", "Open items older than 2 weeks", "Work covered up before a problem was put right"],
      ["Safety", "Nothing seen", "A risk seen and raised", "An injury, or a risk raised and not dealt with"],
      ["Scope", "Work matches the agreed scope", "A change is being discussed", "Work done that nobody agreed"],
    ], firstBold: true } },

    { h: "C. Site attendance" },
    { table: { head: ["#", "Date", "Time in", "Time out", "Attended by", "Builder on site", "Workers on site", "Weather", "Photos"], widths: [0.35, 0.9, 0.75, 0.75, 1.3, 1.1, 0.9, 0.9, 0.8], blank: 5, number: true } },
    { small: "Visits are made on the plan's schedule: fortnightly or weekly. A visit that was missed or moved is written here with the reason." },
    ...whoDidWhat("Site attendance, on the dates above"),

    { h: "D. Progress" },
    { lines: 4, label: "Done this month, as seen on site" },
    { lines: 3, label: "Planned for next month, as the builder has stated it" },

    { h: "E. Programme" },
    { table: { head: ["#", "Milestone", "Agreed date", "Forecast or actual", "Days late", "Status", "Comment"], widths: [0.35, 2.3, 1, 1.1, 0.7, 0.9, 2.6], blank: 7, number: true } },

    { pb: true },
    { h: "F. Money" },
    { p: "Money is shown against what was agreed, with last month's figures beside this month's so every movement has a reason. Figures from the builder are marked as the builder's. This report tracks spending; it does not estimate what the work should cost, which is a quantity surveyor's job." },
    { table: { head: ["Line", "Last month", "This month", "Movement", "Reason for the movement"], widths: [2.6, 1.1, 1.1, 1, 3], rows: [
      ["1  Agreed price for the work", "", "", "", ""],
      ["2  Agreed changes (section G)", "", "", "", ""],
      ["3  Agreed total (1 + 2)", "", "", "", ""],
      ["4  Paid to date", "", "", "", ""],
      ["5  Asked for, not yet paid", "", "", "", ""],
      ["6  Left to pay on the agreed total (3 minus 4 minus 5)", "", "", "", ""],
      ["7  Changes asked for, not yet agreed (builder's figure)", "", "", "", ""],
      ["8  Builder's own forecast of the final total", "", "", "", ""],
    ], firstBold: true } },
    { h3: "Payments this month" },
    { table: { head: ["Date", "Stage or reason", "Amount", "Evidence seen before it was paid", "Matches the work on site"], widths: [1, 2, 1, 3, 1.6], blank: 4 } },

    { h: "G. Changes to the work" },
    { p: "Every change to the agreed scope, from any side. A change is only agreed when you have agreed it in writing, and the date you did is recorded here." },
    { table: { head: ["#", "Change", "Asked for by", "Builder's price", "Time effect", "Status", "Agreed by you on"], widths: [0.35, 2.6, 1.1, 1, 1, 1.2, 1.2], blank: 5, number: true } },
    { small: "Status is one of: asked for, priced, agreed, turned down, withdrawn." },

    { h: "H. Quality and safety" },
    { table: { head: ["#", "What was seen", "Where", "Photos", "Raised with", "On", "Status"], widths: [0.35, 3, 1.2, 0.8, 1.2, 0.9, 1], blank: 5, number: true } },
    { tick: [["Builder's insurance seen", "Date seen:"], ["Municipal inspections due or done", "Which:"], ["Any injury this month", "If yes, written in the table"]] },

    { h: "I. Risks" },
    { table: { head: ["#", "Risk", "Likelihood", "Impact", "What is being done", "Watched by", "Review on"], widths: [0.35, 2.6, 0.85, 0.75, 2.4, 1.1, 0.9], blank: 5, number: true } },
    { small: "Likelihood and impact are each High, Medium or Low. A risk that is High on both carries a named person and a date, every time." },

    { h: "J. Decisions for you" },
    { table: { head: ["#", "Decision needed", "Options", "Needed by", "If it is missed", "Your answer"], widths: [0.35, 2.4, 2, 0.9, 2, 1.4], blank: 4, number: true } },

    { h: "K. Escalations" },
    { table: { head: ["#", "Date and time", "Raised by", "What it was about", "What was done", "Closed on"], widths: [0.35, 1.1, 1, 2.8, 2.6, 0.9], blank: 4, number: true } },

    { h: "L. The monthly call" },
    { kv: [["Date and time", ""], ["On the call", ""], ["Length", ""]] },
    { p: "Open actions from last month are reviewed first. \"Ongoing\" is not a status: an open action always says what happens next and by when." },
    { table: { head: ["#", "Action", "Owner", "Due", "Status", "Evidence it is done"], widths: [0.35, 3, 1.2, 0.9, 1.2, 2.2], blank: 6, number: true } },
    { small: "Status is one of: done, open, blocked, dropped." },
    { lines: 3, label: "Points agreed on the call" },

    { h: "M. Photographs" },
    { p: "Progress photographs are taken from the same fixed spots each visit, so one month can be laid beside the last." },
    ...photoLog(12).slice(1),

    { h: "N. What this report is and is not" },
    { p: "This report records what was seen on the site visits listed in section C and what the builder and you have said in writing. The author observes and reports on your behalf, and does not design the work, instruct the builder, certify the work, supervise day to day, or estimate what the work should cost, and nothing in it makes the author responsible for the builder's work, programme or price. Anything that needs a licensed professional is referred on in writing: valuation to a licensed valuer, title and legal opinion to an attorney, structural engineering to a PERB registered engineer, and boundaries to a commissioned land surveyor." },
    disclosure("The author of this report has"),
    { lines: 1 },
    { h3: "Declaration" },
    { p: "I compiled this report from the site visits in section C, made by the people named there, from the photographs and notes they returned, and from what the builder and you said in writing. It is a true record of that, to the best of my knowledge and belief." },
    { sign: ["Signed", "Name", "Date", "Sent to"] },
  ],
};
