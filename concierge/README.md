# The Yaadly concierge

The whole admin desk, in one file, deliberately **outside `docs/`** so GitHub
Pages never publishes it.

`concierge.html` is the source. `../concierge-deploy/` is the deployment.

## Why it is called concierge

Because "desk" and "admin" are the first two words anybody guesses. The name
is tidiness, nothing more. **It is not a lock, and it must not be treated as
one.** Every TLS certificate is published to the public Certificate
Transparency logs the moment it is issued, so `concierge.yaadly.co.uk` is
discoverable within minutes whatever it is called.

What actually keeps people out, in order:

1. **Cloudflare Access** in front of the hostname, so the page is never served
   without an identity check. Team domain: `yaadly.cloudflareaccess.com`.
2. The sign-in gate, then `is_admin()`, then row level security. These protect
   the data. Access protects the interface.

**Access is bound to a hostname, not to the Worker.** This is the thing to know
before ever renaming this again. On 27 Aug the route moved from
`desk.yaadly.co.uk` to `concierge.yaadly.co.uk` and the desk was served openly
to anybody who asked, because the Access application still named the old host.
The data held, because `is_admin()` and RLS do not care what the address is.
The interface did not.

**If you change the hostname, add the Access application for the new one
first, and check it before you deploy:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://concierge.yaadly.co.uk/
```

`302` means Access is in front of it. `200` means it is open to the world.

## What is in it

Twenty-two views, six groups, every one reading Postgres directly.

| Group | Views |
|---|---|
| Run the day | Overview, Intake, Jobs, Evidence, Quotes |
| People | Applications, Workers, Clients, Reviews |
| Documents & money | Kickoff packs, Invoices, Sketch packs, Signatures, Money |
| Services | Services, Marketplace |
| Inbox | Conversations, Calls, Waiting list, Feedback |
| System | Settings, Health |

Three views own their markup and their own logic: **Overview**, **Invoices**
and **Sketch packs**. Two more are built from the registry but filled by hand:
**Money** and **Health**. The rest are generated entirely from the `VIEWS`
registry, including their rail link, heading, table, search and empty state.

## A table is the floor, not the view

A view used to be a table and nothing else, which meant every question that
needed two tables to answer went unanswered. A view can now declare two more
things, and eight of them do.

```js
pre:   async (rows) => { /* fetch the second table once, stash it */ },
panel: (rows)       => "<div class=\"card\">…</div>",   // drawn above the table
```

`pre` runs after the rows are in hand and before anything is drawn. `panel` is
called with **everything loaded, never the filtered rows**: a search box is for
finding one row, not for changing what is true.

What each panel is for:

| View | The panel says |
|---|---|
| Intake | The jobs somebody built and never signed for. `status` is stuck at `awaiting_client_setup`, so `client_go_live()` has nothing signed in to open them however complete they look. Trade, parish and their own words are all still there, which makes each one a lead |
| Evidence | The newest stage with something unchecked: the journey rail, what the kickoff pack asked for, what actually arrived, the fingerprints your approval binds to, and the money that moves if you pass it |
| Quotes | That the comparison column is against the other quotes on the same job and nothing else. There is no published price book to benchmark against, and Yaadly does oversight, not price estimation |
| Applications | The vetting record: every check the agent ran, its note, and PASS / GAP / UNCLEAR. The agent flags. A person decides |
| Kickoff packs | Which of the ten documents are actually in the newest pack, their character counts, and whether an em dash or a character from another script survived the model |
| Services | Committed monthly against the October Gate, counted only from retainers that have actually started |
| Settings | Every switch, grouped, each one saying what reads it |

### Matched on the label, not on the picture

The evidence panel ticks a checklist line when the words in it overlap the
words in a file label. Two shared words for a wordy label, one for a short
filename, because `board-before.jpg` cannot carry two. **A miss can be the
label rather than the work**, and the panel says exactly that underneath
itself. It is a prompt to look, never a verdict.

## The agents switch

The control in the top bar writes `app_settings.agents_paused` and every call
this desk makes to a model goes through the one guard behind it, in `fn()` and
`skFn()`. Paused means invoice drafting and sketch description refuse to send
anything.

**It does not reach everything, and it names what it misses.** `yaad-inbound`
calls a model without this desk starting it: woken by an incoming message, it
has replied to somebody before the desk knows the message exists, and it does
not read `agents_paused`. Settings says so, Health says so, and the Overview
says so while the pause is on. (`yaad-whatsapp-webhook` shared this gap until
1 Sep 2026; it spoke to Meta's Cloud API directly, never received real
traffic, and was deleted, see DECISIONS.md. `yaad-inbound`, over Twilio, is
the one live WhatsApp path now.)

Reading that row at the top of that one is the whole remaining job. There is
already a per-person gate, `may_use_agents(email)`, which `yaad-agent` and
`yaad-vision` both call, so a global pause folded into it would reach further
still. Until that is done, the desk is precise about its reach rather than
quiet about it, because **a switch that claims more than it does is worse than
no switch.**

## Settings read empty for a while, and the table was full

`app_settings` had row level security switched on and **not one policy written
against it**. RLS with no policy is not "admin only", it is "nobody". Every
read from the desk came back as zero rows, and the Settings view showed the
empty state it shows for a genuinely empty table.

The edge functions were never affected: they hold the service role key, which
bypasses RLS, which is exactly why nobody noticed.

Fixed in `supabase/migrations/20260827j_settings_were_locked_to_nobody.sql`.
The lesson is bigger than the row: **an empty view is only trustworthy if the
reader is allowed to see a full one.** Health now checks that this desk can
read `app_settings` at all, and says so in as many words when it cannot.

## Health tells the truth about the database, including when it is fine

Health used to compare every signature against a hard-coded `"1.1"` while
`app_settings` said `1.0`, so it flagged every signature that was on the
version actually in force. It now reads the version from `app_settings`, which
is the same row `current_doc_version()` reads.

It also no longer claims the quote policy ignores the signature version.
`jq_insert_vetted` does check it, and it checks the worker profile against the
right email. Both were fixed in the database; the page had not caught up. **A
check that is wrong is worse than no check**, in either direction.

## Adding a view

One entry in `VIEWS`. The rail link, the section, the heading, the loader, the
search and the empty state are all built from it.

```js
{ k:"thing", g:"Run the day", label:"Thing", icon:"case",
  title:"Things", table:"things",
  sub:"One sentence saying what this is and what it is not.",
  select:"id,name,status,created_at", order:"created_at",
  search:["id","name"],
  empty:["Nothing yet","What would put something here."],
  pre:  async (rows) => { /* optional second table */ },
  panel: (rows) => "",                       // optional card above the table
  cols:[ {h:"Thing", f:r => id_(r.id) + sub_(r.name)},
         {h:"State", f:r => tone_(r.status)} ] }
```

A view that needs its own logic sets `bespoke:true` and gets a loader in
`BESPOKE`. One that has hand-written markup in the document sets `hand:true`.

## Colour means something

Three tones, and they are claims about state, not decoration. Realigned onto
the shared Yaadly brand palette 3 Sep 2026 (purple in place of teal, gold in
place of mango), the meaning is unchanged, only the hue is. The `--teal` and
`--mango` variable names in `concierge.html` are also unchanged, they now
just point at different values.

| Tone | Means |
|---|---|
| purple | Proven. Signed off, released, verified, passed |
| gold | Held. Waiting on somebody, money not yet moved |
| coral | Blocked. Risk, failed, needs attention |

A rail with no colour means the day is clear. Do not use gold or coral for
anything else. A guidelines chip is coral when somebody is behind the version
in force, because the database refuses to let them quote: that is a block, not
a wait.

## Nothing on this page is a placeholder

Every number is counted from the table it names. Where a figure cannot be
counted it is not drawn:

- **Yaadly holds no money.** Holding starts when PI insurance is in force.
  Money shows amounts agreed in writing and invoices raised, never a balance.
- **There is no fair-price band.** The quote column compares a quote to the
  others on the same job, which is real, rather than to a benchmark that does
  not exist yet.
- **The October Gate has four conditions.** The Services panel counts one of
  them, from retainers that have started, and says so.

## Running it

No build step. Open in **Chrome**, not Safari, which blocks pages opened from
disk from calling a server.

```bash
python3 -m http.server 8931 --directory concierge
```

then `http://localhost:8931/concierge.html`. `.claude/launch.json` starts the
same server under the name `concierge`.

## Deploying

```bash
cp concierge/concierge.html concierge-deploy/public/index.html && npm run deploy --prefix concierge-deploy
```

Then check Access is still in front of it, because a deploy does not put it
there and a rename takes it away:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://concierge.yaadly.co.uk/
```

See `../concierge-deploy/README.md` for why it is a separate origin.
