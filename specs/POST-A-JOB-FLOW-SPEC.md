# Build spec — Post a job, step by step

**For:** Claude Code, building into `docs/index.html`
**Reference implementation:** `docs/preview/index.html`, screens `#s-post` and `#s-done`
**Version:** 1.0 · 26 August 2026
**Companions:** `docs/MARKETPLACE-BUILD-SPEC.md` (where the job lands) · `docs/PORTALS-BUILD-SPEC.md` (what happens next)

---

## 0 · The rule this whole flow exists to enforce

> **Anyone can build a job with no account. It saves as a draft. To go live in the marketplace they
> must sign up AND confirm the Client Guidelines. No signature, no listing.**

Everything below is that sentence turned into six screens. If a decision is ever unclear, this rule
settles it.

A second rule sits alongside it:

> **No AI agent touches a client's work until they have signed the guidelines and have a profile.
> The first job is a fully manual intake.**

That is what the `guest` / `member` toggle in §1 is for. It is not a demo gimmick — it is two
genuinely different experiences of the same six steps.

---

## 1 · Entry points

Every one of these lands on `#s-post`, step 1:

| Where | Element |
|---|---|
| Nav bar | `Post a job — free` (gradient pill, always visible) |
| Hero search card | `Post a job — free` after what/where |
| Mirror rule section | `Start a job` |
| Trust engine section | `Start a job` |
| Trades screen | Any trade card — **pre-selects that trade and jumps to step 2** |
| WhatsApp section | `Or type it in here` |

The trade-card path is the one people miss. Clicking a trade sets `chosen`, enables step 1's
Continue, and advances — a visitor who came in via "Roofing" should not be asked what trade they want.

---

## 2 · Wizard shell

```
┌──────────────────────────────────────────────────────────┐
│  [ Visitor · no account ]  [ Signed in · guidelines on   │  mode toggle
│                              file ]                       │
│  <mode note — changes with the toggle>                    │
├──────────────────────────────────────────────────────────┤
│  ①──②──③──④──⑤──⑥                                        │  #rail
│  Trade Details Photos Where&when Account Guidelines      │
├──────────────────────────────────────────────────────────┤
│                                                          │
│              < the active .wstep >                       │
│                                                          │
│  [ Back ]                        [ Continue ]            │
└──────────────────────────────────────────────────────────┘
```

`setStep(n)` shows one `.wstep`, updates `#rail`, scrolls to top. Rail labels:
**Trade · Details · Photos · Where & when · Create account · Guidelines & go live**.

### The mode toggle — `applyMode(m)`

| | `guest` | `member` |
|---|---|---|
| Note | "No account yet. Everything is typed by hand — **no agent runs until the Client Guidelines are signed and a profile exists.**" | "Guidelines signed, profile live. Agents run inside the wizard and stay on the job through evidence and sign-off." |
| Step 2 | Manual note shown, `Tidy this up for me` hidden | Assistant button shown |
| Step 3 | Manual note shown, no photo read | `yaad-vision` reads the photos |
| Step 5 | "Create your account", password field shown | "Confirm your details", pulled from profile |
| Step 6 | Tick + signature required | "Guidelines already on file — no re-signing" |

**In production `mode` is not a toggle — it is auth state plus a `doc_signatures` lookup.** Keep the
toggle in the demo build so the two paths stay testable, but drive it from the session in production.

---

## 3 · Step 1 — What do you need done?

> **What do you need done?**
> Pick the closest trade. If it's more than one, pick the main one — we'll sort the rest out from
> your description.

Grid of trade cards from `data/job-taxonomy.js` — 18 trades, icon, name, live open-job count.

- Selecting sets `chosen` and enables `#n1`
- **Continue is disabled until a trade is picked.** No silent no-op
- Selecting a trade from *outside* the wizard jumps straight here and advances

---

## 4 · Step 2 — Tell us about the job

> **Tell us about the job**
> *Guest:* "Plain words are fine. Write it how you'd say it — a person reads it before it reaches the board."
> *Member:* "Plain words are fine. Write it how you'd say it, then let the intake assistant tidy it up and flag what a worker would need to ask."

One textarea. Placeholder is a real example, in real voice:

> *"Water leaking from the pipe under the kitchen sink, been going about a week. Cupboard floor is
> soft now. House is my father's in Barbican, I'm in London."*

### Guest — the manual note

> **No assistant on this one.** Write it however you'd say it out loud — a person reads every job
> before it reaches the board. Once you've signed the Client Guidelines and have a profile, the
> intake assistant tidies your wording and asks the questions workers always come back with.

### Member — `Tidy this up for me`

Calls `yaad-agent`. Spinner ~1100ms, then returns two things:

1. **The tidied brief** — same facts, worker-readable
2. **"Two things workers will ask"** — the questions a tradesperson would come back with

For the demo leak example: *"Is the water still running now, or has the main been shut off?"* and
*"Is the cupboard base chipboard or plywood? It changes whether it dries or gets replaced."*

**The second output is the valuable one.** Anticipating the callback is what makes a job quotable
first time.

### Then — the structured job card

Below the description, the same card everybody fills, guest or member:

> **Then the same job card everybody gets.** Pick from the lists rather than typing. It takes under
> a minute, and it is the reason every job on the board can be filtered, matched and quoted without
> a phone call first. Anything the assistant worked out from your description is already filled in.

Eleven dropdown fields in five sections — see `docs/MARKETPLACE-BUILD-SPEC.md` §2.3 and
`data/job-taxonomy.js`. Every field carries a source badge:

| Badge | Meaning |
|---|---|
| **FROM YOUR MESSAGE** (teal) | Heard it |
| **BEST GUESS — CHECK IT** (mango) | Inferred |
| **YOU NEED TO PICK** (coral) | Blank |

**Money and materials are always coral.** The agent never guesses those.

Cascading: trade → job types · job type → size bands, stage count, evidence checklist.
Keyed **`Trade|Type`**, never `Type` alone.

---

## 5 · Step 3 — Photos

> **Add photos or a short video**
> Jobs with pictures get roughly three times the responses — and far fewer "I'd have to come see it
> first" replies.

Drop zone. On drop, thumbnails appear.

**Guest:** *"Photos go up as they are. Nothing reads them yet. From your second job on, the photo
check tells you what a worker can and can't see before they quote."*

**Member:** `yaad-vision` runs, ~1300ms, and returns two lists:

- **Visible** — what it can actually see: *"a compression joint on a 15mm supply line with staining below it"*
- **Not visible — worth one more photo** — *"The shut-off valve, so a worker knows whether they can isolate it"*

Again the second list carries the value. It gets a better job posted, not a cleverer description.

`Continue` is enabled with or without photos. **Skippable** — the sub-line says
*"You can skip this and add them later."*

---

## 6 · Step 4 — Where and when

> **Where and when**
> The full address is never shown on the public board. Workers only see the area until you choose
> one of them.

| Field | Notes |
|---|---|
| Parish | select |
| Street address | **private**, never on the board |
| Who lets the worker in? | name and number of the person on the ground |
| When do you need it done? | three choices — Urgent 48h · Within two weeks · Flexible |
| **Exact start date** | full month calendar |

### The calendar

Optional, and the helper says why it matters:

> "Optional, but it changes who replies. Workers see it on the job and can say yes or offer the
> nearest day they have. **Days already open in a matching worker's diary are highlighted.**"

Teal days = a matching worker has that day open. Selecting one shows:

> *"At least one matching worker already has this day open. That is a good sign, not a booking —
> nothing is held until you choose somebody and both of you agree the scope."*

Or, on a day nobody has open:

> *"No matching worker has flagged this day open yet. You can still ask for it — workers will either
> take it or offer you the nearest day they have."*

Plus a **"No fixed date — I am flexible"** chip: *"You will get more replies this way, and usually
better prices — a worker can slot it into a gap."*

Past dates disabled. Month nav both directions. The chosen date carries to step 6 as a mango pill.

---

## 7 · Step 5 — Create your account

> *Guest:* **Create your account** — "Your job is already saved as a draft. This is the account it
> belongs to — and it is what lets workers reply to you."
> *Member:* **Confirm your details** — "Pulled from your profile. Change anything that is out of
> date for this job."

Name · Email · Phone or WhatsApp · Password *(guest only)*.

Under the phone field: *"Hidden from workers until you start a chat with one. You control when it's
shared."*

Under the password: *"Or skip it — we can send a one-tap link to your email instead."*

Guest-only note:

> **One screen left.** Your job stays a draft until you confirm the Client Guidelines next. That is
> what puts it in the marketplace — nothing reaches a worker before it.

**The job is already saved at this point.** Say so, and mean it — write the draft row before this
screen renders, not after. Someone who abandons here has a saved draft to come back to.

---

## 8 · Step 6 — Confirm and go live

> **Confirm and go live**
> This is what workers will see. The private bits stay private. Confirm the Client Guidelines and
> your job enters the marketplace.

### The review card

Trade pill · area pill · urgency pill · **exact-date pill** (mango) if one was picked.

Then, split explicitly:

- **Public — workers see this:** the description (tidied if the assistant ran) and the photos
- **Private — never on the board:** street address, phone, and the access contact's number

### The gate — `gateCheck()`

**Guest:**

```
☐  I have read and I agree to the Client Guidelines
   [ Type your full name to sign                    ]

   Confirm & go live   ← disabled until BOTH are true
   "Tick the box and sign to continue"
```

Both conditions: `#gtick.checked` **and** `#sig.value.trim().length > 2`.
When satisfied the hint turns teal: *"Signature captured — this is what makes it live."*

Above the tick, four short guideline clauses in plain words — what Yaadly does · describing the job
honestly · quotes and choosing · your details. Not a link to a PDF nobody opens.

**Member:** button enabled, hint reads *"Guidelines already on file — no re-signing."*

### What the signature does

It is not a checkbox. It is the row that makes the job visible. In production: insert into
`doc_signatures` against the **current version** of `client_guidelines`, and the board query
requires it. A version bump means everyone re-signs.

---

## 9 · The done screen — `#s-done`

Not a thank-you page. A **what-happens-next** page.

```
JB-4471 live in the marketplace · Guidelines v1.1 signed · Plumbing · Kingston 8
```

### Next steps — five, numbered

1. **We sent your job to relevant workers near Barbican, Kingston 8** — `yaad-match` on trade + parish
2. **We email and WhatsApp you when a worker expresses interest** — usually within a few hours in
   Kingston. You'll see their Yaad Score, jobs completed and evidence from past work before you reply
3. **Start a chat to share contact details** — you control when
4. **Choose your worker, agree the stages, fund stage one**
5. **Evidence, sign-off, review**

### Where your money sits

Nothing has been charged. Say it plainly.

### "Your agents just switched on"

Four cards. **This block only appears now**, because the signature is what turned them on — the
page is showing the consequence of the thing they just did:

| Agent | Does |
|---|---|
| `yaad-agent` | Structures your brief for the board |
| `yaad-match` | Finds and alerts matching workers |
| `yaad-vision` | Checks evidence at every stage |
| `yaad-kickoff` / `yaad-completion` | Builds the Kickoff Pack and Completion Report |

### Get more responses

Two or three specific improvements to this job — add the shut-off valve photo, widen the date, name
what's excluded. Actionable, not generic.

---

## 10 · State

```js
let mode    = 'guest';   // 'guest' | 'member' — auth + signature in production
let step    = 1;
let chosen  = null;      // trade
let tidied  = false;     // has the assistant run
let seen    = false;     // have photos been added
let wzSel   = null;      // exact start date 'y-m-d'
let wzFlex  = false;
// plus the full job-card object — see MARKETPLACE spec §2.3
```

Draft persistence: **write the draft row at step 2**, update on every Continue. Someone who closes
the tab at step 4 comes back to a saved job, not an empty form.

---

## 11 · Validation

| Step | Blocks Continue |
|---|---|
| 1 | No trade selected |
| 2 | Empty description · any coral (blank) field on the job card |
| 3 | Nothing — skippable |
| 4 | No parish · no access contact |
| 5 | No name · no email · no phone · no password *(guest)* |
| 6 | Tick **and** signature *(guest)* |

Never a silent no-op. A disabled Continue always has a hint under it saying what is missing.

---

## 12 · The two paths, side by side

| | Guest — first job | Member — second job on |
|---|---|---|
| Step 2 description | Types it themselves | Assistant tidies + asks the two questions |
| Step 2 job card | Fills every field | Pre-filled, badged by confidence |
| Step 3 photos | Uploaded, unread | `yaad-vision` says what is and is not visible |
| Step 5 | Creates the account | Confirms details from profile |
| Step 6 | Tick + sign | Already on file |
| After | Agents switch on | Already running |

**The guest path must be genuinely usable, not a degraded funnel.** It is somebody's first
impression, they are often in a panic, and it is the path that earns the signature.

---

## 13 · Acceptance tests

- [ ] All six entry points land on `#s-post`; a trade card pre-selects and advances to step 2
- [ ] Step 1 Continue disabled until a trade is picked
- [ ] Guest mode: no agent button on step 2, no vision output on step 3, manual notes visible
- [ ] Member mode: assistant returns a tidied brief **and** two worker questions
- [ ] Job card cascades — trade changes types; type changes size bands, stage count, evidence list
- [ ] Money and materials fields are coral until picked
- [ ] Step 3 is skippable
- [ ] Calendar: past dates disabled, teal days match worker availability, month nav works, chosen date appears as a mango pill on step 6
- [ ] Draft row exists after step 2; closing and returning restores it
- [ ] Step 6 guest: Continue disabled with only the tick, only the signature, or neither. Enabled with both
- [ ] Signature writes `doc_signatures` against the **current** guidelines version
- [ ] A job with no signature does **not** appear on the board
- [ ] Done screen shows the agents block only after signature
- [ ] Street address and phone absent from every board-context response

---

## 14 · Do not

- Do not let a job reach the board without a current-version signature.
- Do not run any agent in guest mode.
- Do not make step 3 mandatory.
- Do not show the street address or phone on the board, ever.
- Do not disable a Continue without a hint saying what is missing.
- Do not create the draft only at the end — write it at step 2.
- Do not rewrite the copy. It has been through many rounds and is decided.
