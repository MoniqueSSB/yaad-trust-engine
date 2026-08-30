# Decisions log

One paragraph per architectural choice, and why. Newest at the top. Written so that in six months the reason is still here, not only the result.

Started 30 August 2026, backfilled from what is already built and from the Yaadly Technical Notes of 24 August 2026.

---

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
