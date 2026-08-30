# Yaadly repo architecture

*Written 30 August 2026, from the founder's proposed tree plus what is actually
in the repo today. Read the legend before the tree: half of this exists and half
does not, and the difference matters more than the shape.*

**Legend.** `LIVE` is in the repo and working now. `NEW` does not exist.
`MOVED` exists somewhere else today and would have to be relocated.

**Status, founder decisions of 30 August 2026.** This tree is the TARGET, not a
migration to start now. The edge functions **stay on Supabase**; Next.js calls
them. The Python engine runs as a **Cloudflare Python Worker**, which is what
`packages/engine-client` calls. Everything below stays where it is until a stage
needs it, with one exception: **`apps/console` is a new build and is not blocked
by any of this.**

---

## The corrected tree

```
yaadly/
├── apps/
│   ├── web/                        yaadly.co.uk + app.yaadly.co.uk
│   │   ├── public/                 the static marketing site        MOVED from docs/
│   │   │   index · marketplace · services · business · payments · faq
│   │   └── app/
│   │       ├── (auth)/             signup, login, verify            NEW
│   │       ├── (client)/           diaspora portal                  LIVE as app/portal
│   │       ├── (worker)/           vendor portal, deliberately thin LIVE as app/apply
│   │       ├── jobs/ trades/ ask/  the board                        LIVE
│   │       └── api/hubspot/                                         LIVE
│   │
│   └── console/                    yard.yaadly.co.uk, Zero Trust    NEW, nothing exists
│       └── app/
│           ├── inbox/              play audio, tag status
│           ├── jobs/               triage, evidence pack, timeline
│           ├── workers/            vetting queue, credentials, suspend
│           ├── payments/           release, refunds, reconciliation
│           ├── disputes/
│           ├── benchmarks/         the compounding quote log
│           ├── documents/          templates and generated drafts
│           └── audit/              who did what, who viewed what
│
├── packages/                                                        NEW, none exist
│   ├── db/                         Supabase client and generated types
│   ├── domain/                     job states, money rules, deterministic and tested
│   └── engine-client/              typed caller for the Python engine
│
├── engine/                         the Python agents                MOVED from yaad/
│   agents/ intake · pricing · reporting · verification
│   benchmarks · guardrails · llm · scenarios · telemetry
│
└── supabase/
    ├── functions/                  THE BACKEND. 21 of them.         LIVE
    │   Flat on purpose, see the constraint below.
    │
    │   intake      yaad-whatsapp-webhook · yaad-inbound · yaad-transcribe
    │               yaad-website-intake · yaad-post-job · yaad-enquiry
    │   vetting     yaad-vetting-upload · yaad-vetting-review · yaad-vetting-purge
    │   money       yaad-invoice · yaad-completion
    │   matching    yaad-match · yaad-kickoff · yaad-portal-signup
    │   ai          yaad-agent · yaad-vision · yaad-sketch
    │   ops         yaad-resend-setup
    │   _shared     otel.ts, copied into each function by sync-shared.sh
    │
    └── migrations/                 schema and RLS policies          LIVE
```

---

## What was missing from the proposed tree, and why it matters

### 1. The 21 edge functions had nowhere to live

The proposal showed only `supabase/migrations/`. But `supabase/functions/` **is
the backend**: WhatsApp intake, transcription, vetting, Persona confirmation,
invoicing, completion reports, matching. Seventy-eight tracked files. Leaving
them off a tree is how they get quietly rewritten into something worse.

The proposal did show `apps/web/app/api/whatsapp/webhook/`, which read as a plan
to move the webhook into Next.js. **Settled 30 Aug 2026: the edge functions stay
on Supabase and Next.js calls them.** They keep service-role database access,
Meta signature verification and OpenTelemetry tracing, all of which work today
and would each have to be re-solved in the Next runtime.

### 2. Edge functions cannot be grouped into folders

**Supabase deploys every top-level directory under `supabase/functions/` as a
function named after that directory.** Only `_`-prefixed directories are exempt.
So `functions/intake/yaad-whatsapp-webhook/` would deploy a function called
`intake`, and the webhook URL would break.

The grouping in the tree above is documentation, not directory structure. The
directories stay flat. Anyone tidying them into subfolders takes the backend down.

### 3. The Python engine was implied but not placed

`packages/engine-client` was described as "typed caller for the Python Worker",
which means a Python engine exists somewhere. It does: `yaad/`, with four agents
(intake, pricing, reporting, verification) plus guardrails and telemetry. It
needs a location in the tree. **Settled 30 Aug 2026: it runs as a Cloudflare
Python Worker**, called over HTTP through `packages/engine-client`. That keeps
the agents in Python, where they are written and tested, and keeps the calling
side typed.

### 4. The marketing site should stay static

The proposal put `(marketing)` inside the Next.js app. Recommendation: keep it
as plain HTML served as static files.

All six marketing pages render complete with JavaScript blocked. Both corridor
competitors, TheLinxNetwork and Tradelink JA, fail that test: their pages are
JavaScript-only, which costs them on Jamaican mobile data and in search. It is a
real and cheap advantage, and it was just rebuilt to that standard. Next.js can
produce static output, but moving it means rebuilding working pages to arrive
back where we already are.

---

## The order of work

**Now:** `apps/console`. It is the only node in this tree that is a missing
thing rather than a move, and it is not blocked by the rest.

**Later, and only when a stage needs it:** `packages/`, the `engine/` rename,
and folding `docs/` into `apps/web/public/`. None of it buys anything on its own,
and doing it early would collide with the site stages still to run and with
parallel sessions working in this repo.

## Why the console is first

**`apps/console` is the strongest idea in the proposal.** The admin desk was
removed from `docs/index.html` on 27 August and has had no home since. There is
a spec for it (`specs/ADMIN-DESK-VISUAL-SPEC.md`) and no implementation. Every
other item in this tree is a move; this one is the missing thing.

Behind Cloudflare Zero Trust on `yard.yaadly.co.uk` is right: it holds client
addresses, worker ID status and payment control, and it should never share an
origin or a session with the client portal.
