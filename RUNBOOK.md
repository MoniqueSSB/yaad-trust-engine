# Runbook

If X breaks, do Y. Written to be followed at 11pm by someone who did not write the code.

Started 30 August 2026. Add a numbered entry whenever something operational ships. That is part of the definition of done in [`CLAUDE.md`](CLAUDE.md) §7.

**Project ref:** `leffyisvfvjwzilydlwf` (Supabase). **Marketing site:** `yaadly.co.uk`, GitHub Pages from `docs/`. **App:** `app.yaadly.co.uk`, Cloudflare Worker from `web/`.

---

## 1. CI is red

```bash
python -m pytest -q
```

Run it locally first. Then read which job failed on GitHub.

- **Engine tests failed.** A guardrail broke. The change is wrong, not the test. Revert the change. Never edit the assertion to make it pass.
- **Edge Function typecheck failed.** A Deno type error in `supabase/functions/yaad-*/index.ts`. Fix it before deploying anything, because these functions are deployed by hand and CI is the only thing between a typo and a dead production endpoint.
- **Shared tracer out of sync.** Run `supabase/functions/sync-shared.sh` and commit the copies.
- **Web typecheck or tests failed.** `cd web && npm run typecheck && npm test`.
- **Secrets scan failed.** A string shaped like an API key or a JWT is committed. Go to §6 immediately.

---

## 2. The demo will not run

```bash
pip install -r requirements.txt
python run_demo.py
```

With no `YAAD_API_KEY` it runs in mock mode: deterministic, rule based, every mocked line labelled `(mock)`. If it fails with no key set, the mock path has rotted and the demo is not reproducible. That is a stop-everything bug, because the demo is the sales tool that needs no infrastructure.

---

## 3. An Edge Function is broken in production

Deploy from disk only. Never paste file contents into a deploy tool: doing that has silently shipped a different intake flow before.

```bash
supabase functions deploy yaad-agent --project-ref leffyisvfvjwzilydlwf --no-verify-jwt
```

To see what is actually happening, read the function logs in the Supabase dashboard before changing code. Most failures here are a missing environment variable or a 403 from a downstream API, not a logic bug.

If the shared tracer was edited, run `supabase/functions/sync-shared.sh` first, then redeploy every function that imports it. A stale copy means the thing you tested is not the thing you deployed.

---

## 4. The app at app.yaadly.co.uk is down or wrong

```bash
cd web
npm run typecheck
npm test
npm run deploy
```

`predeploy` runs `scripts/check-env.mjs`, which stops a build that is missing the Supabase values. If it complains, the environment is wrong, not the code.

Rollback: redeploy the previous commit. Cloudflare also keeps prior Worker versions in the dashboard, which is faster in an outage.

---

## 5. The marketing site at yaadly.co.uk is down

It is GitHub Pages serving `docs/` with `docs/CNAME` set to `yaadly.co.uk`. It has no build step, so a broken app deploy cannot take it down. If it is down, the cause is DNS, the CNAME file, or the Pages setting in the repository, in that order.

Before touching DNS, check the Cloudflare record still exists and note what it was. If GitHub's own "Enforce HTTPS" is on while the record is proxied through Cloudflare, you get a redirect loop: Cloudflare SSL on Full (strict) and Enforce HTTPS off is the combination that works.

---

## 6. A key has been exposed

1. Rotate it at the provider now. Before anything else, before working out how it happened.
2. Remove it from the file and commit.
3. Update wherever it actually lives: `wrangler secret put NAME` for the Worker, Supabase project secrets for Edge Functions, `.env` locally.
4. Assume anything already pushed to a public repository is public forever. Rotation is the fix. Deleting the commit is not.

One key on this project has already been exposed and rotated. The CI secrets job is a cheap backstop, not a substitute for care.

---

## 7. Someone can see data they should not

This is an RLS problem, not a login problem. Cloudflare Access and the portal sign-in guard the door. Row-level security guards the data, and it is reachable through the Supabase API without visiting any page you built.

1. Find the table.
2. Confirm RLS is enabled on it and read the policies.
3. Fix the policy in a new migration in `supabase/migrations/`. Never patch it only in the dashboard, or the next environment is wrong again.
4. Write the failing case down here as a numbered entry.

---

## 8. The engine needs a different model provider

Environment variables only, no code change:

```bash
export YAAD_API_KEY="..."
export YAAD_BASE_URL="https://..."
export YAAD_MODEL="..."
```

Unset `YAAD_API_KEY` to fall back to mock mode. See [`DECISIONS.md`](DECISIONS.md) on why the provider is a configuration value and why the current one has to change before real data flows.
