# Build spec — Mobile app: marketplace, worker profiles, client profiles

**For:** Claude Code
**Reference implementation:** `preview/index.html` — the marketplace, worker profile and review
system exist there working, at web scale. This spec adapts them to a phone and adds what a phone
can do that a browser cannot.
**Version:** 1.0 · 26 August 2026

---

## 0 · The decision this spec is built on — read before anything else

The standing architecture rule is **"the website is the app."** That rule is right for most of
Yaadly and this spec does not overturn it. But it breaks in exactly one place, and that place is
the reason to build native at all.

### What actually needs to be native

**The worker's evidence camera.** Everything Yaadly sells rests on evidence being *provably* taken
at that property, on that day, by that worker. A browser cannot:

- force in-app capture and refuse a gallery upload
- reliably attach GPS at the moment of capture
- queue uploads and survive the app being closed on a bad connection
- fire a push the second a matching job is posted

A worker on a Kingston rooftop with two bars is the hardest user on this platform and the one
whose failure costs the most. **That is the app.**

### What does not

**Clients.** A diaspora client reads evidence, opens a report and presses release. That is a
browsing task on a good connection, and the responsive web portal already does it. Building a
client app doubles the surface area and buys nothing.

**Recommendation, stated plainly:**

| Surface | Build | Why |
|---|---|---|
| **Worker app** | **Native (React Native + Expo)** | Camera, GPS, offline queue, push |
| **Client** | Responsive web + PWA install | Reviewing evidence is a browsing task |
| **Marketplace browse** | Both — same API | Public discovery, no auth needed |

**If you disagree and want one app for both**, build the client side as screens inside the same
React Native binary but ship the worker features behind a role check. Do not build two apps.

**Stack:** React Native + Expo (managed), `expo-camera`, `expo-location`, `expo-file-system`,
`expo-notifications`, `expo-secure-store`, `@supabase/supabase-js` with `AsyncStorage` session
persistence, TanStack Query for cache and offline, MMKV for the queue. No custom native modules
in v1.

---

## 1 · Design system — carry it over exactly

TROPICS tokens, unchanged from web:

```
--bg      #08110F      ground
--panel   #0F1B17      cards
--line    #1F332C      borders
--teal    #14B8A6      proven / released / safe
--tealb   #2DD4BF      accent
--mango   #FFB020      held / waiting / your call
--coral   #FF6B4A      risk / blocked / not doing
```

**Semantic colour is load-bearing, not decoration.** Mango always means money is held or a decision
is owed. Coral always means blocked or excluded. Teal always means proven. A worker learns this in
one job and it must never mean anything else.

Type: **Anton** display (uppercase headings), **Space Grotesk** body, **JetBrains Mono** for
references, amounts, hashes and timestamps. Bundle the fonts — do not fetch at runtime.

Minimum tap target **44×44pt**. Body text never below **15pt** — a worker is reading this outdoors
in sunlight with wet hands.

---

## 2 · Navigation

**Worker app — bottom tabs, five:**

```
[ Jobs ]  [ My work ]  [ Camera ]  [ Money ]  [ Me ]
```

- **Jobs** — the marketplace, filtered to their trades and parishes by default
- **My work** — live jobs, stage rail, what is owed from them
- **Camera** — centre, raised, the primary action. Opens straight to capture
- **Money** — held, approved, paid, and the payout method
- **Me** — profile, Yaad Score, vetting record, availability diary

**Client (web/PWA):** the existing hash routes. No bottom bar; the site nav is enough.

Deep links: `yaadly://job/{id}` · `yaadly://worker/{slug}` · `yaadly://evidence/{jobId}/{stage}`.
Every push carries one.

---

## 3 · The marketplace

### 3.1 List screen

Infinite scroll, page size **20**, cursor on `created_at`. Pull to refresh. Skeleton cards on first
load, never a spinner on a blank screen.

**Default filter for a signed-in worker is their own trades and parishes** — not everything. A board
showing plumbing jobs to a roofer in another parish is noise, and noise is why people stop opening
an app. A "Show everything" chip sits at the end of the filter row.

### 3.2 Job card anatomy

Every field below exists in the reference implementation. Order matters — this is the order a
worker's eye needs.

```
┌────────────────────────────────────────────┐
│ [Just posted]  [Roofing]                   │  status + trade pills
│ Two sheets of zinc lifted after the storm  │  title, 2 lines max
│ ─────────────────────────────────────────  │
│ Replace lifted sheets · 1 to 2 sheets ·    │  STRUCTURED ROW — from the
│ Single storey · Worker supplies, invoiced  │  job card taxonomy
│ ─────────────────────────────────────────  │
│ [img] [img] [img]  [+2 more]               │  max 3 thumbs, rest behind a tap
│ 5 photos from the client                   │
│ ─────────────────────────────────────────  │
│ Stony Hill, St Andrew · Urgent — 48 hours  │
│ 7 workers interested · 5 hours ago         │
│ ─────────────────────────────────────────  │
│ ✓ Client guidelines signed                 │
│ Client 4.9★ · 5 jobs completed             │
│ ─────────────────────────────────────────  │
│ [ Quote this job ]   Quote on the scope    │
└────────────────────────────────────────────┘
```

**The structured row is the point.** It comes from `data/job-taxonomy.js` — trade, job type, size
band, access height, who supplies materials. It is what makes two roofing jobs comparable and it is
why the board reads like a marketplace instead of a group chat. Never render a card without it.

**The last line is a hard rule.** Where a price band used to sit, the card says
**"Quote on the scope — no band shown."** There is no price band on a worker's screen, ever. See §8.

### 3.3 Filters

A horizontally scrolling chip row, sticky under the header:

`My trades ▾` · `My parishes ▾` · `Urgency ▾` · `Size ▾` · `Materials ▾` · `Show everything`

Trade and type options come from the taxonomy, keyed **`Trade|Type`** — never `Type` alone.
Two trades share a type name (*Leak trace and repair* is Plumbing and Roofing; *Fault finding on an
existing system* is Solar and CCTV) and a flat key silently returns the wrong set.

Filter state persists across launches in MMKV.

### 3.4 Empty states — write them, do not default them

| Situation | Copy |
|---|---|
| No jobs in their trades and parishes | "Nothing in your trades in St Catherine right now. We will push you the moment there is. Widen your parishes to see more." + [Edit my parishes] |
| Filtered to nothing | "No jobs match all five filters. Try dropping one." + [Clear filters] |
| Offline | "You are offline. Showing the last 20 jobs from [time]." Cards render with a dimmed border. |
| Not yet vetted | "Browsing is free for everyone. Quoting needs a published profile and a signed Worker Guidelines." + [Finish my application] |

### 3.5 Job detail

Full description · the complete structured card, every field · **all** photos in a swipeable gallery
with pinch zoom · the parish and area (never the street address — that stays private until a worker
is chosen) · client score and jobs completed · how many workers have quoted · the evidence checklist
this job type will require, **shown before quoting** so nobody quotes blind on effort.

Primary action: **Quote this job**. Free, every time, win or lose — say so on the button row.

### 3.6 Quoting

Labour and materials are **separate fields and cannot be combined.** The fee is calculated on labour
only, and the screen says so under the labour field: *"The fee is calculated on this, and only this."*
Materials: *"Passed through at cost. Never fee'd, either side."*

Then: earliest start (date picker, honours their own diary), days on site, and **what is included /
what is excluded** as two editable lists. Exclusions are not optional — a quote without them cannot
be submitted. *"What you leave out of the quote is what you are not being paid for, and it is what
stops an argument in a fortnight."*

No band, no benchmark, no suggested figure anywhere on this screen.

---

## 4 · Worker profile

### 4.1 Public view — what a client sees

```
Avatar · Name · Trades · Parishes covered
Yaad Score  4.8/5      31 jobs completed
```

**Sections, in order:**

1. **About, in their own words.** Free text they wrote. Delroy's reads: *"Plumbing and water
   systems… I do not take on tiling or electrics — I will tell you who does."* That sentence sells
   better than any badge, so give it room.
2. **Verified** — the checks that passed, as a list, each with what it means:
   government photo ID on a live video call · TRN verified · proof of address ·
   **JCF police record check** · certification checked with the issuing body · 3 references called ·
   walkthrough call completed · trial job reviewed on site.
   Police check shows a state chip: `Current` / `Not on file`. Where it is not on file, the profile
   says plainly: *"Cannot be matched to jobs over £500 or work inside an occupied home."*
3. **Portfolio** — past jobs as cards: title, month, `"3 stages · 12 evidence items"`. Tapping opens
   the evidence gallery for that job — real before-and-afters at matched angles, not marketing shots.
4. **Reviews** — see §6.

### 4.2 Own view — what the worker sees on themselves

Everything above, plus:

- **Yaad Score explained**, not just displayed: it moves only on signed-off jobs, once per job, by a
  database trigger. It cannot be inflated by activity. *"A verified record you own, that counts with
  clients and, in time, with a bank."*
- **Vetting record** — every line as `Done` / `Now` / `Waiting`, with any GAP named and what clears it.
- **Trades and parishes** — editable. Multi-select, plus add-your-own trade.
- **Availability diary** — the calendar, their own days, tap to open or close.
- **Documents** — Worker Guidelines v1.1 with signature date, ID, police check with expiry, certificates.
- **First-timer state.** A brand-new profile shows *"First-timers start at nothing, not at zero"* —
  no score yet, trial job pending, and what the reviewer will look at. Never render `0.0★`.

---

## 5 · Client profile

This exists and matters more than people expect. **The mirror rule is real or it is marketing.**

### 5.1 Public view — what a worker sees before quoting

```
Andrea F. · Barbican, Kingston 8 · posting from overseas
Client 4.7★ · 3 jobs completed · client since Apr 2026
```

- ✓ **Client Guidelines signed** — with version and date
- **Payment record** — *"Approved within 2 days on average"*, *"No disputes raised"*. This is the
  single most useful thing a worker can know and nobody else in this market shows it.
- **Reviews from workers** — see §6
- **First-timer state:** *"No client score yet — first job on Yaadly."* Stated as neutral fact, not
  a warning.

**Never shown to a worker:** street address · phone · email · **budget band**. Address and contact
unlock only when that worker is chosen and the scope is agreed.

### 5.2 Own view — what the client sees on themselves

Their jobs, their score, their guidelines signature, and: *"Workers can see how fast you approve.
A record of paying on time is the only thing that answers 'why should I trust somebody overseas'."*

---

## 6 · Reviews — two-way, job-bound

Four rules, all enforced in the database, not the UI:

1. **Tied to a real job.** You can only review a job that exists, that you were party to, and that
   is signed off. There is no free-floating review.
2. **Cannot be bought or buried.** Sealed until both sides have written, or 14 days pass.
   Neither party sees the other's before writing their own.
3. **Right of reply, not right of removal.** One public reply. No deletion, either side.
4. **The score moves on completion.** Recalculated from signed-off jobs only, once per job, by trigger.

Criteria are tappable chips, not a paragraph — a worker on a phone will not write an essay.
Worker→client: *turned up when he said* · *access was there when agreed* · *approved quickly* ·
*fair to deal with*. Client→worker: *quality* · *timekeeping* · *communication* · *left it clean*.

---

## 7 · The evidence camera — the reason this app exists

### 7.1 Capture rules

- **In-app capture only.** No gallery picker on an evidence upload. This is not a UX preference —
  a photo from a gallery is a photo that could be from any job, and reusing evidence from another
  job is a permanent-removal offence in the Worker Guidelines. The camera enforces the rule the
  document states.
- **GPS attached at the moment of capture**, not on upload. If location is denied, the item is
  captured and flagged `location: unavailable` — never silently dropped, and the client sees the flag.
- **Timestamp is device time and server receipt time, both stored.** A gap between them is not an
  error; it is what an offline upload looks like, and it is recorded honestly.
- **SHA-256 computed on device, before upload.** Stored on the row. Never recomputed on read.
  This is what makes evidence proof rather than photographs.

### 7.2 Checklist-driven capture

The camera opens **against the checklist for that stage**, not into a blank roll. The reference
implementation has the checklist per job type in `data/job-taxonomy.js` — 23 evidence sets across
18 trades.

```
Stage 1 · 6 items · 2 done
┌──────────────────────────────────────┐
│ ✓ Arrival photos, geotagged     3/3  │
│ ✓ The damaged area before it is      │
│   touched                       1/1  │
│ ○ Fixings and purlins underneath     │  ← tap to capture
│ ○ Materials on site with the receipt │
│ ○ The finished roof, wide shot       │
│ ○ Walk-round clip from the ground    │
└──────────────────────────────────────┘
        [ ● Capture next item ]
```

Each item shows a one-line prompt while the viewfinder is open — *"Same angle as the before shot"* —
because the standard is matched angles and telling them at capture time is the only moment it helps.

**A stage cannot be submitted with an incomplete checklist.** The button reads
`4 of 6 — finish the set` and is disabled.

### 7.3 Offline queue

The single hardest requirement. A worker will capture a full stage on a roof with no signal.

- Everything writes to local storage first. The UI never blocks on a network call.
- Queue persists across app kill and device restart (MMKV + `expo-file-system`).
- Background upload when connectivity returns; resumable, chunked.
- Per-item state visible: `On this phone` → `Uploading 40%` → `Filed` → `Failed, retry`.
- **Never delete a local file until the server confirms the hash matches.**
- A banner while anything is pending: *"3 items on this phone, not yet filed. They upload when you
  have signal."* Reassuring, not alarming — the work is safe, it just has not landed.

---

## 8 · The rules that must not be broken

| Rule | Where it bites | Enforcement |
|---|---|---|
| **No price band to a worker, ever** | Marketplace card, job detail, quote screen | Do not select `budget_band` in any worker-context query. Not a UI condition — a query rule |
| Client address and contact hidden until chosen | Job detail, client profile | RLS on `jobs.address`, `jobs.phone` |
| No gallery uploads on evidence | Camera | In-app capture only |
| Contact details scrubbed from chat | Messaging | `scrub()` on insert **and** on render |
| Quoting requires vetting | Quote button | Published profile + current-version `worker_guidelines` signature |
| Police check gates high-value work | Job matching | No match to jobs > £500 or occupied homes without a current check |
| Score moves on signed-off jobs only | Profile | DB trigger, once per job |
| Evidence hash set at capture | Camera | Never recomputed |

---

## 9 · Push notifications

Workers only. Every one is actionable and carries a deep link. Nothing that is merely interesting.

| Trigger | Copy | Priority |
|---|---|---|
| Job matched (`yaad-match`) | "Roofing job in St Catherine — urgent, 48 hours" | High |
| Quote accepted | "You got JB-4471. Stage one is funded." | High |
| Client approved a stage | "Stage one signed off. £158.40 released to you." | High |
| Evidence sent back | "Monique sent stage two back with a note." | High |
| Dispute raised | "A client has raised something on JB-4468." | High |
| Visit tomorrow | "Barbican, 08:00. Three arrival photos first." | Normal |
| Upload failed after retries | "2 evidence items still on your phone." | Normal |

**Quiet hours 21:00–07:00 Jamaica time**, except dispute and payment. A worker's phone is their
personal phone.

Frequency cap: match alerts batch to a maximum of one every 30 minutes.

---

## 10 · Performance budgets — Jamaican mobile networks

Not aspirations. Test on a throttled 3G profile.

| Metric | Budget |
|---|---|
| Cold start to interactive | < 2.5s on a mid-range Android |
| Marketplace first paint | < 1.2s from cache, < 3s cold |
| Job card image payload | < 60KB per thumbnail, WebP, 3 shown |
| Evidence photo upload | Compress to ≤ 1600px long edge, ~200KB, before queueing |
| Offline read | Last 20 jobs and all own live jobs, always available |

Full-resolution originals stay on the device until wifi, unless the worker forces upload.
The compressed version is what gets hashed and filed — hash what you upload, not what you keep.

---

## 11 · API surface

Supabase directly, RLS-enforced. No bespoke backend for v1.

| Screen | Query |
|---|---|
| Marketplace list | `jobs` where status open, trade in worker trades, parish_key in worker parishes, guidelines signed. **Excludes `budget_band`.** |
| Job detail | as above + `job_photos` + client summary view |
| Quote submit | insert `job_quotes` (labour, materials, inclusions[], exclusions[], start, days) |
| Worker profile | `worker_profiles` + `worker_checks` + `portfolio` + `reviews` |
| Client profile | `client_summary` view — score, jobs, approval speed, guidelines. **Never the base row.** |
| Evidence upload | Storage + insert `evidence` (sha256, lat, lng, captured_at, received_at, checklist_item) |
| Availability | `worker_availability` upsert |
| Money | `payments` where worker |

**Build `client_summary` as a view, not a filtered select.** A view cannot leak a column that a
future developer forgets to exclude.

---

## 12 · Build order

1. Auth + session persistence + role routing
2. Marketplace list, cards with the structured row, filters, empty states
3. Job detail + photo gallery
4. Worker profile — public, then own
5. **Evidence camera + checklist + offline queue.** Longest and riskiest. Do not leave it late
6. Quote flow with the labour/materials split and mandatory exclusions
7. Client profile + `client_summary` view
8. Reviews, both directions, with the seal
9. Push + deep links
10. Availability diary

---

## 13 · Acceptance tests

- [ ] Marketplace defaults to the worker's own trades and parishes; "Show everything" widens it
- [ ] Every card shows the structured taxonomy row; none renders without it
- [ ] **Grep the entire worker binary and every worker-context response for `budget_band` and for any price band — both absent**
- [ ] Job detail shows parish and area, never the street address, before a worker is chosen
- [ ] Evidence camera refuses a gallery pick
- [ ] Capture with location denied → item saved and flagged, not dropped
- [ ] Airplane mode: capture a full 6-item stage, kill the app, restart, restore signal → all six upload and the hashes match
- [ ] Stage cannot be submitted at 4 of 6
- [ ] Quote cannot be submitted without exclusions
- [ ] Unvetted account can browse, cannot quote
- [ ] Worker without a current police check sees no job over £500 and no occupied-home job
- [ ] Review cannot be written against a job the account was not party to
- [ ] Reviews stay sealed until both are written or 14 days pass
- [ ] New profile shows the first-timer state, never `0.0★`
- [ ] Push at 23:00 for a match is suppressed; a dispute push is not
- [ ] Cold start under 2.5s on a mid-range Android, throttled 3G

---

## 14 · Not in v1

- Client native app — the responsive web portal covers it
- In-app payments — Stripe hosted, money moves by the existing route
- Video calls — the live-viewing add-on uses WhatsApp video, Meet or Zoom
- Chat as a standalone inbox — messaging is inside a job, and only inside a job
- Public worker search by name — discovery is by trade and parish, deliberately

---

## 15 · Open questions for Monique

1. **Worker app only, or both?** This spec recommends worker-native, client-web. A client app is
   buildable but doubles the surface for a user who is already well served.
2. **iOS, Android, or both at launch?** Jamaican trades skew Android heavily; diaspora clients skew
   iOS. If the client stays on web, **Android-first is the cheaper honest answer.**
3. **Does the app ship before or after the marketplace has real jobs on it?** An empty board is a
   bad first launch. Worth shipping the evidence camera to existing manual jobs first, and opening
   the board second.
