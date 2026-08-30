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

This is the Python engine only. The live Edge Functions are step 9.

---

## 9. Switching the text model to the EU

The eight live functions that call a text model all read `supabase/functions/_shared/textmodel.ts`. It prefers Mistral in the EU and uses MiniMax in China while no Mistral key is set.

**MiniMax is the current choice, deliberately.** Founder decision, 30 August 2026: the data flowing through these functions today is synthetic, and a China transfer of invented job cards is not what the DPIA is about. **The trigger for this step is real client and worker data, which arrives with the December pilot.** Do it before then, not after.

**Step one, set the secret.** One command, and every function picks it up on its next invocation. No redeploy needed, because it is read at call time.

```bash
supabase secrets set MISTRAL_API_KEY=your-key --project-ref leffyisvfvjwzilydlwf
```

**Step two, prove it switched.** Send one message through WhatsApp intake or post a test job, then look at the trace. The span attribute `yaadly.model.region` reads `eu` when it worked and `cn` when it did not. There is no need to guess: the region travels with every model call on purpose, and it is the same attribute that answers "where is our data going" today.

**Step three, remove the MiniMax branch.** Once step two is confirmed, delete it in `_shared/textmodel.ts`, run `supabase/functions/sync-shared.sh`, and redeploy the eight functions. It is about four lines. Leaving it in once real data is flowing means one missing secret quietly sends client messages to China again.

**If the model starts refusing requests after the switch**, the likely cause is the model id rather than the key. Model names move. Confirm the current one on Mistral's model page and set it without touching code:

```bash
supabase secrets set MISTRAL_MODEL=the-current-id --project-ref leffyisvfvjwzilydlwf
```

**To point at something else entirely**, no code change: set `TEXT_MODEL_KEY`, `TEXT_MODEL_API`, `TEXT_MODEL_NAME` and `TEXT_MODEL_REGION`. Those take priority over everything. A new hard-coded provider in that file is a new country receiving personal data, so it is a founder decision and a line in the data inventory before it is a code change.

**Deploying the eight**, from disk only, never by pasting file contents:

```bash
for f in yaad-agent yaad-completion yaad-inbound yaad-invoice yaad-kickoff yaad-post-job yaad-sketch yaad-whatsapp-webhook; do supabase functions deploy $f --project-ref leffyisvfvjwzilydlwf --no-verify-jwt; done
```

---

## 10. A client got a holding reply instead of an answer

The banned-language screen fired. `yaad-inbound` composed a reply, the screen found language Yaadly never uses, and the reply was not sent. The client received the short holding message from `SAFE_FALLBACK` saying a person will come back to them, and a phone notification went out titled **Reply held back**.

**That client is now waiting on you.** The machine deliberately did not answer them.

1. Open the `yaad-inbound` function logs in the Supabase dashboard and find the line beginning `guardrail: outbound reply blocked`. It carries the terms that matched and the first 500 characters of the draft.
2. Reply to the client yourself.
3. Then look at why. A single hit is usually the model reaching for "escrow" to explain how payment works, which is exactly the thing this catches. If it repeats, the system prompt in `yaad-inbound` needs a line telling it the right phrase, not a looser screen.

**Never widen the screen to stop the alert.** The alert is the product working. The banned list is a port of `yaad/guardrails.py` and the two move together, with tests on both sides asserting the same phrases.

The span attributes `yaadly.guardrail.blocked` and `yaadly.guardrail.terms` carry the same information in telemetry, with the guidance strings rather than anything the client or the model wrote.

---

## Publishing a worker profile

**The profile row is created the moment Phase 1 is submitted, and it is created hidden.** `active = false`, `vetting_state = 'probation'`. It exists from the first sitting so the desk can see and work on it, and nothing unvetted is ever publicly listed.

**Publishing is a human act and there is no automatic promotion.** Flipping a profile live is the moment Yaadly vouches for somebody in public, which is a consequential step, so a named person takes it. Do not add a trigger that does this on a Persona pass. If a future console does it, it does it behind a button somebody presses.

**Before publishing, check all four.** The point of the hidden state is that these have actually happened, not that a form was filled in.

1. Persona says the identity check passed. `applications.persona_status` reads `approved` or `completed`, and it was confirmed by our server rather than claimed by a browser.
2. **The TRN is approved.** The applicant types the number in Phase 2 and it arrives as `pending`, never approved: this is the step where a person checks it against the name on the ID. Nine digits. Approve it with:

```sql
update public.applications
   set trn_status = 'approved', trn_checked_at = now()
 where app_id = 'APP-XXXXXX';
```

   If it does not match the ID, set `'rejected'` instead and ask them again. We hold the number, not a photograph of the card.
3. The three referees were **telephoned**, not emailed, and each had been told in advance the call was coming.
4. The Worker Guidelines are signed on the current version.
5. Anything the trade needs: a JCF police check for work over £500, inside an occupied home, or where keys are held, and certification confirmed with the body that issued it.

**The database refuses a publish that skips these.** `trg_profile_publish_checks` will not let `active` become true without an email address, a Persona pass and an approved TRN, and it says which one is missing. That is the same list as above, enforced rather than remembered. It refuses a bad publish; it never performs one, so publishing stays a human act.

**An email address is required to publish**, even though Phase 1 accepts a phone number instead. The portal account, the Worker Guidelines signature and the job alerts are all keyed on it, so a worker published without one would sit in a dead profile that can never be sent a job. Phase 2 asks for it when Phase 1 did not.

**To publish**, in the Supabase SQL editor, one worker at a time. Never a bulk update:

```sql
update public.worker_profiles
   set vetting_state = 'verified', active = true, updated_at = now()
 where application_id = 'THE-APPLICATION-UUID';
```

**To take one back down**, same shape:

```sql
update public.worker_profiles
   set active = false, updated_at = now()
 where application_id = 'THE-APPLICATION-UUID';
```

**A published profile still cannot be sent a job until the Worker Guidelines are signed.** `yaad_match` requires a signature on the current version and skips anybody without one, so publishing and being matchable are two separate gates on purpose. If a worker is live and getting no jobs, check the signature first.

**Suspending somebody** is `vetting_state = 'suspended'` plus `active = false`. Keep the row. Deleting it loses the record of why.
