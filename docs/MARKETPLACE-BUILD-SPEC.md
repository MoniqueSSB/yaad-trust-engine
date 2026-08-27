# Build spec — Marketplace, worker profiles, client profiles

**For:** Claude Code, building into `docs/index.html`
**Reference implementation:** `docs/preview/index.html` — screens `#s-market`, `#s-worker`,
`#s-trades`, `#s-ask`. Every function named here exists there, working, and can be lifted.
**Version:** 1.0 · 26 August 2026
**Companion:** `docs/PORTALS-BUILD-SPEC.md` (what happens after a worker is chosen)

---

## 0 · Scope

This spec covers the public board and the two profile types:

| Screen | Route | What it is |
|---|---|---|
| Marketplace | `#s-market` | Two tabs: Open jobs · Vetted workers |
| Worker profile | `#s-worker` | Public profile, portfolio, checks, reviews — and the mirrored client profile |
| Trades | `#s-trades` | All 18 trades, each a filter into the board |
| Ask a Yaad | `#s-ask` | Free public Q&A, answered by vetted workers |

**Everything on this board is public.** No auth to browse. Auth is only needed to *quote*.

---

## 1 · The two-toggle model

The marketplace carries **two independent switches** and they are not the same thing.

### 1.1 Viewer mode — `vmode`

```
[ Visitor · public ]  [ Vetted worker · signed in ]
```

This is a **demo affordance that must survive into production as a real auth state.** It shows the
same board through two different sets of permissions.

| `vmode` | Note shown | Quote button |
|---|---|---|
| `visitor` | "Anyone can browse. Quoting needs a published profile and a signed Worker Guidelines — the same rule clients meet." | Ghost. Opens the lock note |
| `worker` | "Vetted, profile published, Worker Guidelines signed — you can quote any open job and ask questions on it." | Solid. Opens the quote form |

### 1.2 Tab — `mtab`

```
[ Open jobs ]  [ Vetted workers ]
```

Two directories on one screen. Jobs is the default.

---

## 2 · Open jobs

### 2.1 The lead paragraph is a spec, not copy

> "The public board. This is the `open_jobs` view — safe columns only, anyone can read it."

**Build `open_jobs` as a database view, not a filtered select.** A view cannot leak a column a
future developer forgets to exclude. It must exclude, at minimum: street address, client phone,
client email, and **`budget_band`**.

### 2.2 Filter bar

Chips, single-select, sticky:

```
[All trades] [Plumbing] [Electrical] [Roofing] [Masonry] [Tiling]
```

Below it, a live count that says something true and slightly pointed:

> "7 open jobs · drafts and unsigned jobs are not counted because they are not here."

That clause is the gating rule made visible. Keep it.

### 2.3 Job card — `jobCard(j)`

Field order matters. This is the order a worker's eye needs.

```
┌─────────────────────────────────────────────────┐
│ [Just posted]  [Roofing]                        │  1  status + trade
│ Two sheets of zinc lifted after the last storm  │  2  title
│ Rear section, two sheets lifted and one purlin  │  3  description
│ looks split. Water coming into the back bedroom.│
│ ───────────────────────────────────────────────  │
│ Replace lifted sheets · 1 to 2 sheets ·         │  4  STRUCTURED ROW
│ Single storey · Worker supplies, invoiced       │
│ ───────────────────────────────────────────────  │
│ [thumb] [thumb] [thumb]  [+2 more]              │  5  photos, 3 max
│ 5 photos from the client, first three shown ·   │
│ yaad-vision has read them all                   │
│ ───────────────────────────────────────────────  │
│ Stony Hill, St Andrew · Urgent — 48 hours ·     │  6  meta row
│ 5 photos · 7 workers interested · 5 hours ago   │
│ ───────────────────────────────────────────────  │
│ ✓ Client guidelines signed ·                    │  7  trust row
│ Client 4.9★ · 5 jobs completed · JB-4465        │
│ ───────────────────────────────────────────────  │
│ [Quote this job]  Quote on the scope — no band  │  8  action row
└─────────────────────────────────────────────────┘
```

**Row 4, the structured row, is the whole point of the redesign.** It comes from
`data/job-taxonomy.js`. Without it a card is prose and two roofing jobs cannot be compared.
Never render a card without it.

**Row 5, photos.** Three thumbnails inline, each captioned with what it shows
(*"Rear roof from the yard"*, *"The two lifted sheets"*). A `+N more` chip expands in place and
becomes `Show less`. The old behaviour — the words "5 photos" and nothing to look at — was the bug.

**Row 8, the band line.** Where a "Fair band J$X–Y" pill used to sit, the card now reads
**"Quote on the scope — no band shown."** See §6.

Data shape per job:

```js
{
  id, t (trade), ti (title), d (description), a (area),
  sp: [type, size, access, materials],   // structured row
  pics: [caption, …],                    // photo captions
  ago, w (when needed), n (workers interested),
  cs (guidelines signed), cj (client jobs done), cscore,
  fresh                                   // "Just posted"
}
```

`fresh` gets a subtle highlight border. It is the difference between a live board and a list.

### 2.4 Quote panel — `openQuote(id)`

Expands inline beneath the card. Accordion: opening one closes the others.

**When `vmode !== 'worker'` — the lock note.** Do not hide the button; explain the rule:

> 🔒 **Quoting is for vetted workers.** The `job_quotes` insert policy needs three things true at
> once: a published worker profile, a signed Worker Guidelines, and a job that is genuinely open.
> Browsing stays free for everyone.

Naming the policy is deliberate. It tells a worker the rule is enforced by the database, not by
somebody's mood.

**When `vmode === 'worker'` — the quote form:**

| Field | Helper text — keep verbatim |
|---|---|
| Your labour price (J$) | "The fee is calculated on this, and only this." |
| Materials (J$) | "Passed through at cost. Never fee'd, either side." |
| Earliest start | select: Within 48 hours · This week · Next week · Two weeks or more |
| How many days on site | free text |
| What is included | "Be specific about what is and is not in the price. Vague quotes get skipped." |

**The live fee split** renders as soon as a labour figure is typed:

```
Your labour price              J$42,000
Materials, at cost             J$18,500
───────────────────────────────────────
Client fee, 15% on labour        +J$6,300
Client sees one number          J$66,800
```

This is the DMCCA requirement made visible — the client fee sits **inside** the headline number,
never added at checkout.

Footer, both lines kept:

> "Payment stages are not set here. They are drafted into the Kickoff Pack once the client accepts,
> so there is only ever one stage list."
>
> "Goes straight to the client. Your phone number is not attached."

On send, the panel replaces itself with confirmation explaining what the client will see alongside
the quote — Yaad Score, jobs completed, evidence from past work.

---

## 3 · Vetted workers tab

Grid of `workerCard(w)`, three across on desktop, one on mobile.

```
┌──────────────────────────────┐
│ (DC)  Delroy Campbell    4.8 │  avatar initials on a gradient
│       Plumbing            /5 │
│       Kingston 8       31 jobs│
│ [ID verified] [Police check] │  tags
│ [ ][ ][ ][ ]                 │  4 evidence thumbnails from past jobs
│ [    View profile     ]      │
└──────────────────────────────┘
```

In an invite context the button becomes **Invite to quote**.

The four evidence thumbnails matter more than the score. A number is a claim; four photographs from
completed jobs are the thing a client actually looks at.

---

## 4 · Worker profile — `#s-worker`

Reached by tapping a worker card. **Not a separate search destination** — discovery is by trade and
parish, deliberately.

### 4.1 Header

Avatar · name · trade · years · areas covered · Yaad Score · jobs completed.

### 4.2 About, in their own words

Free text the worker wrote. Delroy's: *"Plumbing and water systems. Most of my work is leaks,
re-pipes, tanks and pumps in Kingston 6, 8 and 10. I do not take on tiling or electrics — I will
tell you who does."*

Give it room. That last sentence sells better than any badge on the page.

### 4.3 Verification checks

Each check as a passed line, in this order:

```
✓ Government photo ID on video call
✓ TRN verified
✓ Proof of address
✓ JCF police record check — required, works over £500
✓ Certification checked with the issuing body   (certified trades only)
✓ 3 trade references called — spoken to, not emailed
✓ Walkthrough call completed
✓ Trial job before a first client
```

**Police check state is explicit.** Where it is not on file the profile says plainly:
*"Cannot be matched to jobs over £500 or work inside an occupied home."* Not a missing tick — a
stated consequence.

### 4.4 Portfolio

Past jobs as cards: title, month, and the evidence weight — `"3 stages · 12 evidence items"`.
Tapping opens that job's evidence gallery: real before-and-afters at matched angles.

### 4.5 The two panes — `setProfile(m)`

The profile screen carries **both directions of the review system**, switched by `data-pmode`:

| Pane | Note shown |
|---|---|
| `wk` — reviews of the worker | "Reviews written by clients he actually worked for. One per completed job, tied to the evidence they signed off." |
| `cl` — reviews of the client | "Reviews written by workers who actually did her jobs. Same rule, other direction — **this is what a worker checks before quoting.**" |

Building the client pane is not optional. The mirror rule is real or it is marketing.

Each pane: rating bars by criterion · the review list · and the write-a-review form.

---

## 5 · Reviews — two-way, job-bound

### 5.1 The four rules

Enforced in the database, not the UI:

1. **Tied to a real job.** Only a job that exists, that you were party to, and that is signed off.
2. **Cannot be bought or buried.** Sealed until both sides have written, or 14 days pass.
3. **Right of reply, not right of removal.** One public reply. No deletion, either side.
4. **The score moves on completion.** Recalculated from signed-off jobs only, once per job, by trigger.

### 5.2 The form

Star picker, then **criteria as tappable chips** — a worker on a phone will not write an essay.

**Client reviewing a worker:** Turned up when he said · Work matched what was agreed ·
Kept me updated · Cleaned up after himself

**Worker reviewing a client:** Access was there when agreed · Clear about what they wanted ·
Approved the evidence promptly · Fair to deal with

Then free text, then post. Confirmation states what just happened:

> "Tied to JB-4390 and to your sign-off. Delroy gets one public reply and no way to remove it.
> His Yaad Score has been recalculated from signed-off jobs only."

### 5.3 The four explainer cards

Keep all four, and the client-side ones:

- **It runs both ways** — a worker reviews the client too
- **It is your supply-side retention** — good clients get quoted faster
- **First-timers start at nothing, not at zero** — never render `0.0★`
- **Diaspora clients need it most** — *"You are asking a Kingston worker to trust somebody in London
  they will never meet. A record of paying on time is the only thing that answers that."*

---

## 6 · The rules that must not be broken

| Rule | Where it bites | Enforcement |
|---|---|---|
| **No price band on a worker's screen, ever** | Job card, quote panel | `benchHtml()` is retired. Do not restore it. Do not select `budget_band` in any board query |
| Street address hidden until chosen | Job card, job detail | `open_jobs` view excludes it |
| Client phone and email never on the board | Everywhere | Same view |
| Quoting requires three things at once | Quote panel | `job_quotes` insert policy: published profile + current-version signature + open job |
| Drafts and unsigned jobs are not on the board | List query | Requires a current-version `client_guidelines` signature |
| Reviews only against a job you were party to | Review form | RLS on `reviews` |
| Score moves once per job | Profile | DB trigger |

**On the retired band.** The figures that used to sit there were invented — they were not in
`Yaadly_Cost_Benchmarks.md` or anywhere else. Beyond being wrong, publishing a band *is* price
estimation, which the founder rule excludes: Yaadly does project management and oversight, not
price estimation. A band a worker can see is a band a worker quotes to.

---

## 7 · Trades screen — `#s-trades`

All 18 trades as cards: icon, name, open job count. Tapping filters the board to that trade.

```
Plumbing 31 · Roofing 24 · Electrical 29 · Tiling 16 · Masonry & Concrete 22
Painting & Decorating 27 · Grille & Gate Welding 19 · Air Conditioning 21
Landscaping 14 · General Handyman 38 · Solar Install 12 · Water Tank & Pump 17
Locks & Security Doors 11 · Windows & Glazing 9 · Carpentry & Joinery 20
Drainage & Septic 8 · Fencing 10 · CCTV & Alarms 13
```

These names are the taxonomy's own. Do not rename them independently of
`data/job-taxonomy.js` — the two must match exactly or filtering breaks.

---

## 8 · Ask a Yaad — `#s-ask`

Free public Q&A. A visitor asks; vetted workers answer publicly. Question, asker's area, answer,
answering worker with their score.

> "Not sure it's a job at all? Ask first — vetted workers answer publicly."

This is the top of the funnel. Somebody who is not ready to post a job will ask a question, and the
worker who answers well gets invited to quote. It costs nothing and it is the cheapest trust-builder
on the site.

---

## 9 · Data mapping

| Component | Reads | Writes |
|---|---|---|
| Job list | `open_jobs` **view** | — |
| Structured row | `jobs.trade`, `job_type`, `size_band`, `access`, `materials` | — |
| Photos | `job_photos` | — |
| Client trust row | `client_summary` **view** | — |
| Quote panel | `jobs` | `job_quotes` |
| Worker directory | `worker_profiles` where published | — |
| Worker profile | `worker_profiles`, `worker_checks`, `portfolio`, `reviews` | — |
| Client profile | `client_summary` view | — |
| Review form | `reviews`, `jobs` | `reviews` |
| Trades | `app_settings.trade_list` + live counts | — |
| Ask a Yaad | `questions`, `answers` | both |

**Build `open_jobs` and `client_summary` as views.** Both carry a leak risk that a view removes
structurally and a select does not.

---

## 10 · Build order

1. `open_jobs` view + `client_summary` view. Get the leak surface closed before any UI exists.
2. Job list, filter chips, live count with the drafts clause
3. Job card — all eight rows, structured row from the taxonomy
4. Photo thumbnails with expand and collapse
5. Quote panel — lock note first, then the form, then the live fee split
6. Worker directory tab
7. Worker profile — header, about, checks, portfolio
8. Reviews — worker pane, then client pane, then both forms
9. Trades screen wired to the filter
10. Ask a Yaad

---

## 11 · Acceptance tests

Headless at **390 / 768 / 1280 / 1600**. Zero horizontal overflow, zero JS errors at all four.

- [ ] Board shows only jobs with a current-version client signature; drafts absent
- [ ] Count line reads "N open jobs · drafts and unsigned jobs are not counted because they are not here"
- [ ] Every card renders the structured row; none renders without it
- [ ] Three photo thumbnails, `+N more` expands in place, becomes `Show less`
- [ ] **Grep the rendered board and every board-context response for `budget_band` and for any price band — both absent**
- [ ] Street address, client phone and client email absent from every board response
- [ ] Visitor mode: Quote opens the lock note, naming the three policy conditions
- [ ] Worker mode: typing a labour figure renders the split, and `client sees one number` = labour × 1.15 + materials
- [ ] Trade filter narrows the list and updates the count
- [ ] Worker profile shows all vetting checks; a worker without a police check shows the consequence line
- [ ] Profile switches between worker-reviews and client-reviews panes
- [ ] Review cannot be posted against a job the account was not party to
- [ ] Reviews stay sealed until both are written or 14 days pass
- [ ] A new profile shows the first-timer state, never `0.0★`
- [ ] All 18 trade names match `data/job-taxonomy.js` exactly

---

## 12 · Do not

- Do not restore `benchHtml()` or any price band on a worker's screen.
- Do not filter the board with a select where a view is specified.
- Do not hide the Quote button from visitors — explain the rule instead.
- Do not render a job card without its structured row.
- Do not build the worker review pane without the client one.
- Do not rename a trade independently of the taxonomy file.
- Do not rewrite the copy. It has been through many rounds and is decided.
