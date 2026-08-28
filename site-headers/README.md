# Security headers for yaadly.co.uk

The marketing site is GitHub Pages, served from `docs/` on `main`. Pages cannot
set response headers, so this Worker sits in front of it on a route and adds
them on the way past.

## Why a route and not a custom domain

A custom domain would rewrite the DNS record for the apex and take GitHub Pages
out of the path entirely. Two things follow from that, and neither is worth it:

- **The site would stop deploying when you merge to main.** It would need a
  `wrangler deploy` instead, and the one thing that has worked reliably all
  along is that merging publishes the site.
- **Rolling back would mean recreating DNS**, from memory, under pressure.

A route changes no DNS at all. Cloudflare already proxies this hostname, so the
Worker simply runs as the request passes through. GitHub Pages is still the
origin and still the source of truth.

## Undoing it

```bash
npx wrangler delete yaadly-site-headers
```

Traffic goes straight to Pages again, exactly as before. That is the whole
rollback. The Worker never generates a body, never rewrites HTML and never
caches, so removing it cannot leave anything behind.

## What it sets

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Content-Security-Policy-Report-Only` | see below |

## The CSP is report-only on purpose

This page carries a lot of inline script plus a Sentry loader, and a CSP that is
wrong does not fail quietly. It stops the job form working for a real client,
and nobody finds out until they give up and leave.

Report-Only means the browser reports what **would** have been blocked and
blocks nothing. The allow-list was checked in a browser against the live site
with no violations reported, so it is very likely already complete. Leave it
reporting for a while anyway, then rename the header to
`Content-Security-Policy` and it starts enforcing.

The origins on the allow-list, and why each is there:

| Origin | Needed for |
|---|---|
| `cdn.jsdelivr.net` | the Supabase JS library |
| `browser.sentry-cdn.com` | the Sentry loader |
| `fonts.googleapis.com` / `fonts.gstatic.com` | Space Grotesk, Anton, JetBrains Mono |
| `leffyisvfvjwzilydlwf.supabase.co` | job posting, waiting list, feedback |
| `o4511948007931904.ingest.de.sentry.io` | where Sentry sends errors |

If you add a script, a font host or an API to the site, add it here too, or it
will show up as a report today and a broken feature the day this starts
enforcing.

## Deploying

```bash
npm run deploy --prefix site-headers
```

Then check it took:

```bash
curl -sI https://yaadly.co.uk/ | grep -i -E "strict-transport|x-frame|content-security"
```
