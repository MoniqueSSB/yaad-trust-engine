# Yaadly copy guidelines

The single source of truth for customer facing wording on `docs/` and on the app surfaces in `web/app/`.
Written 4 September 2026. If a page and this document disagree, this document is right and the page is a bug.

Two rules before anything else.

1. **No dashes.** Never an em dash or an en dash in anything published for Yaadly. Use a comma, a colon, brackets or a full stop, or rewrite the sentence. Hyphens inside ordinary compound words are fine.
2. **Never say escrow.** Not the word, not the shape of it. See section 2.

   One deliberate asymmetry. These marketing pages may carry the explicit sentence "Yaadly does not operate an escrow service", because a reader who arrived worried about it needs it answered. **Outbound assistant text may not**, in any form, including a denial: the banned-language screen in `supabase/functions/_shared/guardrails.ts` cuts the token itself, and putting the word in front of a client over WhatsApp is what it exists to prevent. In assistant copy say "Yaadly does not hold money on anyone's behalf" instead. If a guardrail test fails on this, the copy is wrong, never the test.

---

## 1. What Yaadly is, in one paragraph

Yaadly is for people who own property in Jamaica and cannot stand in front of it, most of them living in the UK, the United States or Canada. It arranges property repair, maintenance and property care in Jamaica, and it documents the work so an owner four thousand miles away can see what was actually done. It is not a directory: a directory hands you a phone number and steps back, where Yaadly scopes the job, prices it against real material costs and real day rates, puts an identity checked tradesperson on it, and reviews the finished work. **On a managed job Yaadly is the principal contractor: you buy the job from Yaadly at one agreed price, and Yaadly engages and pays the tradesperson as its subcontractor.** You never contract with them and you never pay them, so if the work is wrong you come to Yaadly, not to a stranger in Jamaica.

**Yaadly Ltd**, registered in England and Wales, company number **17358077**.

---

## 2. The two lanes

This is the most important section in this document. The site has two true offers, and almost every contradiction found in the Stage 1 audit came from a page reaching for the wrong one.

**Every page must make its lane obvious before it mentions money.**

| | **Managed job** | **Oversight only** |
|---|---|---|
| Who engages the tradesperson | Yaadly | You do, and they stay yours |
| Who you pay for the work | Yaadly, one agreed price | Your contractor, directly |
| Who pays the tradesperson | Yaadly, on completion, as subcontractor | You do. Yaadly never touches it |
| What Yaadly sells | The job | The eyes: attendance, inspection, the written report |
| If the work is wrong | Yaadly's to put right | Your contractor's to put right. Yaadly evidences it and says so plainly |

**Where each lane lives**

- **Managed job:** the homepage, the marketplace overview, the job board, Full Project Management.
- **Oversight only:** Yaadly for business, and six of the seven priced services (Deposit Protection Check, Visual Check, Condition Report, Technical Sign-off, Oversight Retainer, Property Care).

**The one nuance that must not be dropped.** On the oversight lane Yaadly still invoices its own fee, and on Property Care the person attending is Yaadly's, not the client's contractor. So the sentence is:

> On an oversight engagement, **Yaadly holds none of the money for the building work.** You pay your contractor directly. Yaadly's own fee is invoiced separately.

Never the bare "Yaadly holds none of your money", because the client is holding an invoice from Yaadly while they read it.

---

## 3. Payment and completion

### Managed job

Use these:

- "You pay Yaadly for the work."
- "Yaadly engages the tradesperson as a subcontractor."
- "Tradespeople are paid by Yaadly on completion."
- "We check the work and the evidence before sign off."
- "For larger jobs we may break the work into stages. Each stage is paid on completion."
- "One price, agreed in writing before anything starts."
- "Materials pass through at cost, never marked up."

Never use these:

- "Escrow", "held in escrow", "escrow account", "held safely with a licensed provider".
- "You approve the payment." "You release the funds."
- "The worker is not paid until you release the money."
- "Nobody is paid until you sign off."
- Anything that makes the client's approval the trigger that moves a subcontractor's pay.

**Why the last four are banned, and it is not only tone.** Under the principal contractor model the client does not contract with the tradesperson, so they have no power to release that person's pay and it is wrong to tell them they do. What the client actually does is **accept the work**. Yaadly then pays its subcontractor. Two different acts, and the site used to collapse them into one.

You may still say, because these are true:

- "We only sign a job off when the work is done as agreed."
- "We use photographs and updates to confirm what has been done."
- "You see the evidence before you are asked to accept the work."
- "A named person at Yaadly reviews the finished work."

### The human approval gate

**This is a control in the system, not a marketing line, and it does not move.** A named person at Yaadly confirms every payment. Nothing is paid because a countdown ran out, a confidence score passed, or an evidence check went green.

Describe it from Yaadly's side, not the client's:

- Good: "A named person at Yaadly checks the work before the tradesperson is paid. Never an automatic timer."
- Bad: "Nothing moves without your say so."

### Oversight only

- "You pay your contractor directly, on your own terms with them."
- "Yaadly's fee is invoiced separately."
- "We attend, we record, and we write it up. We do not pay your contractor and we do not hold your money for the work."

### How money actually reaches Yaadly, as at 4 September 2026

- Above £500 a job is invoiced, and the invoice is the record that you bought the job from Yaadly Ltd.
- At or under £500 the card is authorised at booking and charged once the work is done and accepted. **Card is not switched on yet**, so until it is, everything is invoiced and paid by bank transfer in GBP, USD or CAD.
- Any page that mentions cards must carry that "not switched on yet" caveat. Do not describe card as live anywhere, including in the privacy provider table and the cancellation timing page.

### Fees, stated the same way everywhere

- **15% Guarantee and Support fee** on the client side, on labour, never on materials.
- **12%** on the tradesperson's side. Their price is agreed with them in writing before they accept, and Yaadly engages them at that price less 12%. Nothing is deducted from money of theirs.
- Materials at cost, receipt filed against the job. **5% admin charge** only where Yaadly advances cash for materials, disclosed on the quote.
- Small job minimum **J$3,500 to J$4,500** depending on trade, on the quote before acceptance.
- Paying from abroad carries an exchange rate margin of about **2%**. Paying in J$ from Jamaica avoids it.
- Every charge that applies appears on the quote, itemised, before anything is agreed.

---

## 4. Trust language

### What "vetted" means, and it means exactly this

One definition, used identically everywhere. Where a page needs the short form, use the short form and link to the long one.

**Short form:** "Identity checked before they can quote, with references taken up before larger jobs."

**Long form:**

- **Every** tradesperson passes an identity check run by an independent verification provider before a first job: government photo ID checked for authenticity, plus a live selfie with liveness detection.
- **Three referees are spoken to directly** before a tradesperson can take any job over £500, any work inside an occupied home, or any job where they hold keys.
- **Certified trades** have their certification checked with the body that issued it.
- Yaadly only continues sending work to people who meet the evidence standard.

**Do not write** "references called" or "references checked" without the £500 qualifier. It is not true below that line, and the audit found it published on the marketplace page.

### Claims

Never claim, in any form:

- Government approval, endorsement or licensing that does not exist.
- Insurance cover that is not in place. The workmanship guarantee is not insured yet and must not be promised.
- "100%", "fully protected", "risk free", "zero fraud", "removes all fraud", "guaranteed".
- "Fully vetted" or "verified" as a bare adjective. Say what was checked.

Always make clear:

- Yaadly coordinates the work and the documentation.
- Yaadly does not replace a structural engineer, an attorney, a quantity surveyor or a land surveyor. Those go out to a named professional, in writing.
- Yaadly does not guarantee an outcome. It improves the information you decide on and the oversight of the work.

### Discounts, and the law

A founding rate must be a real reduction against a price the standard rate has actually been. **Never publish a founding rate equal to the standard rate.** Presenting a discount off a price nobody can buy is a misleading action under the Digital Markets, Competition and Consumers Act 2024. If there is no discount, say "Fixed fee, the same rate for everyone", which is already used correctly on Technical Sign-off.

Prices must match on every page they appear. Homepage, services page, FAQ and any WhatsApp prefill message.

### Numbers

No invented reviews, ratings, testimonials or client counts. None currently exist on the site and that stays true. "First five clients" is a stated limit on an offer, which is fine, and is not a claim about how many clients exist.

---

## 5. Calls to action

One hierarchy, on every consumer page, in this order.

| Rank | Label | Goes to | Notes |
|---|---|---|---|
| Primary | **Start a project** | `app.yaadly.co.uk/jobs/new` | "Post a job, free" is the accepted alternative on the marketplace page |
| Secondary | **Message us on WhatsApp** | `wa.me/447878877567` | Must appear on every consumer page. Currently missing from several |
| Worker | **Join as a worker** | `app.yaadly.co.uk/apply` | Always says "free to join, free to quote" nearby |
| Business | **Yaadly for business** | `/business` | Quiet, one line, never competing with the primary |

The **Ask Yaadly** chat launcher sits on every page from `chat.js`. It is not a CTA in this hierarchy and must not take the secondary slot from WhatsApp.

Booking link is `https://cal.com/yaadly/15min` everywhere. Not `cal.com/yaadly`.

### Response time, one promise only

**"A person replies within one working day."** That is the promise. WhatsApp may be described as the fastest channel, but no page may promise "any time", "day or night", or "within 24 hours", because those are three different promises and one of them will be broken at 2am on a Sunday.

Reports are delivered **within 72 hours of the visit**, and that must be written as a target with its condition attached, not as a bare statistic.

---

## 6. Tone and style

- **Calm, clear, professional, human.** No hype. Never oversell.
- **Plain English.** The reader may be a 70 year old in Brooklyn who owns a house in Portmore and has never commissioned building work. Assume no construction vocabulary.
- **Sentences short.** Aim under 25 words. Break any sentence carrying more than two ideas.
- **Paragraphs short.** Two or three sentences on marketing pages. Legal pages may run longer, with a plain English summary at the top.
- **Say the thing, then stop.** Do not restate the same idea in three different sections of one page.
- **Concrete over clever.** "A trained checker photographs everything against a checklist. They record. They do not rate or advise." That is the standard to write to.
- **Be honest about what is not built.** Planned features are labelled planned. Gaps in legal terms say they are with an adviser rather than being filled with guessed wording. This is a strength of the current site and it stays.

### Words to avoid

escrow · held in escrow · held safely with a licensed provider · you release the funds · nobody is paid until you sign off · 100% · fully protected · risk free · zero fraud · removes all fraud · guaranteed · fully vetted · verified (as a bare claim) · seamless · effortless · revolutionary · trusted by thousands

### Preferred phrases

- "You pay Yaadly for the work. Yaadly pays the tradesperson on completion."
- "We check the work and the evidence before sign off."
- "A named person at Yaadly reviews the finished work."
- "Identity checked before they can quote."
- "One price, agreed in writing before anything starts."
- "Materials at cost, never marked up."
- "A client in London pays what a client in Portmore pays."
- "If the work is wrong, you come to us."
- "This is not a gap we are filling with a guess."

---

## 7. Accessibility and structure

- Every page has one `h1` and a real `h2` for each major section. The FAQ accordions carry `role="heading" aria-level="2"` on the summary.
- Link text says where it goes. Not "read it here" or "see the full list".
- Wide tables scroll inside their own container. The page body never scrolls sideways.
- Internal links use one convention. The nav and footers use root relative paths (`/services`), not `services.html`.
- Nothing auto rotates faster than a person can read it, and anything that moves respects reduced motion.

---

## 8. Legal pages

Privacy, terms and cancellation each open with a plain English summary before the formal wording. Anything genuinely unsettled says so on the page and names what is outstanding, rather than being filled with wording nobody has checked.

Clauses needing a solicitor are marked in the page comments. As at 4 September 2026 that is: liability and its limits, the workmanship guarantee and its duration, governing law and jurisdiction for clients in the United States and Canada, retention periods including identity documents, and the statutory model cancellation form wording.
