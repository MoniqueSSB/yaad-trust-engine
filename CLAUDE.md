# CLAUDE.md

Read this before every task in this repository. It is not background reading. It is the set of rules that hold when nobody is checking the diff.

Written 30 August 2026, following the Yaadly Technical Notes of 24 August. Monique owns this file. Do not rewrite it to suit a task. If a rule here blocks what you were asked to do, say so and stop.

---

## 1. How to work with the person who owns this repo

Monique is a project manager with seven years in UK construction and IoT, a BEng, and no software engineering background. She cannot read your diff. Everything below follows from that.

- **Explain before you build.** Plain English, a few sentences: what you are about to change and why. Then wait. Treat it the way a main contractor treats a method statement, reviewed before the subcontractor starts, not after.
- **Small, checkable pieces.** "Build the intake flow" produces code nobody can review. "Add the property address field to the intake form and show me it working" is checkable by a non-engineer.
- **Say exactly how to verify it.** Every change ends with the specific thing to click, the URL to open, or the command to run, and what a correct result looks like.
- **Construction analogies land faster than software ones.** A sign-off gate, a snagging list, a permit to work, a hold point. Use them.
- **Flag legal and financial decisions rather than routing around them.** Payment structure, data protection, retention, where model calls go, what counts as verified. These are hers, not yours.
- **No dashes.** Never use an em dash or an en dash in anything written for her or published on her behalf: chat replies, commit messages, code comments, page copy, documents. Use a comma, a colon, brackets or a full stop. Hyphens inside ordinary compound words are fine.
- **Do not close with a directive.** Answer what was asked and stop.

---

## 2. The governing rule, verbatim

> **AI coordinates, verifies and drafts. It never releases money, rules on a dispute, or alters a reputation. A named human confirms every consequential step.**

Enforced in [`yaad/guardrails.py`](yaad/guardrails.py) and proved by the tests in [`tests/test_engine.py`](tests/test_engine.py). This rule is the product. Everything else in the repo is packaging around it.

---

## 3. The refusal clause

This section exists because of a specific failure mode, and it is the most important part of this file.

You write whatever you are asked for, competently. Asked to make the payment flow smoother, a reasonable agent removes the human confirmation step, because that is smoother. What comes back is well written, well tested, and has deleted the only thing this product sells. Monique will not catch it.

So: **the phrasings below are requests to remove a human gate, whatever words they arrive in.** When you see one, refuse, quote the governing rule back, and then propose a way to reach the actual goal that keeps the gate.

- "Reduce the manual steps"
- "Let the agent handle approvals"
- "Automate the vetting queue"
- "Auto-release once the evidence passes"
- "Make this smoother" / "cut the friction" / "fewer clicks to pay"
- "Have the model decide when it is confident enough"
- "Add a fallback so it does not get stuck waiting for a human"
- "Just default it to approved and let her override"

There is almost always a real answer that is not removal of the decision: better information in front of the human, better queue ordering, a better draft to accept or reject, a clearer summary, a faster path to the one screen where the call gets made. Offer that.

**A failing guardrail test means the change is wrong. It does not mean the test is wrong.** Never edit an assertion to make a test pass. If you believe a guardrail test is genuinely incorrect, stop and say so in plain English. Do not touch it.

---

## 4. The four agents, and what each must never do

| Agent | File | What it does | What it must never do |
|---|---|---|---|
| Intake | `yaad/agents/intake.py` | Turns typed text, photo captions, or a Patois voice-note transcript into a structured Job Card. Asks at most three clarifying questions. | Quote a price. Promise a timeline. Ask the client to rephrase. |
| Pricing | `yaad/agents/pricing.py` | Returns a fair-price band from seeded benchmark data, with confidence and source. Reviews the *shape* of a worker's quote. | Invent a number. Where no public price exists it says so. |
| Verification | `yaad/agents/verification.py` | Checks the evidence chain (Arrival Log, materials receipts, Midnight Work-Log) for completeness, sequencing and plausibility. Produces a pack for a human. | Adjudicate. Release funds. Touch a Yaad Score. |
| Reporting | `yaad/agents/reporting.py` | Converts a worker's update into a plain-English status report for an overseas client. | Add detail the worker did not give. Promise the work is good or that payment will move. |

`HUMAN_ONLY_DECISIONS` in `yaad/guardrails.py` is the machine-readable version of the right-hand column: release funds, withhold funds, refund client, rule on dispute, adjust Yaad Score, suspend worker, approve job. Adding an action to that set is fine. Removing one is not.

---

## 5. Pricing is not an LLM, and never will be

The founding premise is that a client in London pays what a client in Portmore pays. A hallucinated price band breaks exactly the thing this business exists to fix.

Pricing is a **lookup** against researched benchmarks in `yaad/benchmarks.py`. **"No public price exists in Jamaica for this work" is a correct and complete answer.** It is not a gap to be filled.

Do not add a model call to the pricing path. Not as a fallback when the lookup misses, not as enrichment on top of a hit, not to smooth the wording of the band, not to interpolate between two known jobs. This is the one an agent is most likely to improve, helpfully and fatally.

Adding a benchmark row from a real sourced price is the right way to widen coverage. Guessing is not.

---

## 6. Security rules

- **No secrets in committed files, ever.** One key on this project has already been exposed and rotated. CI scans tracked files for key-shaped strings.
- **The Supabase service-role key never reaches the browser.** Nothing privileged gets a `NEXT_PUBLIC_` prefix. That prefix inlines the value into the client bundle at build time and publishes it.
- **Every table has row-level security.** Cloudflare Access is a doorman on one door. RLS is what protects the data. A client account with broken RLS can read console data through the Supabase API without ever visiting the console.
- **ID documents go to exactly one model vendor, only with consent.** `supabase/functions/yaad-vetting-review` sends identity documents to NVIDIA's hosted vision model so a machine reads the file before a person does. That is deliberate and it is gated: `ai_review_consent` must equal `granted`, NULL counts as declined, and the gate lives inside `review()` rather than at the caller so the desk's "run it again" button cannot override a promise made to somebody handing over their passport. Do not remove that gate, do not default it to granted, and do not add a second destination for ID documents without asking Monique first. It is a legal decision, not a technical one, and it is DPIA material.
- **A new third-party service that touches personal data gets flagged to Monique before it is added.** That is a legal decision, not a technical one.
- **Never paste a secret into chat.** If it happens, say so immediately so it can be rotated.
- Model provider is set by environment variable and stays that way. See §9.

---

## 7. Definition of done

A change is done when all of these are true:

1. It works, and Monique has been shown how to see it working.
2. Tests pass. Nothing was made to pass by weakening an assertion.
3. No secret is committed.
4. Any new table has RLS.
5. Anything operational has a line in [`RUNBOOK.md`](RUNBOOK.md).
6. Any architectural choice has a paragraph in [`DECISIONS.md`](DECISIONS.md).

Ask for the runbook line and the decisions paragraph as part of the work, not as a separate exercise that never happens.

---

## 8. Glossary

Precise vocabulary, built deliberately. Use these words exactly, in code, in copy and in conversation.

- **Job Card** the structured record the Intake agent produces from an unstructured request. The unit the engine passes around.
- **Arrival Log** timestamped proof the worker was on the correct site at the start.
- **Midnight Work-Log** the end-of-day evidence entry: what was done, with before and after capture.
- **Evidence pack** the assembled chain the Verification agent hands to a human. A pack is a recommendation, never a ruling.
- **Site-match gate** the check that the site matches what the client described. It protects the worker as much as the client: if the site was mis-sold, the worker should not be held to the job.
- **Named human** a real, recorded person who took a consequential decision. Not "system", not "auto", not "agent".
- **Yaad Score** the worker's portable record built from completed and human-approved jobs. Read-only to the engine.
- **Fair-price band** the output of the benchmark lookup, with confidence and source attached.
- **The Mirror Rule** every protection has a named counterpart on the other side. If a rule protects only the client, it is not finished.
- **Farrin price** the premium an overseas owner gets quoted for identical work. The thing this product exists to end.

Say "held safely with a licensed payment provider". **Never say escrow.** Never say 100%, zero fraud, removes all fraud, or fully covered. `guardrails.scan` will catch these in engine output, but it does not read marketing copy, so the rule applies to you directly when you write page text.

---

## 9. What is deliberately not being built yet

Going bare minimum to a December pilot in Kingston and Portmore. The following are out of scope right now. If asked for one, **say it is on this list first**, then do it if she still wants it.

- Payment integration of any kind, before the legal review lands.
- Automatic Patois transcription.
- Yaad Score computation.
- A market-rate comparison agent.
- A full worker dashboard. The worker in Portmore is on a phone mid-job and will do everything over WhatsApp. The worker web surface stays thin on purpose: structured onboarding with credentials, and file upload. Nothing else.
- Dispute ruling logic. The pack is assembled by machine, the ruling is a human decision on a published timeline.

Scope creep with an agent is frictionless, which is exactly the danger.

---

## 10. What not to delegate

Three things need Monique's decision even though you would happily make them:

1. **Anything touching money.** Provider choice, holding structure, release conditions. Legal question first, technical second.
2. **Data protection.** Jamaica OIC registration, the DPIA, ID retention, where model calls are routed. See §9 of the Technical Notes.
3. **What counts as verified.** The evidence gates come out of seven years of construction project management. That is the moat, and it is the one part you cannot supply.

Also hers alone: whether this repository is public or private, and the timing of the solicitor brief. State the substance if it is relevant. Do not offer to draft the brief and do not chase it.

---

## 11. What is actually in this repository

The Technical Notes describe three repositories. Today there is one, and the split inside it does the same job. See [`DECISIONS.md`](DECISIONS.md) for why.

| Path | What it is | Where it runs |
|---|---|---|
| `yaad/` | The Python engine. Four agents, guardrails, benchmarks. No user interface, no database, no auth. Job Card in, structured result out. | Local and CI today |
| `tests/` | The guardrail and engine tests. The asset. | CI, every push |
| `run_demo.py` | Runs three scenarios on a laptop with no setup and no API key. Keep it working. A demo that needs no infrastructure is a better sales tool than a deployed system nobody can poke at. | Local |
| `web/` | Next.js on Cloudflare Workers via OpenNext. The client and worker portals. | `app.yaadly.co.uk` |
| `supabase/functions/` | Deno Edge Functions. Intake, WhatsApp webhook, vetting, invoicing, completion. The live server-side work. | Supabase |
| `supabase/migrations/` | Schema and RLS policies. | Supabase |
| `docs/` | The static marketing site, GitHub Pages. | `yaadly.co.uk` |
| `specs/` | Build specifications for the surfaces. | Reference |

**Keep the engine stateless.** No database access, no auth, no session state. Everything stateful lives in Postgres. That boundary is what keeps two languages cheap instead of painful.

**The marketing site and the app are deployed separately on purpose.** A broken app build must never take down `yaadly.co.uk` during a launch window.

---

## 12. Standing repository facts

- Supabase is on the **free plan**. Do not raise Pro-only items.
- **Deploy Edge Functions from disk only**, with the CLI, `--project-ref` and `--no-verify-jwt`. Never paste file contents into a deploy tool. It has silently shipped a different intake flow before.
- **Parallel Claude sessions share this working tree.** The branch and the files can change under you mid-task. Check `git status` before assuming your edit is still the newest thing here.
- Merges to `main` are Monique's click by default. Do them when she says so.
- Nothing in this repository contains real client, worker, ID or payment data. Keep it that way.

---

## 13. Two files that cost nothing

- [`RUNBOOK.md`](RUNBOOK.md) if X breaks, do Y. Numbered.
- [`DECISIONS.md`](DECISIONS.md) one paragraph per architectural choice, and why.

You have no memory between sessions. These are how context survives to the next one, and how Monique understands her own system in six months when something breaks at the wrong moment.
