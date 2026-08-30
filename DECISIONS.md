# Decisions log

One paragraph per architectural choice, and why. Newest at the top. Written so that in six months the reason is still here, not only the result.

Started 30 August 2026, backfilled from what is already built and from the Yaadly Technical Notes of 24 August 2026.

---

## 2026-08-30 · The portal answers on one hostname

`web/wrangler.jsonc` set a custom domain but left `workers_dev` and `preview_urls` at their defaults, which are both true. So the portal was reachable at `app.yaadly.co.uk` and also at `yaadly-app.<account>.workers.dev`, plus a per-version preview URL for every upload, all running the same code against the same Supabase project. Both are now explicitly false. Right now the cost of that was two unwatched addresses instead of one, and previews pointing at the production database. The reason it mattered enough to fix today is what happens next: Cloudflare Access attaches to a hostname, so once the operations console ships behind Zero Trust, a workers.dev URL walks straight past it. The Technical Notes list this as the most common way people believe they are protected and are not. Set in the committed config rather than the dashboard so it survives the next deploy.

## 2026-08-30 · The banned-language screen reaches the live reply path

The engine screened every line it emitted and the thing actually talking to clients did not. `yaad-inbound` composes the WhatsApp and SMS reply a client reads, strips forward-looking promises, strips dashes, and sent it. Nothing checked it for the words this company has standing rules never to use. A model explaining how payment works reaches for "escrow" as the obvious word, and it would have gone out under Yaadly's name.

Found by checking whether step 4 of the Technical Notes sequencing was worth doing. It is not, and this was.

`supabase/functions/_shared/guardrails.ts` is a direct port of `BANNED_TERMS` from `yaad/guardrails.py`. It goes in `twiml()`, which is the single place anything in that function reaches a person, so the fixed strings are screened alongside the model-written ones: it costs nothing and a careless edit to a fixed string cannot walk past the rule either.

On a hit the behaviour differs from the engine on purpose. The engine raises, which is right for a batch job and wrong here, because raising means somebody who messaged about their roof gets silence and silence is indistinguishable from the message vanishing. Instead the client gets a short holding reply, the draft goes to the function log, which is private to the project rather than to a third party, and a phone alert says a reply was held back. The alert carries the guidance strings only, never the draft, because ntfy is a public service and the draft is model prose about somebody's property. That is the governing rule doing what it is for: the machine refuses to send it and hands it to a person.

`yaad-completion` and `yaad-kickoff` now flag the same list rather than blocking it, because a human reads those before anything is issued. The human gate was already there; what was missing was telling them. `yaad-whatsapp-webhook` needed nothing: its replies are fixed templates and a deterministic status read-back, and its model call only fills a job card.

Ten Deno tests, wired into CI. Seven assert the screen, using the same five phrases the Python suite uses so a loosened pattern turns one of the two red. Three assert the gate is still wired into `yaad-inbound` and the two draft producers, because the realistic failure here is not a broken regex, it is somebody removing the call in good faith while tidying the reply path.

## 2026-08-30 · MiniMax stays for now, and the switch is triggered by real data

Amends the entry below, same day. The destination is settled and the plumbing is built; the timing is not now. Founder decision: keep running on MiniMax while the data flowing through these functions is synthetic. That is consistent with the Technical Notes, which said MiniMax is fine for the buildathon with synthetic data and that the move belongs before the pilot. The trigger is therefore not a date but a fact: **real client and worker data, which arrives with the December pilot in Kingston and Portmore.** On cost, for the record, because it was asked and answered rather than assumed: Mistral Large is about 1.7 times MiniMax per token, which at pilot volume is roughly one pound a month, so cost is not what is deciding this either way.

One thing changed in the code as a result. The MiniMax branch was written as a loud temporary fallback that logged a warning on every single call saying the migration was incomplete. Now that running on MiniMax is the deliberate current state rather than an unfinished job, that warning would fire thousands of times against a decision somebody already took, and an alarm people are trained to ignore has stopped being an alarm. It is gone. What remains is the honest signal: `yaadly.model.region` rides on every model span, silent when nobody is asking and conclusive when they are. The day the answer has to be `eu`, one query proves it.

## 2026-08-30 · The text model moves to the EU, and the provider stops being eight constants

Founder decision: move off MiniMax to an EU endpoint before the pilot carries real data, and Mistral is the endpoint. The reason is jurisdictional rather than technical. MiniMax is hosted in China, it was hard-coded into eight live Edge Functions as a pair of constants each, and everything a client typed and everything a worker said over WhatsApp passed through it. China has no UK adequacy decision, and Jamaica's Data Protection Act 2020 restricts transfers where the destination lacks adequate protection. Mistral because it is EU hosted, it speaks the OpenAI chat completions shape so the eight call sites barely changed, and it offers a signed DPA.

The shape matters as much as the destination. The provider now lives in `supabase/functions/_shared/textmodel.ts` and nowhere else, so it is a decision in one file rather than a property of eight, and a future move is a secret change rather than a deploy. Four `TEXT_MODEL_*` secrets override everything, which is the escape hatch that stops the next migration being another eight-file edit. CI enforces it two ways: the shared-copy check now loops over every file in `_shared` rather than naming `otel.ts`, and a new job fails the build if any function hard-codes a model endpoint again.

The MiniMax branch is still in the resolver, deliberately and temporarily, so that deploying this could not take the intake flow down before the Mistral secret exists. It is a noisy fallback rather than a quiet one: it logs a warning every time it runs, and `yaadly.model.region` travels on every model span so the question "is this still going to China" is answered from telemetry rather than from memory. `RUNBOOK.md` step 9 is the three-step completion, ending in deleting that branch. A fallback to China that nobody notices is exactly how a migration gets declared finished and is not.

## 2026-08-30 · The buildathon repo stays public until judging closes, then goes private

Founder decision. The organisers' requirement is public for judging, so this repository stays public and MIT licensed until judging closes, and is made private that day. Nothing to weigh any more, it is a dated action waiting on a date. Two things to hold on to when it happens. Making a public MIT repository private stops future access, it does not recall what is already out, and anything forked before the switch stays licensed forever, so the switch is worth making on the day rather than the month after. And the product work does not have to wait for it: anything that is not part of the submission can go into a private repository whenever it suits, with this one frozen as the buildathon reference. Recorded here rather than in a task list because it is the kind of item that gets discovered in December.

## 2026-08-30 · Identity documents are withheld from the model entirely

Supersedes the entry below it, same day. Founder decision: stop sending the government photo ID, the live selfie and the face video to NVIDIA, keep the machine read for everything else. Persona already does the identity step with real document-authenticity and liveness checks, so the second copy of a passport in a US model vendor's request logs was adding a transfer of the most sensitive thing on the file without adding a check anybody relied on. The consent gate made it lawful to ask for. It did not make it worth asking for. Implemented as `IDENTITY_DOCS` in `yaad-vetting-review`, tested before the mime check and before the download so the file is never fetched from the bucket on that path, with no override flag and no query parameter. The face-match pass went with it. Where Persona has passed, that comparison happened somewhere stronger; where Persona has not, the review now states in plain words that nobody has compared the two faces, which is a better outcome than a model guessing. Withheld documents stay on the skipped list with the reason, because a document that vanishes from the review reads as a document that does not exist, and the count goes to telemetry so it is provable after the fact rather than promised. Applicant-facing copy in `JoinFlow.tsx` updated and `AI_CONSENT_VERSION` bumped to `ai-review-v2`; v2 is strictly narrower than v1, so existing consents still cover what is done, but the sentence changed and a consent is tied to its sentence.

## 2026-08-30 · Identity documents go to a model, with consent, to one vendor

Recorded because the first draft of `CLAUDE.md` carried a flat rule that ID documents never reach a model API, which is not what is built and would have had a future session delete a working feature. What is actually built: `yaad-vetting-review` sends identity documents to NVIDIA's hosted vision model, one image per call, so the desk has a machine reading before a person opens the file. It never decides; there is no code path in it that approves or declines. It runs only when `ai_review_consent` is `granted`, NULL counts as declined, and the gate sits inside the review function rather than at the caller so the desk's re-run button cannot override the applicant's refusal. That is the right shape. The open item is not the consent gate, it is the destination: NVIDIA hosted means a transfer of identity documents to a third country, which is exactly the processing a DPIA has to cover and exactly the reason the OIC registration matters. Same class of question as the engine's model provider, and it should be answered at the same time.

## 2026-08-30 · One repository, not three

The Technical Notes recommend three repositories: a private Python engine, a private TypeScript product monorepo, and a public static landing page. Today this is one repository with the same separation inside it: `yaad/` and `tests/` are the engine, `web/` is the Next.js app, `supabase/` holds the Edge Functions and migrations, `docs/` is the static marketing site on GitHub Pages. The separations the notes were actually protecting are already in force. The marketing site has no build step and deploys independently, so a broken app build cannot take `yaadly.co.uk` down during a launch window, which was the main point. Splitting the repositories now would cost a week and buy visibility control, which is a separate decision (see below). Revisit if repository visibility forces it, or if a second engineer joins.

## 2026-08-30 · Repository visibility is unresolved and it is a deadline, not a preference

This repository is public and MIT licensed, as a submission to the Global Open-Source Agentic AI Buildathon. The codified operating logic of the business, the guardrails, the evidence gates, the benchmark structure, is therefore visible to anyone. What is held back is the right stuff: no payment integration, no real data, no cost research, no fee structure. But the architecture of the guardrails is part of the moat and it is on display. The thing that makes this urgent rather than tidy: making a public MIT repository private stops future access, it does not recall what is already out, and anything forked before the switch stays licensed. So the decision is worth less every week it is not made. The blocking question is for the buildathon organisers, not for anyone here: must the submission repository stay public, and for how long. Public for judging only means make it private the day judging closes. Public indefinitely as a prize condition means freeze this at the submission commit, develop in a private copy, and say so in the README. No requirement means private now. Monique's call.

## 2026-08-30 · The engine stays Python

The Technical Notes reversed an earlier suggestion to port the engine to TypeScript, and the reversal is right. The tests are the asset: they are what proves the AI never releases money, rules a dispute or moves a Yaad Score. A rewrite risks losing coverage exactly where coverage matters and gains nothing a judge, a client or an investor can see. Python is also the better home for what is on the roadmap, EXIF parsing and image checks on evidence photos, and the hiring pool for LLM orchestration and WhatsApp Business API work skews Python anyway. Treat a rewrite as a 2027 decision, to be made only if a TypeScript-first engineer joins and the split becomes a real burden, and then with the tests as the specification.

## 2026-08-30 · The engine stays stateless

Job Card in, structured result out. No database access, no auth, no session state. Everything stateful lives in Postgres. This is the boundary that makes a two-language codebase cheap instead of painful, and the agents were already written this way, so it costs nothing to hold. It is also what would let the engine be wrapped in a thin API and deployed separately later without disturbing the agents or the tests.

## 2026-08-30 · Pricing is a lookup and a model call must never be added to that path

Recorded here as well as in `CLAUDE.md` because it is the single most likely thing for a future agent to helpfully break. The founding premise is that a client in London pays what a client in Portmore pays. A hallucinated price band breaks exactly the thing the business exists to fix, so pricing reads from researched benchmarks in `yaad/benchmarks.py` and returns "no public price exists in Jamaica for this work" rather than a guess. That answer is correct and complete, not a gap. Widening coverage means adding a sourced benchmark row.

## 2026-08-30 · The worker web surface stays thin

The diaspora client is motivated, on a laptop, and will tolerate friction. The worker in Portmore is on a phone, mid-job, and will abandon anything that is not WhatsApp. So the worker portal exists for the two things WhatsApp does badly, structured onboarding with credentials and file upload, and for nothing else. Building a full worker dashboard for December would be wasted effort because it will not be opened. The consequence worth watching: if the worker journey is WhatsApp-first, ID documents land in Meta's infrastructure before they reach ours, which is why identity verification links out to a vendor flow rather than accepting documents over the chat.

## 2026-08-30 · Model provider is a configuration value, and the current one has to change before real data

The engine speaks the OpenAI chat completions API, so any compatible endpoint works from two environment variables. That was a day-one call made because the buildathon gateway key had not been issued when the build started, and it turns out to be worth much more than the convenience. MiniMax is a Chinese provider and is fine for the buildathon with synthetic data, which is what synthetic data is for. Once real job data flows, worker names, property addresses, job details, voice transcripts, that becomes a transfer of personal data to a third country, and two regimes bite: UK GDPR, which needs adequacy or appropriate safeguards and has neither straightforwardly available for China, and Jamaica's Data Protection Act 2020, which restricts transfers where the destination lacks adequate protection. For the pilot, move to a provider with a UK or EU region and a signed DPA. Because of the day-one design that is a config change, not a rewrite.

## 2026-08-30 · Data protection registration is the item most likely to stop the launch

Not a technical decision, recorded here because it constrains the technical ones. Jamaica's Office of the Information Commissioner requires registration before processing personal data about people in Jamaica, and the workers put a UK company in scope regardless of where it is incorporated. Operating unregistered is a criminal offence; enforcement has not been switched on, which is a grace period rather than an exemption. Separately, UK GDPR requires a DPIA for high-risk processing, and collecting ID documents about individuals across two jurisdictions is high risk by any reading. Neither is difficult, both take longer than expected, and both tend to be discovered in November. This also needs a qualified solicitor in both jurisdictions before any real payment is taken. Timing is Monique's.

## 2026-08-30 · Guardrails live in code and in tests, not in prompts

`yaad/guardrails.py` screens outbound text for banned language and refuses any money or reputation action that does not carry a named human decider. The tests prove it. The reason this is in code rather than in a system prompt is that a model can be talked past a prompt and cannot be talked past a raise. The layer still missing is the third one the Technical Notes recommend: a database-level constraint that refuses a payment release without a named human recorded. Application code is what an agent writes; a database rule is set up once and then left alone, and it holds even when the code above it is wrong. Worth adding before any payment path exists, which means before the December pilot takes money.

## 2026-08-26 · DNS on Cloudflare, app and site on separate hostnames

The `yaadly.co.uk` zone went active on Cloudflare on 26 August 2026. The marketing site serves from GitHub Pages at the apex, and the Next.js app deploys as a Cloudflare Worker at `app.yaadly.co.uk` via OpenNext. Two hostnames, two deployment paths, one of which has no build step. When the operations console arrives it gets its own hostname for the same reason plus one more: a separate hostname is what allows Cloudflare Zero Trust to sit in front of it, and the console holds ID documents and payment controls. That subdomain must be proxied, orange cloud rather than grey. A DNS-only record routes traffic straight past Cloudflare and Zero Trust does nothing at all, which is the most common way people believe they are protected and are not.

## The client funnel lives in the app, and takes no account (Stage 2, 30 Aug 2026)

Stage 1 deleted the post-a-job funnel from `docs/index.html` so the marketing site could be short. The plan said to leave the old path working until the app funnel existed. It did not: the app's `/jobs` is a BOARD, a list of other people's jobs, and nothing in `web/` ever created one. So for a window there was no way to post a job anywhere, and the app's own "Post a job" button pointed at `yaadly.co.uk/#post`, which redirected to the board. A client went in a circle.

`web/app/jobs/new` is the funnel, and it is now the only place a job is created.

**No account, and no password on the page.** Founder decision, 30 August: no account to get quotes, an account once a job is booked. The account is worth something at booking, where it approves evidence, holds the invoice and carries the property record between jobs. In front of a quote it is a toll gate on the way in.

**Two backends, both already hardened, neither changed.** The work goes to `yaad-post-job` in draft mode, which writes a job at `stage 0, open false` and deliberately stores no personal data. The contact details go to `yaad-enquiry`, which has the per-recipient throttle, the receipt tracking and an honest answer for somebody who gave a phone number rather than an email. The enquiry carries the job reference so the desk reads them as one thing. No new table.

**Three behaviours carried over on purpose**, because a rewrite is the easiest place to lose them: the job saves as a draft before a single personal detail is asked; the contact field still says "Hidden from workers until you start a chat with one. You control when it's shared."; and the reply promise is one working day.

**The end state names what happens next.** "Your job is saved" tells somebody who has just described water running down their mother's bedroom wall nothing at all. It now says a person reads it within one working day, then an itemised quote with labour split from materials, then a written scope, then evidence at every stage with nobody paid for a stage until it is approved, and that no account is needed until they book.

`TRADES` and `PARISHES` moved to `web/lib/taxonomy.ts`. They were declared inside `JoinFlow.tsx` and the funnel needs the same two lists. Two copies drift, and the day they drift a client posts a job in a trade no worker profile can carry.

## Quotes without an account, and the booking that needs one (Stage 2.2, 31 Aug 2026)

The decision was "no account to get quotes, an account once a job is booked." Half of it was not true: `job_quotes` was only ever rendered inside the portal, which is behind auth, so a client had to make an account before seeing a single price.

**Looking is open, choosing is not.** `quotes_for_code` and `job_for_code` are security-definer functions taking the job id and its `portal_code`, which is the bearer token the WhatsApp link and the portal claim already ride on. They return what a client needs in order to choose and nothing else: no client contact details, no address. `/jobs/[id]/quotes?code=` renders them for an anonymous visitor, labour split from materials, materials marked at cost.

**Accepting is the booking, and the booking is where the account appears.** `accept_quote_as_me` is authenticated only and refuses any caller who is not that job's `client_email`. So holding the link is enough to look at prices and never enough to book one. Pressing Book with no account routes to `/portal/join` carrying the job, the code and the chosen quote; the account is made there and the quote is accepted on the way back.

**A job that already has a worker is not re-bookable through it.** Changing a worker mid-job is a desk decision with a conversation behind it, not a button.

**Found while testing:** `revoke all ... from public` did not take execute away from `anon`, because `anon` is a role with its own grant rather than a member of PUBLIC for this purpose. `accept_quote_as_me` was therefore callable by anonymous visitors. The body already refused them, having no email in the JWT, so nothing could be booked, but a booking function anonymous callers may call is one bug away from one they may use. `anon` is now revoked by name.

**Not built:** nothing tells the client a quote has landed. The page is honest when empty and the link keeps working, but the client has to come back and look. Notifying them is its own piece of work and needs the WhatsApp credentials that are still unset.
