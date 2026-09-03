// What the assistant may say about how Yaadly works, on any channel.
//
// Founder's ask, 2 Sep 2026: the chat "should also have the FAQ question if
// someone asks them". These are the answers on yaadly.co.uk/faq, condensed
// to phone-screen length, and they are the ONLY source the model has for
// them. Keep this file and docs/faq.html saying the same thing: when the
// page changes, change this in the same commit, or the assistant will be
// confidently describing a product that no longer exists.
//
// One thing in here is a price, and it is here deliberately. Yaadly's own
// professional services have published list prices on yaadly.co.uk/prices.
// Repeating a published list price is not pricing work, which is the thing
// CLAUDE.md §5 forbids a model from doing: a repair is always quoted by a
// worker against a written scope and the assistant never estimates that.
// Because a model can still garble a number, priceFigureGuard() in
// price-figures.ts refuses any pound, J$ or percent figure that is not on
// the list below, so a wrong figure never reaches a client.

export const FAQ_FACTS = `More facts, from the questions people ask most. Answer a question from these in your own plain words, two or three sentences, and never add to them. If the answer is not here, say you will have it checked.
- Starting a job: two ways, both free. Post it on yaadly.co.uk, where it saves as a draft before anything personal is asked, or describe it right here in text, photos or a voice note, Patois or English. No app to download.
- Where Yaadly works: built for property work across Jamaica, launching in Kingston and Portmore first, with professional oversight on every job. More parishes open as it grows. Elsewhere in Jamaica they should still write in: professional services travel further than repairs.
- The money side on a managed job: the client pays Yaadly, not the tradesperson. Yaadly sells the job at one agreed price, engages an identity checked tradesperson and pays them directly, so the client never contracts with them. Yaadly pays the tradesperson under its own separate agreement with them, so they never wait on the client for their money. What the client's approval decides is Yaadly: no stage is closed, and no balance is due to Yaadly, until they have seen timestamped evidence from the site and said the work is right. A named person signs off every stage and approves every payment, never an automatic timer. Yaadly does not hold money on anyone's behalf: there is no account with the client's money sitting in it waiting for a button to be pressed. Payment terms are agreed in writing for each job before anything starts. Materials pass through at cost with the receipt filed against the job. If the work is wrong the client comes to Yaadly: Yaadly reviews the works and makes sure issues are handled.
- The other way to work with Yaadly, oversight only: the client keeps their own contractor and pays them directly, on their own terms with them. Yaadly holds none of that money and never pays that contractor. What the client buys from Yaadly is the eyes: somebody qualified attends, records against a checklist and writes it up, and Yaadly invoices only its own fee. Most of the published services work this way, and so does most business work.

- Yaadly's own professional services have published prices at yaadly.co.uk/services, each showing the full price and a founding rate for the first five clients: Deposit Protection Check from £149, Visual Check from £95 a visit, Condition Report from £249, Technical Sign-off £245, Oversight Retainer from £395 a month, Property Care from £45 a visit, Full Project Management 12 to 15% of build cost.

- What is inside a job's price: the accepted quote is the whole price, itemised, labour split from materials. Materials are never marked up; they pass through at cost with the receipt filed against the job. Very small jobs carry a minimum of J$3,500 to J$4,500 depending on the trade, shown on the quote before anyone accepts. Cash advanced for materials carries a disclosed 5% admin charge. Paying from abroad carries an exchange margin of about 2%; paying in J$ from Jamaica skips it.
- At the end of a job: a signed Completion Report as a PDF that is theirs to keep, with the job summary, before and after photographs side by side, the verification record, the worker's own confirmation, and the client's approval with the payment record.
- Seeing the site before accepting the work: yes. At sign-off the client can accept from the evidence, or book a live video walkthrough with the worker on WhatsApp video, Google Meet or Zoom, with the notes recorded on the Completion Report.
- Not happy with the work: raise it before accepting it. Complaints are reviewed by a person, not an algorithm; the tradesperson gets a fair chance to put it right, and nothing further is paid out on the job while the complaint is open.
- Being in Jamaica: not needed. Most clients are overseas and review the evidence and accept the work from their phone.
- How workers are vetted: nobody attends a property unverified. Every worker passes an identity check by an independent verification provider (government photo ID, a live selfie with liveness detection), shows past work, and has references checked. No job over £500, no work inside an occupied home, and no job holding keys until three referees have been spoken to directly. Certified trades are checked with the body that issued the certificate. The client is told who is coming before they arrive.
- For tradespeople: joining is free, quoting is free, and there is never a charge for a lead. The price is agreed per job, in writing, before starting; materials are paid at cost against the receipt. Paid by Yaadly, not by the client, within 3 working days of a named person at Yaadly signing the stage off, by bank transfer, Lynk or remittance pick up. Join at app.yaadly.co.uk/apply, or by answering five short questions on WhatsApp with a photo of a finished job.
- Kinds of work: repairs and maintenance through to renovations (painting, plumbing, roofing, tiling, masonry, electrical, septic and drainage, grilles and gates, and more), plus the professional services above.`;
