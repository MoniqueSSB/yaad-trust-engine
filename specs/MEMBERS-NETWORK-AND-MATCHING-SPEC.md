# Build spec: Members' Network and full AI matching
**Version 1.0, 21 September 2026. Authored by Claude from Monique's founder decision the same day: "the Year 2 stuff needs to be implemented now." Not yet built. This is the brief, not a record of what exists.**
**Companions:** `specs/MARKETPLACE-SPEC.md` (open_jobs, job_quotes, worker_profiles, the board this extends) · `specs/POST-A-JOB-FLOW-SPEC.md` (yaad-match, already live, trade plus parish alerting, and the availability calendar in its step 3) · `specs/PORTALS-BUILD-SPEC.md` (where a worker sees an invite).
**Foundation already built, not yet deployed:** the shortlist agent, `yaad-shortlist`, on branch `claude/ai-agent-tradeperson-booking-400f78`, decided and built 9 September 2026 (see `BridgeWorks_Ideas_Ledger.md`, the "client chooses who picks the tradesperson" entry). This spec extends that agent rather than replacing it. Deploy it first if it is not already live; everything below assumes it is.

---

## 0 · The rule this whole spec answers to

The governing rule in `CLAUDE.md` section 2 is unchanged by anything here: **AI coordinates, verifies and drafts. It never releases money, rules on a dispute, or alters a reputation. A named human confirms every consequential step.** `HUMAN_ONLY_DECISIONS` in `yaad/guardrails.py` does not list "shortlist a worker" or "match a job", so nothing below needs a new guardrail entry. But the founder has already gone further than the guardrail requires, on the record, and this spec keeps that stricter line:

> The shortlist agent alerts nobody. It cannot pick outside the vetted candidate pool and cannot touch a quote, a price or a booking. A person on the desk invites from the list it produces.

Every matching feature below is built to that stricter sentence, not just to the guardrail floor.

**No escrow, no held language, anywhere in this feature's copy.** `yaad/guardrails.py` screens for it already (`ESCROW_GUIDANCE`, `HELD_GUIDANCE`, the "held safely" patterns); nothing here needs new patterns, but every screen written for this feature goes through the same scan before it ships. The client buys the job from Yaadly. Yaadly pays the worker separately, once the client approves.

---

## Part A · Full AI matching (extends yaad-match and yaad-shortlist)

### A1 · What already exists, and what this adds

`yaad-match` (live, per `specs/POST-A-JOB-FLOW-SPEC.md` §9) alerts workers on trade plus parish when a job goes live. `yaad-shortlist` (built, not deployed) reads a job and the vetted candidates' published profiles and names up to four to ask, with a plain reason each, ranked on verifiable data only, never pay-for-placement.

This spec asks for one thing: take `yaad-shortlist`'s reasoning and make it read the job in **plain language**, not just the structured trade and parish fields, and run it across the **whole open board**, not only jobs where "Yaadly picks for me" was chosen. Concretely:

1. **`yaad-match` calls `yaad-shortlist`'s ranking function on every new job**, regardless of which "who picks" answer the client gave. The output is stored (`job_shortlists` table, one row per job, JSON array of `{worker_id, reason}`), not sent anywhere. It is data the desk and, later, the client-facing board can draw on. Storing a ranking is not alerting or booking; it changes nothing about who sees what until the rest of this section is built.
2. **The ranking function reads the free-text description** (the same field `yaad-agent` tidies in the post-a-job flow) alongside the structured job card, not the structured card alone. A worker whose past evidence and profile text plausibly match the free-text description should rank, even if the structured trade field is broad ("general repairs") and the free text is specific ("regrouting a bathroom floor").
3. **Availability**, per `specs/POST-A-JOB-FLOW-SPEC.md` §6, already has a per-worker calendar feeding the "teal days" on the client's date picker. Read that same table in the ranking function: a worker with no matching open day within the client's stated urgency window ranks lower, never excluded outright, because a worker can always say yes to a day they have not yet flagged.
4. **The reason string stays plain English and specific**, matching the existing `yaad-shortlist` output shape: "regrouted two bathrooms in Barbican this year, has 8 and 9 October open." Never a bare score. A number with nothing behind it is not a reason, it is a claim, and this repo's own guardrail principle (§5 of `CLAUDE.md`, pricing is a lookup, never invented) applies here too: **matching is ranking real facts, never a generated confidence percentage.**

### A2 · What stays exactly as it is

- The desk still invites. Nothing in this section sends a notification to a worker that a human did not choose to send.
- `job_quotes`, `open_jobs`, and every rule in `specs/MARKETPLACE-SPEC.md` §"Rules that must not break" are unchanged. A shortlisted worker still has to submit a quote through the same policy-gated insert as anyone else.
- The open board itself is unchanged for a visitor or a worker browsing it directly. This is a ranking layer underneath the board, not a new board.

### A3 · Acceptance tests

- [ ] Every new job gets a `job_shortlists` row within the same request that creates it, or a background job within a defined SLA (propose 60 seconds, confirm with Monique before building to a tighter number).
- [ ] The ranking reads the free-text description, not only the structured trade field, and a test job with a broad trade and a specific description surfaces a worker whose evidence matches the specific description.
- [ ] Availability lowers rank but never excludes a worker outright.
- [ ] No notification, WhatsApp message, or email is sent as a side effect of a shortlist being computed.
- [ ] Every reason string cites a real fact (a completed job, a piece of evidence, an open calendar day); none is a bare number.
- [ ] Guardrail scan passes on every new copy string this section introduces.

---

## Part B · Members' Network, the trust-gated marketplace

### B1 · The gate

> **Only a worker or client who has completed at least one job inside Yaadly can post or reply here.** Nobody buys their way in and nobody is admitted on promise. This is what makes it worth having: a reputation you cannot fake.

Practically: a `members_network_posts` table with an insert policy that checks the same completed-job fact the review system already computes for the Yaad Score in `specs/MARKETPLACE-SPEC.md` ("Reviews" section: "score recalculated from signed-off jobs only by trigger, once per job"). Reuse that computed fact rather than adding a second definition of "completed."

Until the pilot has produced real completed jobs, this gate is real but empty, and that is correct, not a bug to route around. **Do not lower the bar to make the feature look populated.** The founder's own note on this, carried over unchanged from the roadmap card that named this feature: it is earned by the launch, not built before it.

### B2 · Post and reply

A member (client or worker, either can start a thread) posts "I need someone for X" or "I do X, looking for work with Y." Any other member can reply. Two real uses this has to support:

1. **A client hiring** outside the structured job-post flow, for something looser than a single job (an ongoing relationship, a referral request).
2. **A worker pulling in another trade** to build a team (a plumber who needs a mason for one stage of a job), which the current marketplace has no mechanism for at all, since `job_quotes` is one client to many workers, never worker to worker.

A reply that carries a quote uses the same shape as `job_quotes`: scope and price, shown beside the replying member's track record (jobs completed, rating), never loose text with no proof attached. **Reuse the existing quote panel component from `specs/MARKETPLACE-SPEC.md` rather than building a second one.**

### B3 · Negotiation becomes the contract

Back-and-forth in the thread can revise scope and price. Once both sides agree, that agreed scope and price is what the evidence and sign-off system checks the finished work against, exactly as a normal job's Kickoff Pack does in `specs/PORTALS-BUILD-SPEC.md`. This is the mechanism that kills "that is not what we agreed" disputes, and it only works if agreeing inside a Members' Network thread **creates a real job row**, not a side conversation that the rest of the system cannot see.

Concretely: once both sides accept, the thread converts to a job (same `jobs` table, same lifecycle, same evidence spine, same guardrails) with an `origin: 'members_network'` tag for reporting only. **Nothing about payment, evidence, or sign-off is different for a Members' Network job once it converts.** The gate and the negotiation are the only new things; everything downstream is the existing system.

### B4 · Off-platform is a real risk, name it

Negotiation and payment stay in the system. A member can always take a conversation to a personal phone number, and nothing here can stop that. What this feature can do is make staying on-platform obviously worth it: the quote panel showing track record, the Guarantee, the evidence spine, and the review, none of which exist for a deal struck outside it. **Say this to the member once, plainly, at the point they post or reply, not as a legal disclaimer buried in guidelines they never read.**

### B5 · Fee

The fee structure is unchanged: 15 percent client Guarantee and Support fee plus 5 percent worker fee once a Members' Network thread converts to a job, the same as any other job, because it is the same job pipeline at that point. Do not invent a separate fee for this lane. If the founder later wants Members' Network jobs priced differently, that is a pricing decision for `Yaadly_Pricing_Review.md` and the ledger, not something to default into this build.

### B6 · Acceptance tests

- [ ] A member with zero completed jobs cannot post or reply; a member with one completed job can.
- [ ] A reply carrying a quote uses the existing quote panel component and policy, not a new one.
- [ ] An agreed thread creates a real row in `jobs` with the standard lifecycle, evidence spine, and guardrails, tagged `origin: 'members_network'`.
- [ ] The fee applied to a converted job matches the standard 15 plus 5 percent split, with no separate code path.
- [ ] The off-platform risk line is shown once at post or reply time, plainly, not as a footer disclaimer.
- [ ] Guardrail scan passes on every new copy string this section introduces.

---

## Do not

- Do not send a notification, alert, or WhatsApp message as a side effect of computing a shortlist. Storing a ranking is not alerting.
- Do not let the AI matching layer pick, invite, or book a worker. It ranks; a named person on the desk acts.
- Do not invent a confidence score with no fact behind it. A reason cites a real completed job, a real piece of evidence, or a real open calendar day.
- Do not lower the Members' Network completed-job gate to make the feature look populated before the pilot has real completed jobs.
- Do not build a second quote-and-track-record component for Members' Network replies when `specs/MARKETPLACE-SPEC.md`'s already exists.
- Do not give a Members' Network job a different fee, lifecycle, or guardrail path from any other job once it converts.
- Do not use the word escrow, or say that Yaadly holds anyone's money, anywhere in this feature's copy.
