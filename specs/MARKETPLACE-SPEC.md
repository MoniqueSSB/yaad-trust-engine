# Build spec: Marketplace, worker profiles, client profiles
**Version 1.0, 26 August 2026. Authored by Monique. Canonical.**
**Reference implementation:** `preview/index.html`, screens s-market, s-worker, s-trades, s-ask. Copy decided; the repo reference is already dash-scrubbed and is the canonical wording. Companion: `specs/PORTAL-SPEC.md`.
**Implementation target, amended per Monique's same-day decision:** the marketplace is built at `app.yaadly.co.uk/jobs` in `web/`, wearing the site header so it reads as a tab of one Yaadly site. Everything else binds as written.

## The two-toggle model
vmode (visitor or vetted worker) is a REAL auth state in the app, derived server-side from the same three facts the jq_insert_vetted policy checks: session, published worker profile, signed Worker Guidelines. mtab switches Open jobs and Vetted workers on one screen, jobs default. Notes copy per side is decided.

## Open jobs
open_jobs is a database view, not a filtered select: a view cannot leak a column a future developer forgets to exclude. Excludes street address, client phone, client email, and budget_band, always. Filter chips single-select. Count line: "N open jobs · drafts and unsigned jobs are not counted because they are not here", the gating rule made visible.

Job card, eight rows in this order: status and trade pills (fresh gets a highlight border), title, description, THE STRUCTURED ROW (job_type, size_band, access, materials, from data/job-taxonomy.js; a card is prose without it), photos (three thumbs with captions, +N more expands in place and becomes Show less, "yaad-vision has read them all" line), meta row (area, urgency, photo count, interest, ago), trust row (guidelines signed, client record or first-timer copy, id), action row (Quote button plus "Quote on the scope, no band shown").

Quote panel expands inline, accordion. Visitor: the lock note naming the three conditions of the job_quotes insert policy; the button is never hidden, the rule is explained. Worker: labour (fee on this and only this), materials (at cost, never fee'd), earliest start, days on site, what is included, and the live fee split the moment labour is typed, client fee inside the headline number (DMCCA made visible). Footer lines about the Kickoff Pack stage list and the unattached phone number are kept. On send: confirmation naming what the client sees alongside.

## Vetted workers tab
workerCard grid, three across desktop. Avatar initials, trade, parish, jobs count, tags, four evidence thumbnails (the thumbnails matter more than the score), View profile or Invite to quote.

## Worker profile (s-worker)
Header, about in their own words, verification checks in order with the reference-gate consequence stated plainly where references are not yet confirmed ("Cannot be matched to jobs over £500 or work inside an occupied home"), portfolio by evidence weight, and BOTH review panes: reviews of the worker and reviews of the client. The client pane is not optional; the mirror rule is real or it is marketing.

## Reviews
Job-bound, both directions, sealed until both are in or 14 days, one public reply, no deletion, score recalculated from signed-off jobs only by trigger, once per job. Criteria chips per side as specced. Never render 0.0; first-timers show first-timer copy. The four explainer cards kept, including "Diaspora clients need it most".

## Rules that must not break
No price band on a worker's screen, ever; benchHtml is retired and stays retired; budget_band never selected in any board query. Address, phone, email never on the board. Quoting needs the three conditions at once. Drafts and unsigned jobs never appear. Reviews only against a job you were party to.

## Trades and Ask a Yaad
All 18 trade names come from data/job-taxonomy.js and are never renamed independently. Ask a Yaad is the free public top of funnel: visitor asks, vetted workers answer publicly.

## Status of the build (26 Aug, app implementation)
DONE: open_jobs and client_summary views; structured-row columns and job_photos; board with both toggles, count line, eight-row card, photo expand, lock note, live fee split wired to job_quotes; worker directory tab; reviews system with all four rules proven in Postgres by attack (scores are derived views, stronger than the specced trigger); /workers/[slug] public profiles with the reference-gate consequence line and the one public reply; /trades with live counts; /ask with a human-look moderation gate on questions and the quoting bar on answers; review forms in the portal job room at complete, criteria chips per side, sealed confirmation.
KNOWN GAPS, on the list: the view's address scrub is line-anchored and misses a free-text address mid-sentence; interest counts on cards need a public aggregate; the client review pane renders through the job trust row and portal rather than a standalone client profile page; worker_profiles rows are still zero so profiles publish as workers pass vetting.
