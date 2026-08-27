# Build spec — Client, Worker and Service portals

**For:** Claude Code, building into `docs/index.html` (the single-file app that serves yaadly.co.uk)
**Reference implementation:** `preview/index.html` — every component named here exists there, working, and can be lifted
**Version:** 1.0 · 26 August 2026

---

## 0 · Read this first

**The website is the app.** There is no separate build, no PWA, no download. The portals are
hash-routed panes inside `docs/index.html`, behind Supabase Auth. Do not introduce a framework,
a bundler, or a second HTML file.

**Three portals, one renderer.** Client, worker and service-client are three *sides* of the same
component tree, switched by a single `pside` variable. They share the calendar, the evidence grid,
the chat, the ledger, the documents rail and the dispute block. Build the shared components once.

**The reference implementation is not a mockup to copy pixel-for-pixel.** It is a working
specification. Lift the component functions and the copy verbatim; replace the hardcoded demo
arrays with Supabase queries. The copy has been through many revisions and is decided — do not
rewrite it.

### Non-negotiable rules

| Rule | Enforcement |
|---|---|
| A job is a draft until the client signs Client Guidelines | RLS: `jobs` visible on the board only where a current-version `client_guidelines` signature exists in `doc_signatures` |
| No AI agent touches a client's work before signature | `may_use_agents()` gate, already in the DB |
| **Yaadly never shows a price band to a worker** | No band component on any worker-side render. The client's `budget_band` column is never selected in a worker-context query |
| Contact details are scrubbed from in-portal chat | `scrub()` runs on every message before insert **and** before render |
| Money moves per stage, never as one lump | Every release is a row; no bulk release path exists |
| A milestone edit after issue creates **rev 2** | `kickoff_packs` is append-only by revision; never UPDATE a row |
| Evidence is fingerprinted on upload | SHA-256 stored at insert; never recomputed on read |

---

## 1 · Layout — identical in all three portals

Top to bottom, in this order. This order is decided and was arrived at by correction — the
calendar was previously behind a toggle and that was wrong.

```
┌──────────────────────────────────────────────────────────────┐
│  #calband     Calendar band — ALWAYS VISIBLE, never a click  │
│               [month grid 262px] [ "Coming up" card grid ]   │
├──────────────────────────────────────────────────────────────┤
│  #jrn         Stage rail — one button per stage              │
│               done / now / todo states                       │
├──────────────────────────────────────────────────────────────┤
│  #jpos        "Step 4 of 13 · client view"  [Prev] [Next]    │
├──────────────────────────────────────────────────────────────┤
│  .jhead       Badge · Heading · One paragraph                │
├──────────────────────────────────────────────────────────────┤
│  tiles()      Four stat tiles for this stage                 │
├──────────────────────────────────────────────────────────────┤
│  extra        The stage-specific component(s) — §5           │
├──────────────────────────────────────────────────────────────┤
│  actions      One primary, one or more ghost                 │
└──────────────────────────────────────────────────────────────┘
```

Single render entry point:

```js
function drawJourney() {
  S('#calband').innerHTML = calBand();
  const STG = pside === 'service' ? STAGES_SVC : STAGES;
  // …stage rail, position, head, tiles, extra, actions
}
```

Everything re-renders through `drawJourney()`. There is no partial update path. Any handler that
changes state calls `drawJourney()` and returns.

**Known trap:** during development the calendar handlers called a stale `drawCalendar()` that
wrote to a removed node, so clicks silently did nothing. If the calendar stops responding, this
is why.

---

## 2 · State model

```js
let pside   = 'client';        // 'client' | 'worker' | 'service'
let pstage  = 0;               // index into STAGES or STAGES_SVC
let shape   = 'std';           // job shape — drives stage count
let svcShape= 'retainer';      // service shape — drives milestone count
let psel    = null;            // selected quote index
let dstate  = 'none';          // 'none'|'form'|'direct'|'resolved'|'escalated'
let docOpen = null;            // 'kickoff'|'completion'|'completion-svc'|null
let msList  = null;            // editable milestones, null = use template
let pkTier  = 'auto';          // 'auto'|'sheet'|'pack'|'major'
let pkCtx   = 'svc';           // 'job'|'svc' — which family the pack belongs to
let revPick = 'visual';        // 'none'|'visual'|'tech'
let liveView= false;           // £40 live-viewing add-on
// calendar
let calY=2026, calM=7, calSel=null, calSlot=null;
```

In production every one of these except `pside` and `pstage` derives from a row. `pstage` maps to
`jobs.status`. The `shape` / `svcShape` switchers are **demo affordances** — in production the
stage count comes from `kickoff_packs.stages`.

---

## 3 · Stages

### 3.1 Job journey — client and worker (13)

```
Job live · Quote built · Quotes in · Scope agreed · Chosen & funded · Kickoff issued
Stage 1 · on site · Stage 1 · evidence · Stage 1 · released
Stage 2 · on site · Stage 2 · evidence · Closed & paid · Reviews
```

Stage count is **per job, never fixed at two.** Driven by `SHAPES`:

| Key | Job | Stages | Split |
|---|---|---|---|
| `tap` | Tap washer, one visit | 1 | 100% |
| `std` | Leak repair, two visits | 2 | 60 / 40 |
| `roof` | Re-roof, three visits | 3 | 30 / 40 / 30 |
| `reno` | Renovation | 5 | see reference |

In production: read `kickoff_packs.stages` (jsonb). Each stage carries `{n, ttl, pct, req[], got[]}`.
**The DB must refuse any pack whose stages do not total 100%.**

### 3.2 Service journey (12)

```
Booked & paid · Intake · Scope agreed · Kickoff issued
M1 · working · M1 · evidence · M1 · released
M2 · working · M2 · evidence · M3 · handover · Closed & paid · Review
```

Full parity with the job journey — same gates, same evidence discipline, same money mechanics.
This was corrected once already: an earlier version was a rudimentary four-step and that is wrong.

`SVC_SHAPES`:

| Key | Service | Milestones | Split |
|---|---|---|---|
| `check` | Deposit Protection Check | 1 | 100% |
| `retainer` | Oversight Retainer, one month | 3 | 40 / 40 / 20 |
| `fullpm` | Full Project Management | 5 | 15/15/25/25/20 |

---

## 4 · Stage → component map

Lift this table directly. Left column is the stage key, right is what renders below the tiles.

### Service side

| Stage key | Renders |
|---|---|
| `svc-portal` | `portalCard()` + `svcLedger(0)` |
| `svc-intake` | `svcLedger(0)` + `portalCard()` |
| `svc-scope` | `reviewPicker()` + `scopeDoc(0)` |
| `svc-kickoff` | `msEditor()` + `docsX([...])` + `svcLedger(0)` |
| `svc-m1-live` | `evGrid(partial)` + `svcLedger(0)` + `jobChat()` |
| `svc-m1-ev` | `evGrid(full)` + `fingerprint()` + `svcLedger(0)` + `disputeBlock()` + `jobChat()` |
| `svc-led-1` | `svcLedger(1)` |
| `svc-m2-live` | `evGrid(partial)` + `svcLedger(1)` + `jobChat()` |
| `svc-m2-ev` | `evGrid(full)` + `fingerprint()` + `svcLedger(1)` + `disputeBlock()` + `jobChat()` |
| `svc-m3-ev` | `reviewPicker()` + `evGrid(full)` + `svcReport()` + `svcLedger(2)` + `jobChat()` |
| `svc-led-3` | `completionReport('svc')` + `svcLedger(3)` + `portalCard()` |
| `svc-next` | `svcNext()` |

### Client side

| Stage key | Renders |
|---|---|
| `quotes` | `quotesList(psel)` + (if selected) `quoteDetail()` + `chatBox()` |
| `scope` | `reviewPicker()` + `scopeDoc(psel)` |
| `fee-client` | `feeClient()` |
| `docs-client` | `docsX([...])` + `ledger(0)` — **sets `pkCtx='job'`** |
| `stage1-live` | `evGrid(partial)` + `ledger(0)` + `jobChat()` + `relayHow()` |
| `stage1-ev` | `evGrid(full)` + `fingerprint()` + `ledger(0)` + `disputeBlock()` + `jobChat()` |
| `ledger-1` | `ledger(1)` |
| `stage2-live` | `evGrid(partial)` + `ledger(1)` + `jobChat()` |
| `stage2-ev` | `reviewPicker()` + `evGrid(full)` + `fingerprint()` + `ledger(1)` + `disputeBlock()` |
| `ledger-2` | `completionReport('job')` + `ledger(2)` — **sets `pkCtx='job'`** |
| `rev-c` | `reviewBox('Delroy', …)` |

### Worker side

| Stage key | Renders |
|---|---|
| `qb` | `quoteBuilder()` |
| `quote-mine` | `quoteDetail(0)` + `chatBox(0)` |
| `scope` | `scopeDoc()` |
| `docs-worker` | `docs([...])` + `feeWorker()` |
| `stage1-live` … `stage2-ev` | as client, but **`disputeWorkerBlock()`** replaces `disputeBlock()` |
| `rev-w` | `reviewBox('Monique', …)` |

---

## 5 · Shared components

### 5.1 `calBand()` — the calendar band

Always at the top. Never behind a click. Two columns: a compact month grid (262px, 32px cells,
`repeat(7, minmax(0,1fr))`) and a "Coming up" card list.

Three views of one calendar:

| Side | Sees | Can do |
|---|---|---|
| Worker | Their own diary | Toggle a day open or closed |
| Client | Only days the worker has opened, only their own job | Request a slot |
| Service | Monique's open days | Book 15 min / 30 min / half-day on site |

Day states, by CSS class: `free` (teal, open) · `booked` (mango, confirmed) · `pending` (coral,
awaiting confirmation) · `today` (mango inset ring) · `sel` · `pad` · `[disabled]` for past.

Slot sets:
```js
SLOTS_JOB = ['08:00 – 12:00', '13:00 – 17:00', '08:00 – 17:00']
SLOTS_SVC = ['15 minutes', '30 minutes', 'Half day on site']
```

**Tables:** `worker_availability(worker_id, day, open)` · `visits(job_id, day, slot, what, who, where, state)`.
A confirmed slot closes the day for everybody else.

**Mobile:** needs `@media(max-width:460px)` — without it the grid overflows by 2px.

### 5.2 `ledger(cur)` / `svcLedger(cur)` — the evidence ledger

One block per stage/milestone. Each shows: name, title, `pct` of total, state chip
(`done` / `now` / `todo`), the **required proof list**, and the **uploaded evidence**.

Copy that must survive: *"Each stage has its own checklist, its own proof and its own release.
Money moves once per stage, never as one lump at the end."*

**Tables:** `kickoff_packs.stages` for required · `evidence` for uploaded · `payments` for released.

### 5.3 `evGrid(files, caption)` + `fingerprint(stage, sha)`

Thumbnail grid plus a monospace SHA-256 line. The fingerprint is what makes evidence *proof*
rather than photographs — change one pixel and it stops matching. Compute at upload, store on the
row, display on read. **Never recompute on read.**

### 5.4 `jobChat()` — in-portal chat with the contact scrub

Client and worker message each other in the portal. Messages relay to WhatsApp both ways via
`yaad-whatsapp-webhook` — **fully automated, nobody forwards anything by hand.** Service replies
inside the 24-hour window are free; the window resets on every inbound message.

The scrub must run **on insert and on render**:

```js
const RX = [
  [/\b[\w.+%-]+\s*(?:@|\(at\)|\sat\s)\s*[\w-]+\s*(?:\.|\sdot\s)\s*[\w.]{2,}\b/gi, 'email'],
  [/(\+?\d[\d\s().\-]{6,}\d)/g, 'number'],
  [/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)\b(?:[\s,-]+\b(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)\b){4,}/gi, 'spelled-out number'],
  [/\b(whats\s?app|whatsapp|telegram|instagram|messenger|signal|gmail|hotmail|yahoo)\b/gi, 'off-platform app'],
  [/\b(cash\s+in\s+hand|pay\s+me\s+direct(?:ly)?|off\s+the\s+(?:app|site|platform))\b/gi, 'off-platform payment'],
  [/@[A-Za-z0-9_.]{3,}/g, 'handle']
];
```

A blocked message shows what was removed and why. Do not silently drop it.

**Rationale copy:** *"Everything stays here until the job is done. Not to hold you hostage — if it
happens off Yaadly there is no held money, no evidence trail and nothing to fall back on when it
goes wrong."*

### 5.5 `scopeDoc()` — the scope gate

**A worker cannot be chosen until both sides agree the documentation.** A high-level filled-out
scope, ticked by both. Until both ticks land, the Choose button renders as:
`"Choose unlocks when both have agreed"`.

### 5.6 `disputeBlock()` / `disputeWorkerBlock()`

State machine: `none → form → direct → resolved | escalated`.

**The worker is the first point of contact.** Most things are a misunderstanding and get fixed in
a day. Only if that fails does it escalate to Yaadly. The worker sees the dispute the moment it is
raised — they are never surprised by it.

On escalation: *"The whole thread — what you raised, what he said, and when — goes to the reviewer
as it stands. Neither of you rewrites it."* Nothing releases while a dispute is open.

Site visits during a dispute: **one visual review covered, any further visit chargeable**, and
Yaadly attends to look and record only — never to certify.

### 5.7 `docsX(rows)` — clickable documents rail

Rows are `[icon, title, subtitle, key?]`. A row with a key is clickable and opens inline:

| Key | Opens |
|---|---|
| `kickoff` | `kickoffPack()` — or `jobSheet()` when `pkCtx==='job'` and tier is `sheet` |
| `completion` | `completionReport('job')` |
| `completion-svc` | `completionReport('svc')` |

### 5.8 `msEditor()` — the milestone editor

Presets are **templates you start from, not fixed shapes**. Per milestone: rename, retitle, change
percent, move up or down, delete, and add or remove each piece of required proof. Add a milestone.
Reset to template.

Live total at the foot: teal at exactly 100%, coral otherwise, with
*"Must total exactly 100%. The database refuses anything else, and so do I."*

**Focus preservation:** the editor re-renders on every keystroke. After `drawJourney()`, restore
focus and `selectionStart` to the field being typed in, or typing breaks.

**Rev discipline:** changing a milestone after the pack is issued creates **rev 2** and both sides
re-sign. Rev 1 stays readable forever.

### 5.9 Kickoff packs — three tiers, auto-selected

Tier is chosen from **stage/milestone count**, with a manual override.

| Tier | When | Sections | Contains |
|---|---|---|---|
| **Job Sheet** | 1 stage | 6 | The accepted quote, inclusions, exclusions, one stage's proof, access, signatures |
| **Kickoff Pack** | 2–3 | 9 | + access & dates, variation procedure, dispute route |
| **Pack + Programme** | 4+ | 12 | + dated programme, materials schedule reconciled against receipts, named professionals outside scope |

`jobSheet()` is built **from the accepted quote** — the worker's own inclusions and exclusions,
verbatim, with the money split labour / materials / Yaadly fee / total. Copy that must survive:
*"This is the quote you accepted, written down so neither of you can remember it differently in a
fortnight. That is the whole job of this document."*

### 5.10 `completionReport(kind)`

Seven sections: what was done · before and after at matched angles · evidence index with bundle
fingerprint · **variations** · four confirmations (worker, reviewer, client, payment) · what this
report is not · 12-month aftercare.

*"The worker writes no paperwork."* Drafted by `yaad-completion` from the evidence, confirmed by
the worker as true, reviewed by a person, then delivered.

**Section 6 is legally load-bearing** and must be reproduced exactly: not legal advice, no title
verified, no boundary identified, no structure certified — those are for an attorney-at-law, a
commissioned land surveyor and a PERB-registered engineer respectively. Plus the CRA 2015 s49
reasonable-care-and-skill line, which cannot be excluded and therefore costs nothing to state.

### 5.11 `reviewPicker()` — independent review at sign-off

Offered at **Scope agreed** (where it is actually decided and priced) and again at final evidence.

| Option | Price | Who |
|---|---|---|
| No reviewer | Included | The client, from the evidence pack |
| **Visual Check** | £149 (£95 founding) | A trained checker. Records, does not rate or certify |
| **Technical Sign-off** | £300 (£245 founding) | A qualified trade inspector. Assessed against the trade standard |

Plus **Live viewing — £40, any rung.** Default is: the inspection happens, the report follows.
Live viewing opens a video call from site so the client watches in real time and can ask for a
closer look while the inspector is still standing there.

Standing warning under all options: **"Visits not agreed at the start are chargeable."**

### 5.12 `reviewBox()` — two-way reviews

Client reviews worker; worker reviews client. **Both job-bound**: you can only review a job that
exists, that you were party to, and that is signed off. Sealed until both are written or 14 days
pass. One public reply, no deletion. Yaad Score recalculates from signed-off jobs only, by
DB trigger, once per job.

---

## 6 · Data mapping

| Component | Reads | Writes |
|---|---|---|
| Stage rail | `jobs.status` | — |
| `calBand` | `worker_availability`, `visits` | `visits` |
| `ledger` / `svcLedger` | `kickoff_packs.stages`, `evidence`, `payments` | — |
| `evGrid` | `evidence` | `evidence` (upload) |
| `fingerprint` | `evidence.sha256` | set at insert |
| `jobChat` | `messages` | `messages` (scrubbed) |
| `quotesList` / `quoteDetail` | `job_quotes` | — |
| `scopeDoc` | `jobs.scope`, `scope_agreements` | `scope_agreements` |
| `docsX` | `doc_signatures`, `kickoff_packs` | — |
| `msEditor` | `kickoff_packs` (latest rev) | new rev, never UPDATE |
| `kickoffPack` / `jobSheet` | `kickoff_packs`, `job_quotes` | — |
| `completionReport` | `evidence`, `payments`, `variations` | — |
| `reviewPicker` | `jobs.reviewer_tier`, `jobs.live_view` | both |
| `disputeBlock` | `disputes` | `disputes` |
| `reviewBox` | `reviews` | `reviews` |

**New columns required:** `jobs.budget_band` (client-only — never selected in a worker query),
`jobs.reviewer_tier`, `jobs.live_view`. **New tables:** `visits`, `worker_availability`,
`scope_agreements`, `variations`, `messages`.

---

## 7 · Build order

1. **Shared shell** — `pside` switch, stage rail, `drawJourney()`, tiles. Static data.
2. **Calendar band** — three views, availability toggle, slot booking. Highest-risk UI; do it early.
3. **Ledger + evidence grid + fingerprint** — the spine. Everything else hangs off it.
4. **Documents rail** — `docsX`, then `kickoffPack` / `jobSheet` tiering, then `completionReport`.
5. **Chat + scrub.** Portal-only first; wire the WhatsApp relay after.
6. **Scope gate + quotes + quote builder.**
7. **Milestone editor** — with focus preservation and rev discipline.
8. **Reviewer picker + live viewing.**
9. **Dispute state machine**, worker-first.
10. **Two-way reviews + Yaad Score trigger.**

---

## 8 · Acceptance tests

Run headless at **390 / 768 / 1280 / 1600**. All four must report **zero horizontal overflow** and
**zero JS errors**.

- [ ] Calendar visible at the top on load, in all three portals, without any click
- [ ] Worker opens a day → client sees it as bookable → client books → day goes pending → worker confirms → day goes booked and closes for others
- [ ] Every stage of all three journeys renders its mapped components with no console error
- [ ] Job shape switches 1 / 2 / 3 / 5 and the ledger, rail and pack tier all follow
- [ ] Pasting an email, a phone number, a spelled-out number or "whatsapp" into chat is blocked with a reason shown
- [ ] Choose is locked until both sides tick the scope
- [ ] Milestone edit: percent total goes coral off 100%, teal at 100%, and typing does not lose focus
- [ ] Pack tier: 1 stage → Job Sheet · 2–3 → Kickoff Pack · 4+ → Pack + Programme, and the document row renames itself
- [ ] Completion Report renders at close on both journeys with its section 6 intact
- [ ] Dispute: raise → worker sees it first → resolve direct, and separately → escalate
- [ ] **A worker-side render contains no price band anywhere.** Grep the worker DOM for `band` and for the client's budget value — both must be absent
- [ ] Reviews are unwritable against a job the account was not party to

---

## 9 · Do not

- Do not put the calendar behind a toggle.
- Do not fix the stage count at two.
- Do not show a price band to a worker, or select `budget_band` in any worker-context query.
- Do not let a worker be chosen before the scope is agreed by both sides.
- Do not UPDATE an issued `kickoff_packs` row — insert a new revision.
- Do not auto-publish a Completion Report — a person reviews it first.
- Do not rewrite the copy. It has been through many rounds and is decided.
