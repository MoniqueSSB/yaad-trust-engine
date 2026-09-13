# Project Overview

**Yaad Trust Engine** · the agentic layer inside **Yaadly**
Track 02, Finance, Payments and MSME Capital
Yaadly Ltd, England and Wales, company no. 17358077
Repository: `github.com/MoniqueSSB/yaad-trust-engine` · Site: `yaadly.co.uk`

---

## The problem

Jamaica received **US$3.49bn in remittances in 2025**, a large share of it maintaining family property. That money moves blind. The diaspora client in London, New York or Toronto cannot see the site, has no proof the work happened, and no recourse when it does not. The worker does the job, gets stiffed, and holds no record a bank would ever accept.

There is a second problem underneath it. Property work in Jamaica is priced privately, one WhatsApp message at a time. Research in August 2026 confirmed that **no public price exists anywhere in the country** for painting, bathrooms, septic or block walls. That opacity is exactly what lets an overseas owner be quoted more than the neighbour for identical work. Jamaicans have a name for it: the farrin price.

Nobody has built the layer that fixes both: verification, protected payment, evidence, and financial identity, in one loop, on the tools people already use.

## What we built

A verified job loop that runs end to end over WhatsApp, designed for low bandwidth and informal-economy conditions, with four agents doing the coordination and a named human taking every decision that touches money or trust.

| Agent | What it does | What it must never do |
|---|---|---|
| **Intake** | Turns typed text, photo captions or a Patois voice note into a structured Job Card. At most three clarifying questions. | Quote a price. Promise a timeline. Ask the client to rephrase. |
| **Pricing** | Returns a fair-price band from researched benchmarks, with confidence and source. Reviews the shape of a worker's quote. | Invent a number. Where no public price exists, it says so. |
| **Verification** | Checks the evidence chain (Arrival Log, materials receipts, Midnight Work-Log) for completeness, sequencing and plausibility. Produces a pack for a human. | Adjudicate. Release funds. Touch a Yaad Score. |
| **Reporting** | Converts a worker's update into a plain-English status report for an overseas client. | Add detail the worker did not give. Promise the work is good, or that payment will move. |

**Two design choices we will defend.**

**Pricing is deliberately not a language model.** The founding premise is that a client in London pays what a client in Portmore pays. A hallucinated band would break the one thing this exists to fix, so pricing is a lookup against researched benchmarks and returns "no public price exists in Jamaica for this work" rather than a guess.

**The site-match gate protects the worker, not only the client.** If the site does not match what the client described, the worker is not held to a job they were mis-sold. That is the Mirror Rule in code: every protection has a named counterpart on the other side.

## What is actually running today

This is a working system, not a prototype of one.

- **31 Supabase Edge Functions** in production: WhatsApp intake, transcription, vetting, identity confirmation, matching, invoicing, evidence, notifications and completion reports.
- **A live WhatsApp channel** on a verified business number, carrying multi-turn intake with thread memory and a human handoff.
- **The approve button**, the moment the product is named after: a client approves a stage from anywhere, including by replying on WhatsApp, and the approval snapshots every evidence item's id, hash and label before the stage advances.
- **Worker evidence capture** with an offline queue, because Jamaican mobile data drops mid upload.
- **A public price guide** at `docs/prices.html`, sourced and dated, publishing real ranges and stating its gaps honestly rather than guessing.
- **Row level security across all 47 tables**, tested live on 29 August 2026 against an anonymous caller and a signed-in stranger. Every sensitive table returned zero rows.
- **31 tests**, plus a mock mode where every mocked line is labelled `(mock)` so nothing can be mistaken for a live model result.

## Why it matters beyond Jamaica

It converts the Caribbean's largest private capital flow from blind transfer into verified economic activity. And it opens the formal economy to workers the industry ignores: uncertified, rural and informal tradespeople are onboarded from day one behind an identity check and a short audition, with early jobs capped for client safety, and verified performance carrying them upward. Every documented job compounds into the **Yaad Score**, a portable work history a credit union can lend against and a training body can fast-track from.

The pattern generalises to every remittance corridor on earth.

## Status and honesty about it

Pre-launch, with a December 2026 pilot planned in Kingston and Portmore. Professional indemnity insurance is not yet in force and no paid client work runs before it is. Every record in the system today is synthetic; the text model moves from MiniMax to EU-hosted Mistral before real client and worker data arrives, and the code is already written to read one shared setting.

We are building infrastructure, not a hackathon entry. This is the company.
