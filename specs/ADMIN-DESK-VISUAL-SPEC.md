# Visual spec — Admin desk, aligned to the platform

**For:** Claude Code, updating `desk/desk.html`
**Reference implementations:** `preview/index.html` (portals, marketplace, homepage) ·
`desk/desk.html` (current desk)
**Version:** 1.0 · 26 August 2026
**Companions:** `docs/HOMEPAGE-VISUAL-MAP.md` · `docs/PORTALS-BUILD-SPEC.md` · `docs/MARKETPLACE-BUILD-SPEC.md`

---

## 0 · What this is, and what it is not

The desk **already uses the right tokens.** This is not a redesign — it is an alignment pass with
two jobs:

1. **Close the visual drift** — radii, buttons, headings, semantic colour discipline
2. **Stop rebuilding components that already exist.** The portals now have a calendar band, an
   evidence grid with fingerprints, a stage rail, a money ledger, a documents rail, a vetting
   record and a structured job card. The desk currently has its own near-versions of several of
   these. **Use the platform's.**

The second job matters more. When Monique reviews a stage in the desk and the client sees the same
stage in their portal, they should be looking at the same component with the same colours in the
same order. Anything else means two things to maintain and two ways to be wrong.

---

## 1 · Token reconciliation

The desk's tokens are correct and unchanged. Two fixes:

### 1.1 Add the missing radius token

```css
--r:14px;   /* the desk does not define this; the rest of the site does */
```

Then replace every literal in the desk:

| Current | Becomes |
|---|---|
| `border-radius:12px` on `.card`, `.tile` | `var(--r)` |
| `border-radius:11px` on `.alert` | `12px` (matches `.rule` on site) |
| `border-radius:8px` on `.btn` | **`100px`** — see §1.3 |
| `9px` on `.rlink`, `.srch` | keep — rail and inputs are correct |

### 1.2 Retire the semantic aliases

The desk defines `--ok`, `--warn`, `--crit` as aliases for teal, mango and coral. **Delete them and
use the real names.** The aliases hide the fact that the platform already assigns these meanings:

| Token | Means, everywhere on the platform |
|---|---|
| `--tealb` | **Proven.** Signed off, released, verified, passed |
| `--mango` | **Held.** Waiting on somebody, a decision owed, money not yet moved |
| `--coral` | **Blocked.** Risk, excluded, failed, needs attention |

An alias lets a future developer put `--warn` on something that is not "waiting" and nobody
notices. Class names stay (`.chip.warn`, `.alert.crit`) — the *variables* go.

### 1.3 Buttons become pills

Every button on the platform is `border-radius:100px`. The desk uses 8px. Change it.

```css
.btn   { border-radius:100px; background:var(--grad); color:#04211D }
.btn.g { border-radius:100px; background:transparent; border:1px solid var(--line) }
.btn.d { border-radius:100px; background:rgba(255,107,74,.12); border:1px solid rgba(255,107,74,.4); color:var(--coral) }
```

Add `--grad:linear-gradient(90deg,#14B8A6,#FFB020)` — the desk does not have it, and the primary
button should carry it exactly as the site's does.

### 1.4 Headings

Anton is currently only on `.mark`, `h1.vh` and `.v`. Extend it:

```css
.vh, .card h3, .modal h3 {
  font-family:var(--disp); font-weight:400; text-transform:uppercase;
  line-height:.95; letter-spacing:.005em;
}
```

`.sechd` already matches `.kick` — 10px, weight 700, `.2em` tracking, uppercase. Change its colour
from `--dim` to **`--tealb`** so section eyebrows read the same as the rest of the site.

---

## 2 · Layout — keep it

The two-column shell is right for an operator tool and should not become the site's centred
`.wrap`. A desk is scanned and operated; a page is read.

```
┌──────────┬───────────────────────────────────────────────┐
│ 236px    │  sticky top bar — search, filters, actions    │
│ rail     ├───────────────────────────────────────────────┤
│ sticky   │                                               │
│ 100vh    │  view content — max-width 1180px, padding 22px│
│          │                                               │
└──────────┴───────────────────────────────────────────────┘
```

Add a **mobile breakpoint the desk currently lacks.** Monique will open this on a phone.

```css
@media(max-width:820px){
  .shell { grid-template-columns:1fr }
  .rail  { position:static; height:auto; border-right:0; border-bottom:1px solid var(--line) }
  .rgrp  { display:none }          /* group labels off */
  .rail nav { display:flex; overflow-x:auto; gap:6px }   /* links become a scroll row */
}
```

---

## 3 · The rail — keep the grouping, add counts

Five groups, fourteen views. The grouping is good and should not change.

```
RUN THE DAY        Overview · Intake · Jobs · Evidence · Quotes
PEOPLE             Workers · Clients · Reviews
DOCUMENTS & MONEY  Kickoff desk · Signatures · Money
SERVICES           PM pipeline
SYSTEM             Health · Settings
```

**Counts belong on the rail, and their colour is the semantic rule doing work:**

| State | Colour | Example |
|---|---|---|
| Nothing waiting | no badge | — |
| Waiting on Monique | **mango** | `Evidence 4` — four sets need her eyes |
| Blocked or overdue | **coral** | `Disputes 1` — open, nothing moving |

A rail with no colour means the day is clear. That is the single most useful thing the desk can
tell her at a glance.

---

## 4 · Components to adopt from the platform

This is the substance of the alignment. Each row: what the desk has now, what it should use.

| Desk area | Currently | Use instead | From |
|---|---|---|---|
| **Evidence review** | `.evgrid`, its own grid | **`evGrid()` + `fingerprint()`** | Portals §5.3 |
| **Job status** | `.stg` — 104px bar of segments | **The stage rail `.jst`**, done/now/todo | Portals §1 |
| **Money** | Tiles and tables | **`ledger()`** — per stage, required proof, released | Portals §5.2 |
| **Kickoff desk** | Bespoke | **`kickoffPack()` / `jobSheet()`** with tier auto-select | Portals §5.9 |
| **Signatures** | List | **`docsX()`** clickable rows opening the real document | Portals §5.7 |
| **Worker vetting** | Its own queue | **`.vrec` / `.vitem`** with PASS · GAP · BLOCK | Join journey §7 |
| **Intake** | Free-text triage | **The structured job card** with source badges | Marketplace §2.3 |
| **Disputes** | Status only | **`disputeBlock()`** state machine, read-only view | Portals §5.6 |
| **Calendar** | **Does not exist** | **`calBand()`** — see §5 | Portals §5.1 |

**Rule:** if a component exists in `preview/index.html`, the desk imports it rather than
approximating it. Where the desk needs an operator affordance the client version does not have
(bulk actions, an override), add it *around* the component, not by forking it.

---

## 5 · The calendar the desk is missing

Every portal puts the calendar at the top, always visible. **The desk has no calendar at all**, and
it is the surface that needs it most — Monique is the only person who sees every visit across every
job and every service.

Add it to **Overview**, above the tiles, as a fourth calendar view:

| View | Sees | Can do |
|---|---|---|
| Worker | Their own diary | Open and close days |
| Client | Days their worker opened, their job only | Request a slot |
| Service | Monique's open days | Book a call or visit |
| **Admin** | **Every visit, every job, every worker** | Confirm, reassign, flag a clash |

Same `calBand()` component, same day states, one addition: a **clash indicator** where two visits
need the same person at the same time. Coral, because it is blocked.

---

## 6 · The Overview view

The one screen that answers "what needs me today". Order matters.

```
┌────────────────────────────────────────────────────────┐
│ CALENDAR BAND — every visit, all jobs                  │  §5
├────────────────────────────────────────────────────────┤
│ ┌──────┬──────┬──────┬──────┬──────┐                   │
│ │Evid- │Quotes│Money │Vetting│Disp- │                  │  .tiles
│ │ence 4│  7   │held  │queue 2│utes 1│                  │  auto-fit 168px
│ │mango │      │      │mango  │coral │                  │
│ └──────┴──────┴──────┴──────┴──────┘                   │
├────────────────────────────────────────────────────────┤
│ NEEDS YOU NOW                                          │  .sechd, tealb
│ ⚠ JB-4468 stage 2 evidence — waiting 2 days   [Review] │  .alert.warn
│ ✕ JB-4452 dispute open — nothing moving      [Open]    │  .alert.crit
├────────────────────────────────────────────────────────┤
│ TODAY                                                  │
│ 08:00 Barbican · Delroy · JB-4471 stage 2   [confirmed]│
│ 13:00 Liguanea · Everton · JB-4468 sign-off [pending]  │
└────────────────────────────────────────────────────────┘
```

**Tile anatomy** — keep the existing shape, apply the colour rule:

```
┌────────────────────┐
│ EVIDENCE           │  label — 10px mono, --dim, uppercase
│ 4                  │  .num — Anton, 30px, semantic colour
│ waiting on you     │  .sub — 11.5px, --mute
│ ▁▂▄▆█▅▃            │  .spark — 22px, 2px bars
└────────────────────┘
```

The number takes its colour from state: **teal** when zero and clear, **mango** when waiting on
her, **coral** when blocked. A screen of teal numbers means the day is done.

---

## 7 · Chips and alerts

Already close. Two corrections:

**Chips** keep their shape (10.5px, weight 700, `.05em`, uppercase, pill) and their dot variant.
Fix the vocabulary so it matches the platform:

| Chip | Use for |
|---|---|
| `.chip.ok` teal | Signed off · released · verified · passed |
| `.chip.warn` mango | Waiting · held · pending confirmation · GAP |
| `.chip.crit` coral | Blocked · overdue · failed · BLOCK · dispute open |
| `.chip.mute` | Neutral facts — reference numbers, dates, counts |

**Alerts** — change radius 11px → 12px to match `.rule`, and give every alert an **action button on
the right**. An alert with nothing to do is a notification, and notifications belong in the tile
row, not in "Needs you now".

---

## 8 · Evidence review — the desk's most-used screen

This is where Monique spends her time, and it must be the same object the client sees.

```
┌────────────────────────────────────────────────────────┐
│ JB-4471 · Stage 2 · Delroy Campbell        [Barbican]  │
│ ①─②─③─④─⑤─⑥─⑦─⑧   ← the platform stage rail          │
├────────────────────────────────────────────────────────┤
│ REQUIRED — from the Kickoff Pack                       │
│ ✓ Cupboard base before removal                         │
│ ✓ Empty cupboard after removal                         │
│ ✓ Waste loaded and away                                │
│ ○ Final clean-down, one clip          ← missing, coral │
├────────────────────────────────────────────────────────┤
│ [ evGrid — filed evidence, same component as portal ]  │
│ sha256 · c81f5a90d7be24361ac0f9e5b7d3128e64ab0f27…     │
├────────────────────────────────────────────────────────┤
│ [ Pass this stage ]  [ Send back with a note ]         │
│ Passing releases J$26,720 to Delroy. Nothing else.     │
└────────────────────────────────────────────────────────┘
```

**The checklist comes from the Kickoff Pack, not from what was uploaded.** A missing item shows as
an unfilled coral circle — the absence is the finding.

**Every irreversible action states its consequence in the same sentence as the button.** Passing a
stage moves money. Say the number.

---

## 9 · Worker vetting — reuse the join journey's component

The desk's vetting queue should be the same `.vrec` / `.vitem` list a worker sees on their own
application, with the operator's verdict controls added:

```
┌────────────────────────────────────────────────────────┐
│ Delroy Campbell · applied 24 Aug · Roofing, Plumbing   │
│ St Catherine, Kingston                                 │
├────────────────────────────────────────────────────────┤
│ ✓ Government photo ID, live video      PASS      teal  │
│ ✓ TRN verified                         PASS      teal  │
│ ! Proof of address                     GAP      mango  │
│   Dated 4 months ago. Needs one inside three.          │
│ ✓ 3 references — confirmed and called  PASS      teal  │
├────────────────────────────────────────────────────────┤
│ yaad-docs flagged 2 · a person decides                 │
│ [ Pass ]  [ Send the gap back ]  [ Block ]             │
└────────────────────────────────────────────────────────┘
```

**PASS · GAP · BLOCK** is the vocabulary already used in the join journey. A GAP names the document
and clears when it arrives. A BLOCK is a safety finding and is said plainly. **The agent flags; a
person decides** — never an auto-pass.

---

## 10 · Money view

Use `ledger()`, plus an operator summary the client version does not need:

```
HELD          J$412,300   across 6 jobs        mango
DUE OUT       J$158,400   approved, unpaid     mango
PAID, 30 DAYS J$680,100                        teal
FEES, 30 DAYS J$91,800    27% blended          teal
```

**Never show a client's budget band in this view.** It exists nowhere on the platform except the
client's own job card, and the desk is not an exception.

---

## 11 · Motion

The desk gets **less** motion than the site, not more. An operator tool that animates is a tool
that wastes your time.

| Allowed | Where |
|---|---|
| `.fade` 300ms | View change |
| `.spin` 700ms | Agent working |
| Hover transitions 140ms | Rail links, buttons, cards |

**No trust engine. No pulsing dots. No looping sequences.** Those are on the marketing page to
persuade a stranger. Monique is already persuaded.

All wrapped in `prefers-reduced-motion`.

---

## 12 · Change list

- [ ] Add `--r:14px` and `--grad`; replace literal radii on `.card` and `.tile`
- [ ] Delete `--ok` / `--warn` / `--crit`; use `--tealb` / `--mango` / `--coral`
- [ ] `.btn` variants → `border-radius:100px`; primary carries `--grad`
- [ ] Anton on `.vh`, `.card h3`, `.modal h3` — uppercase, `line-height:.95`
- [ ] `.sechd` colour `--dim` → `--tealb`
- [ ] `.alert` radius 11px → 12px; every alert gets an action button
- [ ] Add the `≤820px` breakpoint; rail collapses to a scroll row
- [ ] Add rail counts, coloured by state
- [ ] **Add `calBand()` to Overview** with the admin view and clash indicator
- [ ] Replace `.evgrid` with `evGrid()` + `fingerprint()`
- [ ] Replace `.stg` with the platform stage rail
- [ ] Money view uses `ledger()`
- [ ] Kickoff desk uses `kickoffPack()` / `jobSheet()` with tier auto-select
- [ ] Signatures uses `docsX()` opening the real documents
- [ ] Vetting uses `.vrec` / `.vitem` with PASS · GAP · BLOCK
- [ ] Intake uses the structured job card with source badges
- [ ] Every irreversible action states its consequence beside the button

---

## 13 · Acceptance tests

Headless at **390 / 768 / 1280 / 1600**. Zero horizontal overflow, zero JS errors.

- [ ] Rail collapses to a horizontal scroll row below 820px
- [ ] A clear day shows no coloured rail counts and no coloured tile numbers
- [ ] Calendar band on Overview shows visits across **all** jobs, not one
- [ ] A double-booked worker shows a coral clash indicator
- [ ] Evidence review renders the same `evGrid` and fingerprint the client portal renders
- [ ] A missing checklist item shows as an unfilled coral circle
- [ ] Pass button states the exact amount it releases
- [ ] Vetting shows PASS · GAP · BLOCK; a GAP names its document
- [ ] **Grep every desk view for `budget_band` — absent**
- [ ] No looping animation anywhere in the desk

---

## 14 · Do not

- Do not fork a component that exists in the platform — import it.
- Do not reintroduce `--ok` / `--warn` / `--crit` as tokens.
- Do not use mango or coral decoratively. Held and blocked, nothing else.
- Do not show a client's budget band anywhere in the desk.
- Do not add looping animation.
- Do not put an irreversible action next to a button that does not say what it does.
- Do not auto-pass a vetting check. The agent flags; a person decides.
