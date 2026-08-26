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
