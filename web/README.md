# Yaadly web app

The Next.js application. Separate from the marketing site in `../docs`, which
stays hand-written and deployed to GitHub Pages at yaadly.co.uk.

## Why this exists

The three portals (client, worker, admin) need auth-protected routes,
server-side data fetching and real session handling. That is where a single
hand-written HTML file stops scaling.

## Stack

| Piece | Choice | Why |
|---|---|---|
| Framework | Next.js 16, App Router, TypeScript | Server rendering for auth-gated pages |
| Styling | Tailwind 4 | Brand tokens in `app/globals.css`, lifted from the live site |
| Data + auth | Supabase via `@supabase/ssr` | Same project the live site already uses |
| Hosting | Cloudflare Workers via OpenNext | Deliberately not Vercel |

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:3000. Environment variables live in `.env.local`,
which is gitignored. Copy `.env.example` if you need to recreate it.

Both variables are safe in the browser: the publishable key is the same one
already printed in yaadly.co.uk's JavaScript. Row level security in Postgres is
what protects the data. **Never put a service role key in this app.**

## Deploying to Cloudflare

```bash
npm run preview
```

Builds and runs it locally inside the real Workers runtime. Check it there
first, because Workers is not Node and some things behave differently.

```bash
npm run deploy
```

First deploy will ask you to authenticate with Cloudflare. It lands on a
`workers.dev` URL; pointing `app.yaadly.co.uk` at it is a separate step in the
Cloudflare dashboard, and needs the domain to be on Cloudflare first.

## Conventions

- `lib/supabase/client.ts` for Client Components, `lib/supabase/server.ts` for
  Server Components. Never share a server client between requests.
- `proxy.ts` refreshes the auth session on every request. It uses `getUser()`
  rather than `getSession()` on purpose: `getSession()` trusts the cookie.

## Where logic lives: the service boundary

Yaadly has two places server code can run. This is settled, do not drift.

**Edge Functions (`../supabase/functions`) own anything called from outside
this app:**

- Inbound third-party webhooks (`yaad-whatsapp-webhook`). Meta calls that URL
  directly, so it must not change when this app deploys.
- Public entry points used by the marketing site (`yaad-website-intake`).
  yaadly.co.uk is hand-written HTML on GitHub Pages and cannot call a Server
  Action.
- All AI model calls (`yaad-agent`, `yaad-kickoff`, `yaad-vision`,
  `yaad-completion`). They hold model API keys and run long.

**This app owns everything a signed-in user does:** the client, worker and
admin portals. Auth-gated pages, Server Components that read, Server Actions
that write.

**Unclear? Ask who calls it.** Third party or marketing site, Edge Function.
Signed-in user inside the app, here.

**Three rules:**

1. Never wrap an Edge Function in a route here just to call it from the app.
   Query Postgres directly via `@supabase/ssr` and let row level security
   decide. Edge Functions are for callers that cannot do that.
2. Never re-implement an Edge Function's logic here. One rule, one home.
3. Money and trust invariants belong in Postgres (triggers, RLS), not in
   either runtime. A database constraint holds no matter who is calling.
