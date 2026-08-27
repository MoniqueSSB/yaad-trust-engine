# Visual map — Homepage

**For:** Claude Code, updating `docs/index.html`
**Reference implementation:** `preview/index.html`, screen `#s-home`
**Version:** 1.0 · 26 August 2026

Eight sections, 1,358 words, 5,543px at 1280. Cut down from 1,966 words and 6,528px — the
reduction was the point, so do not add sections back without removing others.

---

## 1 · Design tokens — copy exactly

```css
:root{
  /* ground */
  --bg:#08110F;        /* page */
  --panel:#0F1B17;     /* cards */
  --panel2:#14231E;    /* raised */
  --line:#1F332C;      /* borders */
  --line2:#284439;     /* emphasis borders */

  /* text */
  --ink:#F2FAF7;       /* headings, emphasis */
  --mute:#9DB8AE;      /* body */
  --dim:#67807A;       /* captions, sources */

  /* semantic — these carry meaning, not decoration */
  --teal:#14B8A6;      /* proven, safe */
  --tealb:#2DD4BF;     /* accent, released */
  --mango:#FFB020;     /* HELD, waiting, your call */
  --coral:#FF6B4A;     /* risk, blocked, not doing */
  --sand:#FDE68A;

  /* fills */
  --soft:#0F2B26;
  --softline:#1E4A42;
  --grad:linear-gradient(90deg,#14B8A6,#FFB020);

  /* type */
  --disp:'Anton',Impact,sans-serif;
  --body:'Space Grotesk',-apple-system,sans-serif;
  --mono:'JetBrains Mono',ui-monospace,monospace;

  --r:14px;
}
```

**Semantic colour is load-bearing.** Mango always means money is held or a decision is owed. Coral
always means blocked or excluded. Teal always means proven. Never use any of the three decoratively.

### Type scale

| Class | Spec |
|---|---|
| `.hx` | Anton, weight 400, **uppercase**, `line-height:.95`, `letter-spacing:.005em`, `text-wrap:balance` |
| `.lead` | `--mute`, 16.5px, **`max-width:62ch`**, `margin-top:14px` |
| `.kick` | 10.5px, weight 700, `letter-spacing:.2em`, uppercase, `--tealb` (`.kick.m` = mango) |
| `.tiny` | 12.5px, `--mute` |
| `.mono` | JetBrains Mono — references, amounts, hashes, timestamps only |

### Layout constants

```css
.wrap { max-width:1080px; margin:0 auto; padding:0 20px }
.sec  { margin-top:64px }                    /* the only vertical rhythm */
.grid { display:grid; gap:14px }
.g2c/.g3c/.g4c → repeat(2|3|4, 1fr)
```

Buttons are **pill-shaped** — `border-radius:100px`. Primary carries `--grad` with `#04211D` text.
Cards are `--r` = 14px. Nothing on this page is square.

---

## 2 · Section order and weight

| # | Kicker → Heading | Height | Blocks |
|---|---|---|---|
| 0 | *(none)* → **Everyone promises proof. Money moves when you see it.** | 816px | pills · hx · lead · avail · searchcard · strip · rule |
| 1 | The verified job loop → **Six steps. Proven, not promised.** | 450px | kick · hx · isteps · rule |
| 2 | Start where you already are → **Begin on WhatsApp. Finish on the site.** | 859px | kick · hx · lead · walane |
| 3 | What you're paying for → **Money moves when the proof lands.** | 893px | kick · hx · lead · **engine** · lead · icmp · rule ×2 · cta |
| 4 | Popular trades → **What people are hiring for** | 292px | kick · hx · g4c · cta |
| 5 | Ask a Yaad → **Free answers from tradespeople** | 371px | kick · hx · lead · g2c · cta |
| 6 | Three ways in → **Whichever you need** | 321px | kick · hx · g3c |
| 7 | Straight answers → **Your honest opinion** | 1541px | feedback card · FAQ card · founder card |

---

## 3 · Section 0 — Hero

```
┌────────────────────────────────────────────────────────┐
│ [Yaadly Ltd · UK 17358077] [Jamaica · Kingston first]  │  .pills
│                                                        │
│ EVERYONE PROMISES PROOF.                               │  .hx — "proof." in
│ MONEY MOVES WHEN YOU SEE IT.                           │  gradient span .g1
│                                                        │  "when you see it."
│ Vetted tradespeople. Money held until you approve the  │  in .g2
│ proof. Property work across Jamaica — Kingston and     │  .lead
│ Portmore first.                                        │
│                                                        │
│ ✅ Available today: free scoping call                  │  .avail
│ 🕓 Opening shortly: checks, oversight, full PM         │
│                                                        │
│ ┌────────────────────────────────────────────────────┐ │
│ │ What do you need done?    Where is it?             │ │  .searchcard
│ │ [text input           ]   [parish select ▾]        │ │  panel bg,
│ │              [ Post a job — free ]                 │ │  line2 border,
│ └────────────────────────────────────────────────────┘ │  radius 18px,
│                                                        │  deep shadow
│ ┌──────────┬──────────┬──────────┬──────────┐          │
│ │US$3.49bn │No public │3 working │  Free    │          │  .strip — 4 cols,
│ │sent home │price     │days      │to join   │          │  1px gaps showing
│ └──────────┴──────────┴──────────┴──────────┘          │  --line through
│                                                        │
│ 🤖 The governing rule: AI drafts. A human confirms     │  .rule
│    every step that moves money or changes a reputation.│
└────────────────────────────────────────────────────────┘
```

**`.searchcard` is the only element on the page with a shadow** — `0 20px 50px -30px #000`. It
floats because it is the primary action.

**`.strip`** uses a 1px grid gap over a `--line` background so the dividers *are* the gaps. Do not
draw borders between cells.

---

## 4 · Section 1 — The verified job loop

Six `.ist` cards, `repeat(3,1fr)`, 12px gap.

```
┌─────────────────────┐
│ ⌁ icon      01       │  .ih — 22px stroke SVG in --tealb, number in mono/--dim
│ Tell us what needs   │  h4, 14.5px, --ink
│ doing                │
│ Form, WhatsApp,      │  p, 12.5px, --mute
│ voice note, Patois.  │
│ No app.              │
│ 🤖 AI reads it       │  .tag — 10px mono, --dim
└─────────────────────┘
```

Hover: `border-color:var(--teal)` + `translateY(-2px)`, 160ms.

The six, in order, with their glyphs:

| # | Icon | Heading | Who |
|---|---|---|---|
| 01 | chat bubble | Tell us what needs doing | 🤖 AI reads it |
| 02 | document | An itemised quote | 🤖 AI drafts · 🧍 we confirm |
| 03 | coins | Money held, not sent | 🧍 you confirm |
| 04 | camera | Every stage documented | 🤖 AI checks · 🧍 we confirm |
| 05 | check circle | You approve, from anywhere | 🧍 you decide |
| 06 | shield check | Worker paid in 3 days | 🧍 released on your say so |

Icons are **inline stroke SVGs**, `stroke:currentColor`, `stroke-width:1.6`, 22×22. No icon font,
no image files.

Breakpoints: `≤820px` → 2 columns · `≤520px` → 1.

---

## 5 · Section 2 — WhatsApp lane

`.walane` = `320px | 1fr`, 20px gap. Collapses to one column at 820px.

**Left: one phone.** Not two — the two-phone version was removed deliberately, because two WhatsApp
mockups as the emotional centre told visitors the product *is* a chat with Monique.

```
┌──────────────────────┐
│ (Y) Yaadly           │  .wafone — #060D0B, radius 24px
│     replies in mins  │  avatar #25D366 (WhatsApp green)
│ ┌──────────────────┐ │
│ │ ▶ 0:38 voice note│ │  .wb.them — panel2, left-aligned
│ │ Evening. Di zinc │ │
│ │ lift…       19:42│ │
│ │                  │ │
│ │   Got it. Before │ │  .wb.me — soft, right-aligned
│ │   I write this   │ │
│ │   up…      19:47 │ │
│ │                  │ │
│ │ ┌──────────────┐ │ │
│ │ │Saved as draft│ │ │  .wb.sys — mango tint, centred
│ │ │No worker can │ │ │
│ │ │see this yet. │ │ │
│ │ └──────────────┘ │ │
│ └──────────────────┘ │
└──────────────────────┘
```

**Right:** four `.ist` cards in 2×2 — *You message us · The agent reads it · A draft appears ·
**You sign, here***. The fourth carries `.ist.gate` — mango border and tint. It is the gate and it
should look like one.

Below: two `.icol` columns — *Stays on WhatsApp* (teal ticks) vs *Only on the site* (mango, on a
warm-tinted panel).

---

## 6 · Section 3 — The trust engine

**The one animated moment on the page.** It replaces roughly 200 words of argument.

```
┌──────────────────────────────────────────────────────────┐
│  ┌──────────────┐    ┌────┐    ┌──────────────┐          │
│  │     YOU      │    │ 🔒 │    │ DELROY       │          │  .eng-stage
│  │  J$66,800    │    │HELD│    │   J$0        │          │  1fr | 118px | 1fr
│  │Funding stage │    └────┘    │Can see the   │          │
│  │     one      │              │money is real │          │
│  └──────────────┘              └──────────────┘          │
│   .eng-box.held                 .eng-box.paid            │
│   mango border + tint           amount in --tealb        │
│                                                          │
│  ┌────┬────┬────┬────┬────┬────┐                         │
│  │📍  │📷  │🧾  │📷  │🎥  │✓   │                         │  .eng-ev
│  │Arr │Bef │Rec │Aft │Walk│Sign│                         │  6 cols, 52px
│  └────┴────┴────┴────┴────┴────┘                         │  dashed → solid
│                                                          │
│  ● Nothing has moved. He starts because he can see the   │  .eng-cap
│    money is real, not because you sent it.               │  pulsing dot
└──────────────────────────────────────────────────────────┘
```

### Animation sequence

Triggered by IntersectionObserver at `threshold:.3`, once. 600ms delay, then **1250ms per step**.

| Step | Tile lights | Caption | You | Worker | Lock |
|---|---|---|---|---|---|
| 1 | Arrival | "Arrival photos landed, geotagged 09:41." | J$66,800 | J$0 | 🔒 Still held |
| 2 | Before | "The damage, before he touched it." | — | — | 🔒 |
| 3 | Receipt | "Materials bought — receipt filed against the job." | — | — | 🔒 |
| 4 | After | "Same angle, after. That is the standard." | — | — | 🔒 |
| 5 | Walk-round | "Walk-round clip. Nothing hidden off camera." | — | — | 🔒 Evidence complete |
| 6 | You sign | **"You signed it off. Released — and only now."** | **J$0** | **J$66,800** | **🔓 Released** |

Then a 3600ms hold, reset, and loop.

On step 6 the container gains `.open`: the mid column flips `--mango` → `--tealb`, the lock emoji
swaps 🔒 → 🔓, and the pulsing dot stops.

Tile states: `1px dashed --line` at 45% icon opacity → `.on` = solid `rgba(45,212,191,.45)` border,
`rgba(45,212,191,.07)` fill, full opacity. Transition 450ms.

```css
@keyframes bl { 0%,100%{opacity:1} 50%{opacity:.25} }   /* .eng-dot, 1.4s */
```

**`prefers-reduced-motion`:** render the *finished* state — all six tiles on, lock open, money moved,
final caption. Never the start state, or the page tells the wrong story.

Below the engine: `.icmp` two columns — *For property owners* / *For tradespeople*, four `.iline`
rows each with teal glyphs. Then two `.rule` blocks (Mirror Rule, scope edge) and a CTA pair.

---

## 7 · Sections 4–7

**4 · Popular trades** — `.g4c` of trade cards: icon, name, open job count. Button through to all 18.

**5 · Ask a Yaad** — `.g2c` of question cards: question, asker's area, answer, answering worker.

**6 · Three ways in** — `.g3c`: post a job · bring your own contractor · join as a pro.

**7 · Straight answers** — three stacked cards: feedback form (1–5 trust scale, who-are-you chips,
two text fields), FAQ accordion (6 open + 6 behind "Show the other 6 questions"), founder card
(avatar, credentials, the ethos quote, company number).

The tallest section on the page at 1541px, but mostly collapsed FAQ — it reads short.

---

## 8 · Responsive

| Breakpoint | Changes |
|---|---|
| ≤940px | `.jlane` → 1 col |
| ≤900px | `.walive` → 1 col |
| ≤860px | `.calband` → 1 col |
| ≤820px | `.isteps` → 2 cols · `.walane` → 1 col |
| ≤760px | `.icmp`, `.split2` → 1 col |
| ≤720px | `.eng-stage` → 1 col |
| ≤640px | `.jfrow`, `.pkgrid`, `.wzdate` → 1 col |
| ≤560px | `.eng-ev` → 3 cols |
| ≤520px | `.isteps` → 1 col |
| ≤460px | calendar cell sizing — **without this the grid overflows by 2px** |

**Verified: zero horizontal overflow at 390 / 768 / 1280 / 1600.** Any change must hold that.

---

## 9 · Motion inventory

| Where | What | Duration |
|---|---|---|
| Trust engine | Six-step sequence, loops | 1250ms/step, 3600ms hold |
| `.eng-dot` | Opacity pulse while held | 1.4s infinite |
| `.lvface` | Head turn ±38° on the liveness explainer | 3.2s infinite |
| `.ist:hover` | Lift 2px + teal border | 160ms |
| `.fade` | Entry on stage change | 300ms |
| `.spin` | Agent thinking indicator | 700ms |

That is the whole list. **Everything else on this page is static.** Scattered animation is the
tell of a generated design; one orchestrated moment lands harder than six small ones.

All motion is wrapped in `@media(prefers-reduced-motion:reduce)`.

---

## 10 · Rules for changing this page

- **Do not add a section without removing one.** It went 1,966 → 1,358 words on purpose.
- **Do not add animation.** One moment, deliberately.
- **Do not use mango, coral or teal decoratively.** Held, blocked, proven — nothing else.
- **Do not restore the two-phone WhatsApp section.** It argued the product is a chat.
- **`.lead` keeps `max-width:62ch`.** Full-width body text at 1080px is unreadable.
- **`.searchcard` keeps the only shadow.** Two shadows and neither floats.
- **Icons stay inline SVG**, `currentColor`, 1.6 stroke. No icon fonts, no image files.
- **Reduced motion shows the engine's *finished* state.** The start state tells the wrong story.
