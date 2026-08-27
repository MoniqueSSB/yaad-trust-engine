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
curl -s -o /dev/null -w "%{http_code}\n" https://<new-host>/
```

`302` means Access is in front of it. `200` means it is open to the world.

## What is in it

Twenty-one views, six groups, every one reading Postgres directly.

| Group | Views |
|---|---|
| Run the day | Overview, Intake, Jobs, Evidence, Quotes |
| People | Applications, Workers, Clients, Reviews |
| Documents & money | Kickoff packs, Invoices, Sketch packs, Signatures, Money |
| Services | Services, Marketplace |
| Inbox | Calls, Waiting list, Feedback |
| System | Settings, Health |

Three views own their markup and their own logic: **Overview**, **Invoices**
and **Sketch packs**. Two more are built from the registry but filled by hand:
**Money** and **Health**. The other sixteen are generated entirely from the
`VIEWS` registry, including their rail link, heading, table, search and empty
state.

## The thing that changed

The old desk lived inside `docs/index.html` and kept the business in
**localStorage**, under `yaadly-platform-v1`, pushing a JSON blob at the
`app_state` table every so often. That meant the truth lived in one browser on
one laptop, and every visitor to yaadly.co.uk downloaded the entire admin
interface to read it.

This file reads the real tables instead. Every view names the table it reads,
in the registry and again under each table on screen. **An empty view means an
empty table, not a lost file.**

`app_state` still holds that old blob. The Health view flags it. Delete the row
once you are satisfied nothing in it needs recovering.

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
  cols:[ {h:"Thing", f:r => id_(r.id) + sub_(r.name)},
         {h:"State", f:r => tone_(r.status)} ] }
```

A view that needs its own logic sets `bespoke:true` and gets a loader in
`BESPOKE`. One that has hand-written markup in the document sets `hand:true`.

## Colour means something

Three tones, and they are claims about state, not decoration.

| Tone | Means |
|---|---|
| teal | Proven. Signed off, released, verified, passed |
| mango | Held. Waiting on somebody, money not yet moved |
| coral | Blocked. Risk, failed, needs attention |

A rail with no colour means the day is clear. Do not use mango or coral for
anything else.

## Running it

No build step. Open in **Chrome**, not Safari, which blocks pages opened from
disk from calling a server.

```bash
python3 -m http.server 8931
```

then `http://localhost:8931/concierge.html`.

## Deploying

```bash
cp concierge/concierge.html concierge-deploy/public/index.html
npm run deploy --prefix concierge-deploy
```

See `../concierge-deploy/README.md` for why it is a separate origin, and for
the Cloudflare Access step that still needs doing.
