# Build spec: Client, Worker and Service portals
**Version 1.0, 26 August 2026. Authored by Monique. Canonical.**
**Reference implementation:** `preview/index.html`. Every component named here exists there, working, and is lifted from there. The copy in the reference is decided; lift it verbatim (the repo copy of the reference is already dash-scrubbed per the house rule and is the canonical wording).

**Implementation target, amended 26 Aug by Monique's later decision:** the portals are built in `web/` (Next.js on Cloudflare Workers), NOT in `docs/index.html`. Her words: the portal is confidential and lives in a different room behind the cloud layer; the website is the visual front door only. Everything else in this spec (stages, components, rules, copy, data mapping, acceptance tests) is binding as written. The single-render `drawJourney()` architecture translates to React components; the functional behaviour must match this spec exactly.

## Non-negotiable rules
| Rule | Enforcement |
|---|---|
| A job is a draft until the client signs Client Guidelines | RLS: `jobs` visible on the board only where a current-version `client_guidelines` signature exists in `doc_signatures` |
| No AI agent touches a client's work before signature | `may_use_agents()` gate, already in the DB |
| **Yaadly never shows a price band to a worker** | No band component on any worker-side render. The client's `budget_band` column is never selected in a worker-context query |
| Contact details are scrubbed from in-portal chat | `scrub()` runs on every message before insert AND before render |
| Money moves per stage, never as one lump | Every release is a row; no bulk release path exists |
| A milestone edit after issue creates rev 2 | `kickoff_packs` is append-only by revision; never UPDATE a row |
| Evidence is fingerprinted on upload | SHA-256 stored at insert; never recomputed on read |

## Layout, identical in all three portals (top to bottom, order decided)
1. Calendar band. ALWAYS VISIBLE, never behind a click. Month grid plus "Coming up" cards.
2. Stage rail, one button per stage, done / now / todo.
3. Position line with Prev and Next.
4. Head: badge, heading, one paragraph.
5. Four stat tiles for the stage.
6. The stage-specific components (section: stage to component map).
7. Actions: one primary, one or more ghost.

## Sides and state
Three portals are three sides of one component tree: client, worker, service. In production, everything except the side and the current stage derives from rows. Stage maps to `jobs.status`. Stage count comes from `kickoff_packs.stages`, per job, NEVER fixed at two. The DB must refuse any pack whose stages do not total 100%.

## Stages
Job journey (client and worker), 13:
Job live · Quote built · Quotes in · Scope agreed · Chosen & funded · Kickoff issued · Stage 1 on site · Stage 1 evidence · Stage 1 released · Stage 2 on site · Stage 2 evidence · Closed & paid · Reviews

Service journey, 12 (full parity with jobs; a four-step version was wrong and is not to return):
Booked & paid · Intake · Scope agreed · Kickoff issued · M1 working · M1 evidence · M1 released · M2 working · M2 evidence · M3 handover · Closed & paid · Review

Job shapes: tap (1 stage, 100%), std (2, 60/40), roof (3, 30/40/30), reno (5). Service shapes: check (1, 100%), retainer (3, 40/40/20), fullpm (5, 15/15/25/25/20). Shapes are demo affordances; production reads `kickoff_packs.stages`.

## Stage to component map
See `preview/index.html` `drawJourney()` for the authoritative mapping (svc-portal through svc-next, quotes through rev-c, qb through rev-w). Worker side substitutes `disputeWorkerBlock()` for `disputeBlock()` and NEVER renders a band.

## Shared components (all exist in the reference)
- **calBand**: three views of one calendar. Worker sees own diary and toggles days open or closed. Client sees only days the worker opened, only their own job, and requests a slot. Service sees Monique's open days and books 15 min, 30 min, or half day on site. Day states: free (teal), booked (mango), pending (coral), today (ring), sel, pad, disabled past. A confirmed slot closes the day for everybody else. Tables: `worker_availability(worker_id, day, open)`, `visits(job_id, day, slot, what, who, where, state)`. Needs the max-width 460px media rule or the grid overflows.
- **ledger / svcLedger**: one block per stage: name, title, pct, state chip, required proof list, uploaded evidence. Copy that must survive: "Each stage has its own checklist, its own proof and its own release. Money moves once per stage, never as one lump at the end."
- **evGrid + fingerprint**: thumbnails plus a monospace SHA-256 line. Compute at upload, store on the row, display on read. Never recompute on read.
- **jobChat**: in-portal chat, relayed to WhatsApp both ways via `yaad-whatsapp-webhook`, fully automated. The scrub regex set (email, number, spelled-out number, off-platform app, off-platform payment, handle) runs on insert AND render. A blocked message shows what was removed and why; never silently drop.
- **scopeDoc**: a worker cannot be chosen until both sides tick the scope. Until then the button reads "Choose unlocks when both have agreed".
- **disputeBlock / disputeWorkerBlock**: state machine none, form, direct, resolved or escalated. The worker is the first point of contact and sees the dispute the moment it is raised. Nothing releases while a dispute is open. One visual review visit covered; further visits chargeable; Yaadly looks and records, never certifies.
- **docsX**: clickable documents rail. kickoff opens kickoffPack (or jobSheet when the job tier is sheet), completion opens completionReport.
- **msEditor**: presets are templates, fully editable: rename, retitle, percent, reorder, delete, add, per-proof add and remove, reset. Total teal at exactly 100%, coral otherwise: "Must total exactly 100%. The database refuses anything else, and so do I." Focus and caret must survive re-render. Post-issue edits create rev 2; both sides re-sign; rev 1 stays readable forever.
- **Kickoff pack tiers**, auto by stage count with manual override: 1 stage = Job Sheet (6 sections, built from the accepted quote verbatim); 2 to 3 = Kickoff Pack (9 sections, adds access and dates, variations, dispute route); 4+ = Pack + Programme (12 sections, adds dated programme, materials schedule reconciled against receipts, named professionals outside scope).
- **completionReport**: seven sections. Section 6 is legally load-bearing and reproduced exactly (not legal advice; no title verified, no boundary identified, no structure certified; attorney-at-law, commissioned land surveyor, PERB-registered engineer respectively; CRA 2015 s49 line). "The worker writes no paperwork." Drafted by `yaad-completion`, confirmed by the worker, reviewed by a person, then delivered. Never auto-published.
- **reviewPicker**: offered at Scope agreed and again at final evidence. No reviewer (included), Visual Check £149 (£95 founding), Technical Sign-off £300 (£245 founding). Live viewing £40 on any rung. Standing warning: "Visits not agreed at the start are chargeable."
- **reviewBox**: two-way, job-bound, sealed until both are in or 14 days. One public reply, no deletion. Yaad Score recalculates from signed-off jobs only, by DB trigger, once per job.

## Data mapping
New columns: `jobs.budget_band` (client-only, never selected in a worker query), `jobs.reviewer_tier`, `jobs.live_view`. New tables: `visits`, `worker_availability`, `scope_agreements`, `variations`, `messages`. Full component-to-table map as in the authored spec.

## Build order
1 shared shell · 2 calendar band · 3 ledger + evidence + fingerprint · 4 documents rail and packs · 5 chat + scrub then WhatsApp relay · 6 scope gate + quotes + quote builder · 7 milestone editor · 8 reviewer picker · 9 dispute machine · 10 two-way reviews.

## Acceptance tests
Headless at 390, 768, 1280, 1600: zero horizontal overflow, zero JS errors. Calendar visible on load in all three portals. Availability round trip (open, book, pending, confirm, closed for others). Every stage renders its mapped components clean. Shapes 1/2/3/5 drive ledger, rail and pack tier. Chat blocks email, phone, spelled-out number, "whatsapp", with reason shown. Choose locked until both scope ticks. Milestone totals colour correctly and typing keeps focus. Pack tier renames the document row. Completion Report renders with section 6 intact. Dispute both paths. Worker DOM greps clean for "band" and for the client's budget value. Reviews unwritable against a job the account was not party to.

## Do not
No calendar behind a toggle. No fixed two-stage count. No band to a worker ever. No choosing before mutual scope agreement. No UPDATE on issued packs. No auto-published Completion Report. No rewriting the decided copy.
