# CLAUDE.md

Read this before every task in this repository. It is not background reading. It is the set of rules that hold when nobody is checking the diff.

Written 30 August 2026, following the Yaadly Technical Notes of 24 August. Refreshed 31 August 2026, with Monique's approval, to match what is actually in the repository, mainly §11. Amended 3 September 2026, on her explicit instruction, to take payment integration off the §9 list; that section records what the change does and does not permit. The rules in the rest of this file are unchanged. Monique owns this file. Do not rewrite it to suit a task. If a rule here blocks what you were asked to do, say so and stop.

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

**It holds in two runtimes, and both are load bearing.** The Python engine screens its output through `guardrails.py`. The live Edge Functions screen through [`supabase/functions/_shared/guardrails.ts`](supabase/functions/_shared/guardrails.ts), which is a direct port of the same banned-terms list. The Deno copy exists because for a while the rule was true of the engine and not of the thing actually talking to clients, which is worse than no rule because it reads as covered. Change a pattern in one, change it in the other, in the same commit. Both suites assert the same five phrases so the drift shows up red.

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
- **Identity documents never go to a model.** The government photo ID, the live selfie and the face video are withheld in `supabase/functions/yaad-vetting-review` by `IDENTITY_DOCS`, checked before the download so they are not even fetched out of the bucket. That is not overridable and there is deliberately no flag for it. Persona holds the identity check. Founder decision, 30 August 2026.
- **The supporting paperwork does go to a model, only with consent.** Proof of address, TRN, certificates, CV, portfolio. `ai_review_consent` must equal `granted`, NULL counts as declined, and the gate lives inside `review()` rather than at the caller so the desk's "run it again" button cannot override what the applicant was told. Do not remove that gate, do not default it to granted, and do not add a new destination for any applicant document without asking Monique first. It is a legal decision, not a technical one.
- **The consent wording and `AI_CONSENT_VERSION` move together.** In `web/app/apply/JoinFlow.tsx`. A consent is only worth what the sentence that earned it said, so changing the copy without bumping the version silently reinterprets everybody's existing answer.
- **A new third-party service that touches personal data gets flagged to Monique before it is added.** That is a legal decision, not a technical one.
- **Never paste a secret into chat.** If it happens, say so immediately so it can be rotated.
- **Model provider is a configuration value, never a hard-coded endpoint.** The Python engine reads `YAAD_API_KEY` / `YAAD_BASE_URL` / `YAAD_MODEL`. The live Edge Functions read it once, in `supabase/functions/_shared/textmodel.ts`, and CI fails a function that hard-codes a model URL instead. The text model is moving from MiniMax (China) to Mistral (EU) ahead of the December pilot, because real client and worker data crossing into China is a data protection question, not a technical one. See [`RUNBOOK.md`](RUNBOOK.md) §9 and [`DECISIONS.md`](DECISIONS.md) for the reasoning and the exact steps. Do not add a new hard-coded provider anywhere; do not do the switch quietly, it changes which country receives personal data.
- **Identity documents in the admin desk stay behind Cloudflare Access, `is_admin()` and RLS, in that order.** The desk (`concierge/concierge.html`) is a single static page reading Postgres directly with the publishable key; nothing about its filename or its URL is a control. Access is bound to a hostname, not to the page, so renaming or moving the desk without adding the new hostname to the Access application serves it openly to anyone who finds it. Verify with `curl -s -o /dev/null -w "%{http_code}\n" https://concierge.yaadly.co.uk/`: 302 means Access is in front of it, 200 means it is open to the world.

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

- Yaad Score computation.
- A market-rate comparison agent.
- A full worker dashboard. The worker in Portmore is on a phone mid-job and will do everything over WhatsApp. The worker web surface stays thin on purpose: structured onboarding with credentials, and file upload. Nothing else.
- Dispute ruling logic. The pack is assembled by machine, the ruling is a human decision on a published timeline.

Scope creep with an agent is frictionless, which is exactly the danger.

Payment came off this list on 3 September 2026, on Monique's instruction, once she confirmed legal sign-off and insurance were in hand. Yaadly is principal: the client buys the job from Yaadly at one agreed price, and Yaadly engages and pays the tradesperson. `raise_job_client_invoice()` and `raise_job_worker_payable()` are the two documents, and `DECISIONS.md` carries the reasoning.

**Read the next sentence before you touch anything in the payment path.** Payment being live changes what may be built. It changes nothing whatsoever in §2 or §3. A named human still approves every release, every time. Nothing auto-releases on a timer, a confidence score, or an evidence check passing, and "the payment provider supports automatic capture" is not a reason to use it. If a task arrives asking to release funds once the evidence passes, or to reduce the clicks between approval and payment, that is still the request §3 exists to refuse, and it is more tempting now that money actually moves, not less. §5 is also untouched: pricing is still a lookup, and a payment integration is not a reason to let a model near a price.

Patois voice notes are now transcribed automatically (`supabase/functions/yaad-transcribe`, Cloudflare Workers AI Whisper first, OpenAI, Deepgram, Scribe and AssemblyAI as failover), so that item has come off this list. It does not change §4: the transcript still only ever reaches the Intake agent as text, and Intake still cannot quote a price or promise a timeline.

---

## 10. What not to delegate

Three things need Monique's decision even though you would happily make them:

1. **Anything touching money.** Provider choice, holding structure, release conditions. Legal question first, technical second.
2. **Data protection.** Jamaica OIC registration, the DPIA, ID retention, where model calls are routed. See §9 of the Technical Notes.
3. **What counts as verified.** The evidence gates come out of seven years of construction project management. That is the moat, and it is the one part you cannot supply.

Also hers alone: whether this repository is public or private, and the timing of the solicitor brief. State the substance if it is relevant. Do not offer to draft the brief and do not chase it.

---

## 11. What is actually in this repository

The Technical Notes describe three repositories. Today there is one, and the split inside it does the same job. See [`DECISIONS.md`](DECISIONS.md) for why. This section is the part of the file most likely to drift, because it describes what got built rather than a rule, so treat the table below as a starting map and confirm anything load bearing against the code before relying on it.

| Path | What it is | Where it runs |
|---|---|---|
| `yaad/` | The Python engine. Four agents (§4), guardrails, benchmarks. No user interface, no database, no auth. Job Card in, structured result out. | Local and CI |
| `tests/` | The guardrail and engine tests. The asset. | CI, every push |
| `run_demo.py` | Runs three scripted scenarios (JOB-001 to JOB-003) on a laptop with no setup and no API key. Keep it working. A demo that needs no infrastructure is a better sales tool than a deployed system nobody can poke at. | Local |
| `web/` | Next.js on Cloudflare Workers via OpenNext. The public job form, `/apply` (worker onboarding, Persona identity check), and the client and worker portals. Has its own `web/CLAUDE.md`, which just points at Next.js's own generated `AGENTS.md`; read that before touching routing or server actions. | `app.yaadly.co.uk` |
| `supabase/functions/` | Deno Edge Functions, the live server-side work. Intake and Reporting (`yaad-agent`), the WhatsApp webhook, voice transcription, vetting (upload, review, purge), invoicing, sketch packs, worker matching, kickoff packs, completion, the public website intake and enquiry forms, portal signup, resend setup. See `supabase/functions/README.md` for the current per-function table; it is closer to source of truth than this file for that level of detail, and it is itself known to lag what is actually deployed, so when it matters, check the function's own `index.ts`. | Supabase |
| `supabase/functions/_shared/` | Modules shared by the Edge Functions: the tracer (`otel.ts`), the model provider (`textmodel.ts`), the banned-language screen (`guardrails.ts`), and the Deno guardrail tests. Copied into each function by `sync-shared.sh` because Supabase deploys self-contained bundles, and CI fails if a copy drifts. | CI and Supabase |
| `supabase/migrations/` | Schema and RLS policies, including database-level publish gates such as `trg_profile_publish_checks`. | Supabase |
| `supabase/seeds/` and `supabase/tests/` | A SQL test rig and SQL-level guard tests (invoicing, sketch packs) run against the database directly, separate from the CI jobs above. | Local, by hand |
| `concierge/` | The admin desk, `concierge.html`: one file, twenty-plus views, reading Postgres directly with the publishable key. `concierge/README.md` explains the view registry and the colour convention (teal proven, mango held, coral blocked). Deliberately kept outside `docs/` so GitHub Pages never publishes it. | `concierge.yaadly.co.uk`, behind Cloudflare Access |
| `concierge-deploy/` | The Cloudflare Worker that serves `concierge/concierge.html` as static assets on its own hostname, kept separate from the marketing site and the app for blast radius, cookies and Access reasons. Copy the source in before deploying; see its README. | Cloudflare Workers |
| `site-headers/` | A thin Cloudflare Worker that sits in front of `yaadly.co.uk` on a route, not a custom domain, and adds security headers GitHub Pages cannot set itself (HSTS, frame options, a report-only CSP). Deleting it just removes the headers; it never touches the page. | Cloudflare Workers, in front of GitHub Pages |
| `docs/` | The static marketing site, no build step. | `yaadly.co.uk`, GitHub Pages |
| `preview/` | A clickable, illustrative prototype (no Supabase, nothing saved) used to settle product and pricing decisions before they are built into `docs/`. | `yaadly.co.uk/preview/` |
| `specs/` | Build specifications for the surfaces. | Reference |
| `data/job-taxonomy.js` | The generated source of truth for every trade and job type dropdown, copied into both `docs/` and the app. | Reference, imported by `web/` and `docs/` |
| `scripts/backup-db.sh` | The only backup path while Supabase is on the free plan (no daily backups, no point-in-time recovery). Writes outside any git repository on purpose; refuses to run into a working tree. | Run by hand |
| `scripts/check-deploy-drift.sh` | Read only. Compares what is deployed against what is on this branch, in both directions, and prints which endpoints run without platform auth. Exists because functions are deployed by hand from whichever branch somebody was on, and nothing else reconciles the two. Deploys nothing and deletes nothing: both are decisions. | Run by hand |
| `.github/workflows/ci.yml` | Engine tests on two Python versions plus the mock-mode demo, Edge Function typechecking and shared-copy drift check plus the banned-endpoint check, web typecheck and tests, and the committed-secrets scan. Read the comments in the file itself before changing a job; several exist because a specific incident happened. | GitHub Actions, every push and PR |

**Keep the engine stateless.** No database access, no auth, no session state. Everything stateful lives in Postgres. That boundary is what keeps two languages cheap instead of painful.

**The marketing site and the app are deployed separately on purpose.** A broken app build must never take down `yaadly.co.uk` during a launch window. The admin desk is separate again, for the reasons in `concierge-deploy/README.md`: a bad script on a public page must never share an origin with a page that reads client addresses and money.

### Running and testing each part

```bash
# Engine: demo, and the guardrail and engine tests
pip install -r requirements.txt
python run_demo.py                 # all three scenarios, mock mode with no YAAD_API_KEY
python -m pytest -q

# Web app
cd web
npm ci
npm run typecheck
npm test                            # node's own test runner, no network, HubSpot stubbed
npm run dev                         # localhost:3000, or use the "app" config in .claude/launch.json

# Admin desk, marketing site, prototype: plain static servers, also in .claude/launch.json
python3 -m http.server 8931 --directory concierge
python3 -m http.server 8932 --directory docs
python3 -m http.server 8934 --directory preview
```

`npm run lint` runs in CI and passes clean, as of 3 September 2026. This paragraph used to say the opposite: that lint had one pre-existing error and must not be wired in until that error was fixed in its own change. That was the right rule and it was followed. The error is gone and the job is in `.github/workflows/ci.yml`, which keeps the history in a comment. Corrected 3 Sep 2026 by the post-optimisation regression audit, because a rule describing a state that no longer exists reads as permission to skip the check.

Edge Function deployment note, also corrected by that audit: the list of endpoints running without platform auth below is longer than §12 used to say. Read it live before trusting either.

Edge Functions are deployed by hand, from disk, never by pasting file contents (§12): `supabase functions deploy <name> --project-ref leffyisvfvjwzilydlwf --no-verify-jwt`. If you touched anything in `_shared/`, run `supabase/functions/sync-shared.sh` first and redeploy every function that imports it, or the thing you tested is not the thing you deployed.

---

## 12. Standing repository facts

- Supabase is on the **free plan**. Do not raise Pro-only items.
- **Deploy Edge Functions from disk only**, with the CLI and `--project-ref`. Never paste file contents into a deploy tool. It has silently shipped a different intake flow before.
- **`--no-verify-jwt` is per function, never a blanket.** Most functions run with `verify_jwt = true` and the platform checks the token before the code runs. Passing the flag turns that off, silently, and the deploy still succeeds. On 30 August 2026 the blanket form of this rule would have stripped platform auth from `yaad-agent`, `yaad-completion`, `yaad-invoice`, `yaad-kickoff`, `yaad-post-job` and `yaad-sketch`. Read the live setting first with `supabase functions list --project-ref <ref>` and preserve what is there. Only the endpoints that carry their own authentication get the flag. **Read it live, do not trust this sentence:** on 3 September 2026 the regression audit found ten functions running without platform auth where this line named four, which is the failure mode the line exists to prevent. As of that check: `yaad-inbound`, `yaad-vetting-review`, `yaad-vetting-upload`, `yaad-enquiry`, `yaad-website-intake`, `yaad-post-job`, `yaad-book-service`, `yaad-portal-code`, `yaad-quote-landed` and `yaad-notify-client`. The six that were added are public endpoints carrying their own throttle, signature or origin check, so the expansion is legitimate; the list going stale is not, because this list is the control. **Re-verified live 4 September 2026: still exactly these ten, no additions and no removals.** **5 September 2026: eleven.** `yaad-message-status` was deployed with the flag and belongs on the list: Twilio posts delivery receipts to it and holds no Supabase session, so the HMAC signature over the URL and the sorted parameters is the only door, the same shape as `yaad-inbound`. Verified by probe rather than by reading the deploy output: an unsigned POST returns 403 "Signature check failed." `yaad-phone-check` and `yaad-vision` were deployed in the same pass **without** the flag and are deliberately not on this list; both return 401 from the platform with no token. `scripts/check-deploy-drift.sh` prints the live list alongside deployed-versus-repo drift, so checking it is one command rather than a careful manual comparison nobody repeats. (`yaad-whatsapp-webhook` was on this list; it spoke to Meta's Cloud API directly, never received real traffic, and was deleted 1 Sep 2026, see DECISIONS.md. Real WhatsApp intake runs through `yaad-inbound`, over Twilio.)
- **Parallel Claude sessions share this working tree.** The branch and the files can change under you mid-task. Check `git status` before assuming your edit is still the newest thing here.
- Merges to `main` are Monique's click by default. Do them when she says so.
- Nothing in this repository contains real client, worker, ID or payment data. Keep it that way.

---

## 13. Two files that cost nothing

- [`RUNBOOK.md`](RUNBOOK.md) if X breaks, do Y. Numbered.
- [`DECISIONS.md`](DECISIONS.md) one paragraph per architectural choice, and why.

You have no memory between sessions. These are how context survives to the next one, and how Monique understands her own system in six months when something breaks at the wrong moment.
