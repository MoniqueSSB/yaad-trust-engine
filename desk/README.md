# The Yaadly desk

The admin desk, deliberately **outside `docs/`** so GitHub Pages does not
publish it.

## Why this folder exists

`docs/index.html` is ~322KB, and roughly 140KB of that, 43%, is the admin pane.
Every visitor to yaadly.co.uk downloads the entire operating interface of the
business: every table name, every edge function call, every workflow step. The
data is safe, `is_admin()` and RLS hold, but the whole shape of the desk is
published, and it is 43% of a page loaded almost entirely from phones on
Jamaican and UK mobile data.

This folder is where that admin pane goes, one piece at a time. Each pane that
lands here gets deleted from `docs/index.html`, and the public page gets
smaller and quieter with every move.

Invoicing was the first pane, because it was new and had nothing to migrate.
Sketch packs followed, for the same reason.

| Pane | State |
|---|---|
| Invoices | here |
| Sketch packs | here |
| Intake, Jobs, Services, Workers, Applications, Marketplace, Calls, Waiting list, Feedback, Kickoff packs | still in `docs/index.html` |

The dashed tabs in the desk are that right-hand column. Each turns solid when
its pane moves across.

## Running it

It is a single file with no build step. Open `desk.html` in **Chrome**. Not
Safari, which blocks pages opened from disk from calling a server.

If Chrome gives trouble, serve it properly:

```
python3 -m http.server 8931
```

then go to `http://localhost:8931/desk.html`.

## Why it is not on a URL yet

A subdomain is not a lock. The moment `desk.yaadly.co.uk` gets a TLS
certificate it is published to the public Certificate Transparency logs, and
anyone can search those. What keeps people out is a gate that runs before the
page is served, which means Cloudflare, which means moving the nameservers off
names.co.uk, which means exporting the zone file first including the four DKIM
records added on 13 August.

Until that is done, a local file is not the weak option. It is the strongest
one: there is no URL to find. The database boundary, `is_admin()` plus RLS, is
the real lock either way and it is already in place.

## Adding a pane

Three steps, in `desk.html`:

1. add an entry to `PANES`
2. add `<div id="pane-yourname">` to the markup
3. write an async function that fills it, and name it in `PANES.load`

The tab router, the auth gate and the styling are already done. The ten dashed
tabs are the migration checklist: they are the real tab list from the old desk,
and each one turns solid when its pane moves across.

## It is no longer on the public site

`docs/desk.html` was a copy published at `https://yaadly.co.uk/desk.html` so the
desk could be tested from a phone without serving it locally. That copy came
down on 27 Aug 2026, once the names.co.uk zone file had been exported, which was
the condition set for removing it.

What it cost while it was up: the page was reachable by anyone who found the
URL, and a URL is always findable. `noindex` keeps it out of search results but
nothing keeps it out of a wordlist. No data was ever exposed, because what
protects the business is the sign-in gate plus `is_admin()` and RLS underneath,
not the address. The interface was exposed. That is now closed.

`desk/desk.html` is the source and is unchanged. To use the desk, serve this
folder locally (see above) rather than reaching for a public URL. If it needs to
be reachable remotely again, put it behind Cloudflare Access rather than
publishing it into `docs/`.

## Where it is deployed

`desk-deploy/` serves this file as a Cloudflare Worker on its own hostname,
away from `yaadly.co.uk` and `app.yaadly.co.uk`. Edit `desk.html` here, then:

```
cp desk/desk.html desk-deploy/public/index.html
npm run deploy --prefix desk-deploy
```

See `desk-deploy/README.md` for why it is a separate origin and for the
Cloudflare Access step that still needs doing.
