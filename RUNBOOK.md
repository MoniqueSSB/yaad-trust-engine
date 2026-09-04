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

**Check the auth setting before you deploy, every time.** `--no-verify-jwt` is not a house style, it is a per-function setting, and passing it to a function that should verify tokens turns platform authentication off without any warning and without failing the deploy.

```bash
supabase functions list --project-ref leffyisvfvjwzilydlwf
```

Read `verify_jwt` for the function you are about to deploy, then match it.

**`verify_jwt` is true**, which is most of them, so deploy with no flag:

```bash
supabase functions deploy yaad-agent --project-ref leffyisvfvjwzilydlwf
```

**`verify_jwt` is false**, only the endpoints that carry their own authentication (`yaad-inbound`, `yaad-whatsapp-webhook`, `yaad-vetting-review`, `yaad-vetting-upload`, `yaad-enquiry`), so deploy with the flag:

```bash
supabase functions deploy yaad-inbound --project-ref leffyisvfvjwzilydlwf --no-verify-jwt
```

Afterwards, run `supabase functions list` again and confirm `verify_jwt` is what it was. A deploy that quietly flipped it looks exactly like a deploy that worked.

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

## 5a. The header looks different on one page

The header is defined once, in `docs/nav.css`, and every page in `docs/` links it. The app's copy of the same header is `web/components/SiteNav.tsx`, which repeats the same tabs and the same measurements in Tailwind because the app does not load the marketing stylesheet.

If one page's header does not match the rest:

1. Check that page links the file: `grep -c nav.css docs/<page>.html` should return 1.
2. Check nobody has put nav rules back into the page or into `yaadly.css`: `grep -n "\.vbtn\|\.views\|\.quiet-links\|site-nav" docs/*.html docs/yaadly.css` should return nothing but the markup lines. A nav rule anywhere other than `nav.css` is the fault.
3. Check the markup matches. It is identical on all eight pages; only the `on` class moves to the current page's tab.

If the whole row has wrapped onto two lines, something in it grew. With IBM Plex loaded, the header fills its 1100px exactly, so a longer label, more padding or an extra link pushes "Post a job" out. Shorten it, or take something out of the row: do not let it wrap on desktop, because a two-line header on one page and a one-line header on the next is the exact problem this file exists to prevent.

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
5. Certification confirmed with the body that issued it, where the trade holds one.

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


---

## A client says they never heard about their quote

The quote is saved either way: a database trigger on `job_quotes` calls `yaad-notify-client` after the insert and a failure there never loses it. The function reports what it managed, so ask it rather than guess.

**Look at the trace.** `yaadly.notify.outcome` reads `told` when at least one channel worked and `nobody_told` when neither did. `yaadly.notify.emailed` and `yaadly.notify.whatsapp` say which.

**The three ordinary reasons, in the order they actually happen.**

1. **The job has no email and no phone.** A job posted with only one channel has only that one to send on, and a WhatsApp intake job often has a number and no address. Nothing to fix in code: put the missing one on the job.
2. **Twilio Trust Hub KYC was the live blocker until 31 Aug 2026, now cleared.** The compliance profile was approved same day, confirmed live: a real evidence_landed notification, with a real photo attached, reached a real phone over `whatsapp:+447878877567` ("Yaadly LTD") the same afternoon. If sends start failing again with

   > twilio 401 (20003): Primary compliance profile is not approved. Please refer to documentation and complete the KYC process in Trust Hub to gain access.

   check Trust Hub, Primary Customer Profile in the Twilio Console first: something has lapsed or been unlinked, not a fresh version of the original gap. The Yaadly Ltd details on file are England and Wales company **17358077**, the registered address, and a named authorised representative. It is business verification, not a technical step, and nothing in this repository can do it. Nothing else needs changing once it clears: sends start working with no deploy.

3. **No Twilio sender is configured.** Was the blocker before the above. The phone is tried in this order: Twilio WhatsApp, then Meta's own API, then Twilio SMS. Twilio is first because this project already runs on that account for inbound WhatsApp and SMS, so the credentials are real and working. What outbound needs and inbound never did is a number to send FROM.

```bash
supabase secrets set TWILIO_WHATSAPP_FROM='whatsapp:+1XXXXXXXXXX' --project-ref leffyisvfvjwzilydlwf
supabase secrets set TWILIO_SMS_FROM='+1XXXXXXXXXX' --project-ref leffyisvfvjwzilydlwf
```

   Both come from the Twilio console: Messaging, then Senders. Use the WhatsApp sender for the first and any SMS-capable number for the second. Setting only one is fine; the other simply reports itself as unset. `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are already set.

   **The 24 hour rule is WhatsApp's, not Twilio's, so changing provider does not escape it.** A business may send free text only within 24 hours of the person's last message. Outside that, it must be a template approved in advance. A client who posted their job on WhatsApp this morning and gets a quote this afternoon is inside the window. One who posted last week is not, and the send comes back Twilio error 63016, which the function reports in words rather than as a number. **SMS has no such window**, which is why it is the last resort rather than no resort: it costs money and it still arrives.
4. **`RESEND_API_KEY` missing or the send returned non-2xx.** `emailReason` carries the status. Resend also refuses obviously fake domains like `example.com`, which only bites in testing.

**Until a Twilio sender is set**, a phone-only client is told nothing automatically. The quotes page is honest when empty and the link keeps working, so the fallback is a person messaging them. Worth doing deliberately rather than discovering later that somebody waited a week on a price that was sitting there.


---

## A client cannot get into their portal

**There is no password any more.** Clients sign in with a six digit code, so "reset my password" is not the answer to anything. `yaad-portal-code` issues one, and it reports what it managed rather than assuming.

**Ask the function first.** Its response carries `delivered`, `emailed`, `emailReason` and `phone`. The page refuses to say "check your email" when `delivered` is false, so a client who saw that message got one sent.

**The ordinary reasons.**

1. **`emailReason` says `resend 422 ... Invalid to field`.** Resend refuses obviously fake domains like `example.com`. Real client addresses are fine; this only bites in testing. Use `delivered@resend.dev` to test a real send.
2. **`phone` says a `TWILIO_*_FROM` is not set.** Then only email went, which is fine when they have one and fatal when they do not. See the quote notification section for the two commands.
3. **"That job code will not open an account."** One message covers a wrong code, a code already claimed by somebody else, and too many tries, on purpose: naming which would tell a guesser which half they got right. Check the code against what was sent, and check `pend_portal_code` rate limiting has not tripped.

**A returning client is never asked for a job code.** `email_has_account` decides that, and locking somebody out of their own history because they lost a code from months ago would be the wrong trade. That function is granted to nobody and callable only with the service role, because "is this person a Yaadly client" is the question an enumeration attack asks.

**Existing accounts that still have a password keep working.** Nothing was deleted from them. They simply have a second way in that needs nothing remembered, and the sign in page no longer asks for the password.


---

## The WhatsApp template for quote notifications

**Why there is one at all.** A registered WhatsApp sender still cannot send free text to somebody who has not messaged in the last 24 hours. That needs a template approved in advance by Meta. Most clients get a quote more than a day after posting the job, so without a template most notifications would fail.

**What is set.** `TWILIO_CONTENT_SID_QUOTE` points at `yaadly_quote_landed_v2`, submitted 31 Aug 2026, category UTILITY. `yaad-notify-client`'s `quote_arrived` kind uses it whenever it is set, unconditionally rather than only outside the 24 hour window: a template is valid inside the window too, so there is one path rather than two half-paths. It is the only one of that function's seven kinds that reuses this template, because it is the only one whose wording matches what Meta approved; see the header comment in `supabase/functions/yaad-notify-client/index.ts` for why the other six stay free text. `yaad-quote-landed`, the function this template was originally built for, is retired (below) and calls nothing today.

**Check whether Meta has approved it**, in Twilio Console under Messaging, Content Template Builder. `received` means in review, `approved` means live, `rejected` carries a reason.

**A rejected template cannot be edited.** Twilio returns error 92009 and you make a new one. The first attempt was rejected for exactly one reason, worth knowing before writing another:

> Variables can't be at the start or end of the template.

The body ended with the link variable. It now ends with a sentence after it. Keep that rule in mind for any future template: never open or close with `{{n}}`.

**The four variables, in order:** job title, worker name, price, link.

**Sign in codes deliberately do NOT use a template.** An OTP is an AUTHENTICATION message in WhatsApp's own categories, with its own rules, and Twilio Verify is the supported product for one. Pushing an OTP through an ordinary utility template is how a sender gets flagged, and a flagged sender takes every other message down with it. Over WhatsApp a sign in code stays free text: it works inside the 24 hour window and fails honestly outside it, and email remains the reliable path for it.

---

## A worker says they cannot quote a job

The refusal names the reason, so read it before changing anything. All of them come from `enforce_vetted_worker_on_quote`, which runs in Postgres, so no deploy can talk past it.

**"Only an active vetted worker can submit a quote."** No published profile. Either they were never published, or somebody set `active = false`. See the publishing section.

**"While your account is in Probation..."** Working as intended. A probation worker quotes standard jobs and is refused three things: work over about **J$105,000**, any job where they would hold keys, and any job inside an occupied home. Those are the founder's top tier, and they open when `vetting_state` becomes `verified`, which happens at publishing after the telephoned references.

**To lift somebody out of Probation**, only once those are genuinely done:

```sql
update public.worker_profiles
   set vetting_state = 'verified', updated_at = now()
 where worker_email = 'them@example.com';
```

**"This account is suspended."** Deliberate. Set `vetting_state = 'suspended'` and keep the row; deleting it loses the record of why.

**The J$105,000 line is £500 at roughly J$211 to the pound.** The rate moves. It is a single constant, `top_tier_jmd`, in that one function, and changing it needs a migration rather than a settings change, on purpose: it is the line between a call-out and somebody's savings.

**The access test reads `jobs.access_type`**, which carries the client's own words, like "Neighbour holds a key" or "Family member on site". A job with no access type set is treated as standard, so a job posted without that answer will not be caught by it. The money test still applies.

---

## A worker cannot get through the ID check

**Most Jamaican tradespeople do not hold a passport.** If the Persona template only accepts passports it silently excludes the supply side this business is built on, and the failure looks like ordinary rejection rather than a configuration mistake, so nobody reports it.

**Check the template accepts the documents they actually hold.** Persona Dashboard, Inquiry Templates, "KYC: GovID + Selfie", the Government ID step, then the document types for Jamaica:

- **Driver's licence**
- **Voter ID**, the Electoral Commission card, which is the one most widely held
- **National ID**
- Passport

The country already defaults to Jamaica (JM), set 30 Aug 2026. **The Persona API does not expose which document types a template accepts**, checked on 31 Aug: the config it returns lists Persona's generic field schema rather than the enabled ID classes. So this cannot be confirmed or changed from code, and it cannot be monitored either. It is a console setting and it needs a human eye.

**There is a way out in the product, and it does not depend on the above.** On the ID step a worker can press "It would not take my ID. Let me send it another way." That switches to the in-page capture and upload, and a person at the desk checks it by hand. It exists because the old fallback only triggered when Persona failed to LOAD; somebody whose voter card the template refuses sees Persona work perfectly and turn them away, which was a dead end.

**How to spot one of those at the desk:** the application has `photo_id`, `selfie_with_id` and `face_video` uploaded, and `persona_status` is empty. That combination means they took the escape, not that they skipped the check.

---

## A client cannot approve a stage

**Read the refusal, it names the reason.** All of them come from `approve_stage()`, so no deploy can talk past them.

- **"That is not your job to approve."** The signed-in email does not match `jobs.client_email`.
- **"A dispute is open on this job. Nothing can be approved while it is."** Resolve the dispute (`disputes.state = 'resolved'`) first; that is the only door.
- **"Nothing has been filed for this stage yet."** No evidence rows exist for `greatest(jobs.stage, 1)`. The worker has not filed anything against the stage actually being worked.
- **"Not signed in." / "Confirm your email address first."** Ordinary auth states, same as `client_go_live`.

**To see what was actually approved**, `stage_approvals` carries who, when, and the exact fingerprint of every item at the moment of approval:

```sql
select stage, approved_by, approved_at, jsonb_pretty(evidence)
  from stage_approvals
 where job_id = 'JOB-XXXX'
 order by stage;
```

**If the evidence tab shows "Evidence waiting on you" but there is no Approve button**, check `role`: the button only renders for the client, on purpose. A worker approving their own work is the exact thing this exists to prevent.

**`jobs.status` is fully owned by `sync_job_status()`.** It recomputes the column from scratch on every insert or update to the `jobs` row: worker assigned, current stage's evidence state, `open`, and the client's go-live status, in that order. Do not add a second trigger or a direct `update jobs set status = ...` anywhere expecting it to stick outside this function; it will be silently overwritten on the same statement. If a new state is ever needed, it goes inside `sync_job_status`, not beside it.

---

## A client says they were never told

**Check `net._http_response` first, not the trigger source.** Every client notification goes through `net.http_post` to `yaad-notify-client`, and every call it makes is logged there whether it succeeded or not:

```sql
select id, created, status_code, content::text
  from net._http_response
 order by id desc
 limit 10;
```

`{"ok":true,"told":true,"emailed":true}` means it sent. `{"told":false,...}` or a non-200 `status_code` means the function ran but declined or failed; read `content` for why. No row at all for the event you expected means the trigger's condition never evaluated true, which is a database question, not a delivery question. Check `jobs.status`, `jobs.stage` and `stage_approvals` for that job directly against what the trigger in `20260831i`/`20260831j` actually tests.

**What each `kind` fires from, and nothing else:**

| Kind | Fires from |
|---|---|
| `quote_arrived` | `job_quotes` AFTER INSERT WHEN `status = 'submitted'` |
| `evidence_landed` | `jobs` AFTER UPDATE, `status` transitions into `'evidence'` |
| `stage_released` | `jobs` AFTER UPDATE, `stage` increases and a `stage_approvals` row exists for `new.stage - 1` |
| `dispute_raised` | `disputes` AFTER INSERT, unconditional |

**"Worker on site today" does not exist yet, and will not show up in this table.** There is no Arrival Log column anywhere to fire it from. This is not a bug to chase; it needs schema work first.

**`whatsapp.sent: false, reason: "no client phone on the job"`** is expected and correct for any job where the client never gave a number. Email through Resend is not conditional on that; check `emailed` and `emailReason` separately.

**None of this fires twice for the same event.** `evidence_landed`'s trigger condition is a transition (`old.status IS DISTINCT FROM 'evidence' AND new.status = 'evidence'`), not a state, so a second evidence item filed against a stage that already flipped the status does not notify again. If a client reports being told the same thing twice, that is two genuinely separate events, most likely two different stages, not a repeat.

**The shared secret lives in Supabase Vault, and only as a hash in the database.** `app_settings.notify_trigger_secret_sha256` stores the SHA-256, never the plaintext. Since 3 September 2026 the plaintext is held in Vault under the name `notify_trigger_secret` and fetched at call time by `public.notify_trigger_secret()`; no trigger function body contains it any more, so reading a definition back with `pg_get_functiondef` reveals nothing. EXECUTE on that function is granted to `service_role` only, never to `anon` or `authenticated`, because it returns the plaintext. Ten callers use it: the eight `notify_*` trigger functions, `notify_client_service_change`, and `relay_confirmed_report`. A mismatch between what a caller sends and what the hash expects fails closed; `yaad-notify-client` returns 403 rather than notifying on a bad secret. This paragraph previously described the plaintext as baked into three function bodies, which was the design until 3 September and named three of what were by then nine callers. Corrected 4 September 2026.

**`yaad-quote-landed` is retired.** It answers 410 and names where the work went. If something still calls it, `console.warn` inside the stub logs the referer, visible in that function's logs.

---

## A worker's video evidence will not send

**Ask what the item's own error says first.** The video queue on the job page shows the actual refusal text under a failed item, taken straight from `yaad-evidence-video`. It is not a generic "upload failed": it is the same sentence `evidence-actions.ts` would show for the same underlying reason.

- **"You may not be on this job."** The signed-in worker's email does not match `jobs.worker_email`. RLS refused it, not a bug; check which account they are actually signed in as.
- **A materials-store sentence** ("...no materials store nominated by the client...") means exactly what it says: the client has not named a store yet. The video is still sitting queued in the worker's browser, not lost; it sends the moment the client answers.
- **"That file type is not accepted."** Only MP4, WebM and MOV. An iPhone recording in HEVC inside a `.mov` container still reports as `video/quicktime` and is fine; a different container is not.
- **"That video is too large."** 80MB. This is a memory limit on the edge function that hashes the file, not a Storage limit (the bucket itself allows up to 500MB), so it cannot be raised by a settings change alone.

**Where the video actually is while this is being sorted:** in the worker's own browser, in IndexedDB, not on the server and not lost. It only leaves the browser once `start` and the PUT both succeed. Closing the tab is safe; the item is still there next time that job's evidence tab is open on that same browser and device. It will **not** appear on a different phone or after clearing site data.

**A failed item stops retrying itself after five attempts on reconnect**, so a video failing for a real reason does not hammer the connection forever. The worker taps "Try again" on it, which resets the count and it retries once more.

**To see what actually reached the server**, every attempt shows up in that function's logs the normal way (`supabase functions logs yaad-evidence-video --project-ref <ref>`), and a written row is the same `evidence` table the photo path writes, so a landed video is indistinguishable from a photo in `select * from evidence where job_id = 'JOB-XXXX'` except for `mime` starting `video/`.

**This function holds no service role key and repeats no authorisation check of its own.** Every call inside it runs as the calling worker's own session, so if something is refused, the RLS policies on `public.evidence` and the `evidence` storage bucket (20260827a, 20260830b) are where to look, not this function's own code. There is nothing here overriding what those already decide.

**The offline queue only runs while the tab is open.** There is no service worker and no background sync in this codebase yet. A worker who queues a video and then force-quits the browser (not just backgrounds it) before it finishes uploading will find it still queued next time that page opens, not silently sent in the background. That is a known, considered gap, not an oversight: see DECISIONS.md, Stage 5.5.

---

## A worker's money figure looks wrong

**It is computed live from `job_quotes`, not stored anywhere.** There is no cached total to be stale; if a figure looks wrong, the accepted quote for that job is where to look:

```sql
select j.id, j.status, q.labour_jmd, q.materials_jmd, q.status as quote_status
  from jobs j
  left join job_quotes q on q.job_id = j.id and q.status = 'accepted'
 where j.worker_email = 'them@example.com';
```

`round(labour_jmd * 0.88) + materials_jmd` is the figure shown, the same 88% every other money panel in this repository uses. A job with no `accepted` row shows nothing on the money page at all, correctly: there is no money to show yet.

**Held versus Released is `jobs.status <> 'complete'` versus `= 'complete'`, nothing finer.** A job does not partially release as stages complete; the whole figure moves at once, when `sync_job_status()` marks the job complete. If a worker expects a partial figure for a partially finished multi-stage job, that expectation is ahead of what this repository tracks today: no per-stage money split exists anywhere.

**"Released" never means paid.** There is no payment integration in this codebase. It means the client has approved and Yaadly's part is done; the actual transfer happens off-platform, by whichever of bank transfer, Lynk or remittance the worker and client already arranged, within the 3 working days the portal promises. If a worker says they were never paid after a job released, that is a real-world payment problem between them and the client, not a bug in this page.

**Recording how they were paid is the worker's own note**, through `record_pay_info()`, refused for any method that is not `bank_transfer`, `lynk` or `remittance`, and refused outright for a job that is not theirs. It does not confirm anything to the client and does not touch `job_quotes` or `stage_approvals`. If a worker's recorded method or reference is wrong, they change it themselves on the same page; there is no admin override for this because there is nothing here for an admin to be more right about than the worker.

---

## A video walkthrough request or confirmation is refused

**Read the refusal, it names the reason**, same as `approve_stage`.

- **"That is not your job to request a walkthrough on, or it has no worker yet."** Either the signed-in email is not `jobs.client_email`, or `jobs.worker_email` is empty. There is nobody to walk the site yet.
- **"Choose WhatsApp video, Google Meet or Zoom."** Only those three platform values exist; nothing else is accepted on either `request_walkthrough` or `confirm_walkthrough`.
- **"No walkthrough has been requested on this job, or it is not yours to confirm."** From `confirm_walkthrough`: either `signoff_method` is not `'walkthrough'` yet (nobody asked), or the signed-in email is not `jobs.worker_email`.
- **"A link is needed to confirm the call."** `confirm_walkthrough` refuses an empty link outright; there is no such thing as confirming without a real one.

**To see the current state of a walkthrough on a job:**

```sql
select walk_platform, walk_link, walk_date, walk_who, walk_notes, signoff_method
  from jobs where id = 'JOB-XXXX';
```

`walk_platform` set with `walk_link` null means requested, waiting on the worker. Both set means confirmed. All null means nothing has ever been asked for, or it was cancelled.

**A worker confirming a second time, or the client requesting again, is not a bug.** A fresh client request clears any confirmed link and `walk_who`, on purpose: a changed date makes the old link stale, and the worker needs to see the request has changed rather than a link nobody would show up for looking still current.

**This never blocks the Approve button.** `approve_stage()` does not read `signoff_method` at all. If a client says they cannot approve because a walkthrough is pending, that is a UI question or a misunderstanding, not this system enforcing an order; the button is available regardless of where a walkthrough request stands.

**Nothing here calls a video API.** There is no Zoom, Meet or WhatsApp integration in this repository. The link a worker enters through `confirm_walkthrough` is whatever they pasted in themselves, from a call they arranged over WhatsApp the ordinary way. If a link does not work, that is between the worker and whichever service they used to create it, not something to look for in this code.

---

## A worker's arrival check-in did nothing, or the client says they were not told

**Check whether the row actually landed:**

```sql
select stage, arrived_at, arrived_on, arrived_by
  from arrival_log where job_id = 'JOB-XXXX'
 order by arrived_at desc;
```

No row for today at all means `log_arrival()` was never called successfully; check the caller was actually signed in as `jobs.worker_email` for that job. A row exists but the client says they heard nothing: check `net._http_response` the same way as any other notification (see "A client says they were never told" above) for a `worker_on_site` entry against that job id and timestamp.

**A second tap the same day is expected to do nothing new.** `arrival_log` has a unique constraint on `(job_id, stage, arrived_on)`; `log_arrival()` detects the existing row and returns `already_logged_today: true` rather than inserting again, so there is no second notification to look for. This is not a bug, it is the whole point: one fact per stage per day, not one per tap.

**"Today" is Jamaica-local, fixed UTC-5, not the server's UTC and not the client's own timezone.** A worker checking in at 11pm Jamaica time (4am UTC the next calendar day) still logs against the Jamaica date, which is what both the check-in button's "already checked in today" state and the client's readout compare against.

## A walkthrough's notes are stuck, or a confirmation will not take

**Read the refusal.** `record_walkthrough_notes()` and `confirm_walkthrough_notes()` follow the same pattern as every other function in this file: the message names the reason.

- **"No confirmed call exists on this job to write notes against, or it is not yours."** Either `walk_link` is still null (the call was requested but never confirmed by the worker) or the caller is not `jobs.worker_email`. Notes cannot be written up for a call that never happened.
- **"There are no call notes on this job yet to confirm, or it is not yours."** `walk_call_notes` is still null, or the caller is not `jobs.client_email`.

**Editing notes after the client already confirmed them is not a bug clearing the confirmation.** It is the rule: `walk_notes_confirmed_at` and `walk_notes_confirmed_by` are reset to null the moment `walk_call_notes` changes, because a client's confirmation was given for a specific piece of text and a changed text is a new claim needing a new confirmation. If a worker says "I only fixed a typo and now it says unconfirmed again," that is working as designed; ask the client to confirm again.

**The Completion Report only ever shows the confirmed version.** A job can complete with an outstanding, unconfirmed set of walkthrough notes; the report at `/portal/jobs/[id]/completion` simply omits the whole walkthrough section until `walk_notes_confirmed_at` is set. The job page itself stays available for exactly this case: `WalkthroughPanel` keeps rendering on a completed job when `signoff_method = 'walkthrough'`, so the outstanding confirmation is never unreachable, it just will not appear on the report until it lands.

---

## A stage's confirmation method looks wrong, or a dispute needs to know how a stage was approved

```sql
select stage, approved_by, approved_at, confirmed_method
  from stage_approvals where job_id = 'JOB-XXXX' order by stage;
```

`confirmed_method` is `evidence` (the client reviewed the filed evidence remotely) or `in_person` (the client attested to physically inspecting the property themselves). It is set once, at the moment of approval, and is never edited afterward, same as everything else on `stage_approvals`.

**This never loosens anything else about the gate.** A dispute still blocks approval regardless of method, and evidence still has to be filed for the stage first: `in_person` is an additional attestation layered on top of that requirement, not an alternative to it. If a client says "I approved it, why does it still say I needed evidence filed first," the answer is: because it always does, for either method.

**`approve_stage` now takes two arguments, `p_job` and `p_method`, with `p_method` defaulting to `'evidence'`.** There is only one `approve_stage` function in the database; the original one-argument version was dropped when this landed, deliberately, because a second overload with the same effective call shape would have made every ordinary call ambiguous. If a caller sends anything other than exactly `'in_person'` for `p_method`, it is silently treated as `'evidence'` rather than refused: this field is attribution, not a gate, and a stray value should never cost somebody an otherwise-valid approval.

---

## A worker's WhatsApp evidence never landed

**Check whether their number is actually linked first.**

```sql
select worker_email, phone, active from worker_profiles
 where right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 9)
     = right(regexp_replace('<their WhatsApp number>', '\D', '', 'g'), 9);
```

No row: they have never linked a number, or linked a different one than the one they are texting from. Send them to the worker portal, "Send evidence from WhatsApp." A row with `active = false`: their profile is not published yet, and evidence intake only recognises published workers, the same gate everything else keyed on `active` already uses.

**A linked, active worker's photo still did not file: check they actually have a live job.** `lookupActiveJobsForWorker` excludes only `complete` and `cancelled`; anything else counts, including `disputed`. A worker with zero qualifying jobs right now falls through the whole evidence-intake branch untouched, exactly as if their number had never been linked, and whatever they sent is handled as it would have been before this feature existed.

**`WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` are what actually move the bytes and the reply, and they are unset on this project as of 31 Aug 2026, confirmed live.** Until Meta's Cloud API credentials exist, every media download fails cleanly (`fetchMetaMedia` returns null before attempting a network call) and every reply silently fails to send (`maybeSendReply` returns `{sent:false, reason:"WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set yet"}`), but nothing crashes and nothing is filed on a lie. This is a different credential from the Twilio ones the rest of this app's WhatsApp sending uses (Twilio Trust Hub cleared 31 Aug 2026): Meta's Cloud API is a separate setup, its own app, its own phone number registration, its own access token.

**A worker with more than one live job stuck waiting on "which job":** their pending items sit in `wa_intake_sessions` under `_lane: "evidence"` until they reply with a number, or 48 hours passes and the session is dropped (not salvaged into anything, since an orphaned photo is not a job description to write down).

```sql
select wa_id, answers->>'worker_email' as worker_email,
       jsonb_array_length(answers->'pending') as pending_count,
       answers->'job_choices' as choices, updated_at
  from wa_intake_sessions
 where answers->>'_lane' = 'evidence';
```

If a worker says they replied and nothing happened, check the reply actually matched: `pickJobChoice` accepts a plain number ("1", "2") or enough of the job's title to be unambiguous, nothing fuzzier. Anything else gets reprompted, not silently dropped, and the session stays open for another try.

**A staged object that never made it into a job's folder** sits under `evidence/_pending/` in Storage, orphaned if its session expired before a job was chosen. There is no automatic sweep for these yet; a manual `storage.from('evidence').list('_pending')` finds them if one needs clearing by hand.

---

## The evidence digest reads like the fixed sentence instead of a real update

**Check whether a text model provider is actually configured first.** `composeEvidenceReport()` returns null, silently, on anything short of a clean usable report: no provider key set (`pickTextProvider()` returns null), no evidence labels filed for that stage yet, a model call that fails or times out, unparseable JSON, or the composed text failing the same banned-language screen `yaad-inbound`'s live replies already run through. Every one of those is a deliberate fallback to the original fixed sentence, not a bug: a vague or failed digest never blocks the client being told evidence landed.

**To see whether the AI version or the fallback actually shipped for a given notification**, there is no stored copy of the sent line: it goes out and is not written back to any table. If this needs checking after the fact, the honest answer is to ask the client what the message said, or re-run the notification once the underlying cause (usually no provider key, or thin evidence labels) is fixed.

## A worker was never nudged, or a stall was never escalated

**Read `job_stall_state` first**, the actual record of what has and has not happened yet:

```sql
select j.id, j.title, j.worker_email, job_silence_hours(j.id) as hours_silent, s.nudged_at, s.escalated_at
  from jobs j left join job_stall_state s on s.job_id = j.id
 where j.id = 'JOB-XXXX';
```

**Under 72 hours silent, nothing is expected to have happened yet.** Between 72 and 168 hours, the worker should have one WhatsApp nudge and `nudged_at` should be set; the actual send can fail silently if `TWILIO_WHATSAPP_FROM` or the worker's `worker_profiles.phone` is unset; `nudged_at` gets set regardless of whether the send itself succeeded, because the STATE is "we attempted this," not "the worker definitely saw it," the same distinction every other notification in this file already draws. Past 168 hours, `escalated_at` should be set, the founder should have had an `ntfy_topic` push, and the client should have had a `job_delayed` notification; check `net._http_response` the same way as any other client notification for the actual send outcome.

**A job stops being a candidate the moment it shows real activity again**, an arrival check-in, an evidence row, or a stage approval, whichever is newest. `clear_resolved_job_stalls()` removes its `job_stall_state` row on the next run, and the clock is genuinely gone, not paused: a future stall on the same job starts counting from zero, not from where the old one left off.

**The daily check runs at 13:00 UTC (08:00 Jamaica), as `cron.job` "yaad-job-health".** To run it by hand rather than waiting for the schedule, sign in as an admin and POST to `yaad-job-health` with an `Authorization: Bearer <admin JWT>` header and no `secret` in the body; the function checks `is_admin()` as its second path, same as `yaad-vetting-purge`.

## The Stalled jobs view in concierge is empty, or shows nothing for a worker you know stalled

**It only ever shows what `job_stall_state` actually holds, and only for the last known nudge or escalation, not a live re-check.** If a job has clearly gone quiet but nothing shows, the daily cron has not run since it crossed 72 hours yet, or it ran and found the job did not qualify (check `job_silence_hours()` directly, above). This view is deliberately a record, not a dashboard that recalculates itself on every page load.

**If it shows nothing at all, even after confirming real stalls exist, check `is_admin()` for the signed-in account first.** `worker_stall_history` is `security_invoker`, reading through an admin-only RLS policy on `job_stall_state`; a real, verified security fix (31 Aug 2026), and a signed-in account that is not in the `admins` table gets zero rows from this view by design, the same as it would from anywhere else in concierge.

---

## Worker WhatsApp evidence now runs on Twilio, not Meta

**There is no Meta setup to finish. It was tried, reverted, and moved.** `yaad-whatsapp-webhook` (Meta) is back to client intake and worker signup only, exactly as it was before 31 Aug 2026. The photo-texting feature lives in `yaad-inbound` now, on the number already registered with Twilio.

**A worker's evidence message is recognised by three things, checked in this order inside `yaad-inbound`:** the channel is `whatsapp` (not plain SMS), the sender's number matches a published (`active = true`) worker's `worker_profiles.phone` on the last 9 digits, and the message carries an image or video attachment. Miss any one of those and the message falls through to the ordinary client-intake pipeline this endpoint has always run, unchanged.

**To see whether a worker's number is actually linked**, same query as before, table and matching logic are unchanged by the provider switch:

```sql
select worker_email, phone, active from worker_profiles
 where right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 9)
     = right(regexp_replace('<their WhatsApp number>', '\D', '', 'g'), 9);
```

**A pending "which job" session lives in `wa_intake_sessions` under `_lane: 'evidence'`, exactly as it did on the Meta build**, since that table was never provider-specific. Same query to inspect it:

```sql
select wa_id, answers->>'worker_email' as worker_email,
       jsonb_array_length(answers->'pending') as pending_count,
       answers->'job_choices' as choices, updated_at
  from wa_intake_sessions
 where answers->>'_lane' = 'evidence';
```

**If a worker's photo genuinely never arrives, check Twilio's own delivery first, not this function.** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_WHATSAPP_FROM` are the same three secrets every other WhatsApp send in this app already depends on, confirmed live and working 31 Aug 2026. If those are fine and a real message still doesn't produce a reply, check the function's own logs for a signature rejection (`twilioSigned` returning `ok:false`) before assuming the evidence-intake logic itself is at fault; that check runs before any of this code does.

**This was never fully proven with a real, signed inbound message during development**, because doing so requires `TWILIO_AUTH_TOKEN` to sign a test request, which nobody building this held. Every piece of logic underneath that signature check was verified directly against the live database; the signature check, the media fetch, and the reply mechanism are pre-existing code already handling real client messages on this same endpoint. The first real worker photo sent to the number is the genuine end-to-end proof. If it does not work as described here, that is the first place to look, not a reason to assume the whole design is wrong.

## A worker's photo never files itself. It always waits for the job's code back.

**Even with exactly one live job, nothing is filed until the worker replies with that job's own code.** This was a deliberate safety fix, 31 Aug 2026, replacing an earlier version that filed straight away when a worker's number matched only one active job. A photo is staged the moment it arrives either way, but staged is not filed: it sits in `wa_intake_sessions.answers->'pending'` until `pickJobChoice()` in `yaad-inbound` accepts the reply.

**What counts as a valid reply, in the order it is checked:** the job's own code appearing anywhere in the message (`JOB-0042`, case-insensitive, works inside a longer sentence too) beats everything else and is the one every prompt leads with; failing that, a bare ordinal number matching the position in the list Twilio was shown (`1`, `2`); failing that, an unambiguous match against a job's title. A bare "yes", the digits alone without the job's own prefix, or anything that matches more than one candidate all correctly fail and reprompt rather than guess.

**To see a worker mid-confirmation**, same query as the general evidence-session lookup above: look at `answers->'job_choices'` for what they were shown and `answers->'pending'` for what is staged and waiting. Nothing in `evidence` or the job's own record changes until that row is deleted by a successful `finalizeEvidenceItem()` call, which only runs after a match.

**If a worker seems stuck reprompting, check what they actually typed against `answers->'job_choices'` in that row first.** The most common real cause is a worker typing the bare digits ("0042") without the code's letters, which is deliberate, not a bug: the code match requires the string Twilio was shown, precisely so a worker cannot confirm a job by accident. Tell them to reply with the exact code shown in the message.

## Proving the Twilio signature check without a real Twilio secret

**Run `deno test supabase/functions/yaad-inbound/twilio-signature_test.ts` and `deno test supabase/functions/yaad-inbound/job-match_test.ts`.** Both run with no network and no live credentials, `twilio-signature_test.ts` signs a request the same way Twilio does using a throwaway test token, not the real `TWILIO_AUTH_TOKEN`, and checks `checkTwilioSignature()` in `twilio-signature.ts` agrees. This is what "the algorithm is proven, the live endpoint is not yet" actually means in practice: everything the signature check does is exercised here, the one thing not exercised is Twilio's real servers signing with the real production secret and reaching the real URL.

**If `yaad-inbound` starts refusing genuine Twilio messages with a 403**, the first thing to check is which of the three URL candidates in `checkTwilioSignature()` Twilio is actually signing against, not the test file: the trailing-slash and no-trailing-slash forms are both tried because Twilio signs whatever was typed into its own console.

**Both `twilio-signature.ts` and `job-match.ts` are separate files inside `yaad-inbound/`, deployed as part of the same function**, same as `guardrails.ts`, `otel.ts` and `textmodel.ts` already were. `supabase functions deploy yaad-inbound` picks all of them up; nothing extra needed.

## A client approves a stage by replying on WhatsApp instead of tapping the portal button

**A client's evidence_landed message always names the job's own code and says to reply with it, when there is a `client_phone` on file.** Replying with that code, on the number the job has on record, calls `approve_stage_via_whatsapp()` in Postgres, the same underlying check as the portal button (`approve_stage()`): a dispute open or nothing filed refuses it exactly the same way either route.

**To see whether a client's phone would actually be recognised**, same tail-matching convention as everywhere else in this repository:

```sql
select id, title, status, client_phone from public.jobs
 where status = 'evidence'
   and right(regexp_replace(coalesce(client_phone,''), '\D', '', 'g'), 9)
     = right(regexp_replace('<their WhatsApp number>', '\D', '', 'g'), 9);
```

**A reply only approves on an exact match against the job's own code.** No "yes", no ordinal number, no title guess, unlike the worker evidence flow: there is no session boundary on a client's plain text message, every one they send passes through the check, so only the code (copy-pasted from the message that showed it to them) is trusted. If a client says a stage was approved and nothing changed, the first thing to check is whether their reply actually contained the exact code string, not a shortened or misremembered version of it.

**`deno test supabase/functions/yaad-inbound/approval-match_test.ts`** proves the matcher, including the two cases that matter: a bare "yes" and a bare ordinal number both correctly fail to approve anything, even with only one job waiting on that client.

**Two confirmations land after a WhatsApp approval, on purpose left as is.** The function's own reply confirms immediately, and the existing `stage_released` notification (the same one a portal approval fires) follows moments later through the ordinary database trigger. Both are correct; nobody engineered around the overlap because doing so would add real complexity to a money-adjacent path to remove a harmless duplicate message.

**If `yaad-notify-client`'s evidence_landed message stops mentioning the WhatsApp reply route**, check `clientPhone` is actually populated on the job first: the hint only appears when there is a phone on file to reply from.

## A photo won't show, or an admin can't see one that should be there

**Check which of two separate things is actually broken.** `public.evidence` is one gate (the row: label, sha256, who filed it, whether it's checked); `storage.objects` is a second, separate gate on the file itself, and they can disagree. As of 31 Aug 2026 both include `is_admin()`, so an admin sees everything a job's own client or worker would. If an admin genuinely cannot see a photo that should exist, this specific grant is the first thing to check:

```sql
select policyname, qual from pg_policies
 where schemaname = 'storage' and tablename = 'objects' and policyname = 'job party can read evidence files';
```

**If a client or worker can't see their own photo**, the same policy answers it: their session's `auth.jwt()->>'email'` has to match `jobs.client_email` or `jobs.worker_email` for the specific job the file's path starts with. A mismatch there, not a broken image tag, is the usual real cause.

## Evidence photos ride on WhatsApp directly now, not only a portal link

**`evidencePhotoUrls()` in `yaad-notify-client` is what attaches them**, up to five per stage, image evidence only, video excluded. If a client says the photo never came through on WhatsApp but the portal shows it fine, check `yaadly.notify.photos_attached` on the trace for that send: zero means the function found nothing to attach (check `evidence.mime` actually starts `image/` and `evidence.stage` matches the job's current stage), a number above zero but no image received means Twilio itself rejected or failed to fetch a signed URL, worth checking the function logs for that specific send rather than assuming the attach code is at fault.

**The signed URL each photo travels on is good for five minutes, server-side, admin client, never exposed to a browser.** This has nothing to do with the portal's own signed URLs (which run through the *visitor's* session and the storage RLS policy above) or with the storage-object read policy at all; a WhatsApp send failing does not mean an admin or client has lost portal access to the same photo, and the reverse is also true.

**Two small orphaned test files remain in the evidence bucket from 31 Aug 2026's live verification**, `TEST-WA-LIVE-A/0cf5d7c6-512c-446f-a169-6ede09f9da89.jpg` and `TEST-WA-LIVE-A/12da67a9-8500-437b-b558-925cb2a85e4b.jpg`. Nothing references them; safe to delete by hand from the Storage dashboard whenever convenient. Postgres refuses a direct `DELETE` on `storage.objects`, by design, so removing them needs the Storage API or the dashboard, not a migration.

## Nobody can sign in, the code box never accepts what looks like a correct code

**Check `CODE_LENGTH` in `web/lib/portal/sign-in.ts` against what Supabase is actually issuing before assuming anything else is wrong.** This exact failure happened for real, 31 Aug 2026: the check was hardcoded to 6 digits, the project actually issues 8, and every correctly typed code was silently read as incomplete, so the button never did anything but send a fresh one. The fastest way to confirm the real length without guessing: trigger a real send and read the actual email or WhatsApp message, not the page copy, which can independently be wrong even after the number is fixed here.

```bash
grep -n "CODE_LENGTH" web/lib/portal/sign-in.ts
```

**If this number is ever wrong again, it is the one line to change**, and nowhere in `/portal/sign-in` or `/portal/join`'s own visible text should need to change alongside it: neither page names a specific digit count any more, on purpose, exactly so this class of bug cannot silently reopen the same way.

**To prove a fix to this actually works, prove it against a real code, not a fabricated one.** `web/tests/sign-in.test.mjs` covers the logic with a code built from `CODE_LENGTH` itself, which proves the branching is internally consistent, but it cannot prove the number itself is correct, only that the app trusts whatever number it is given. The only real proof is a live send: request a code from the actual deployed site, read what actually arrives, and use exactly that.

## A worker never received the draft report, or a client never got the confirmed one

**`evidence_landed` sends to the worker now, not the client.** Check `wa_intake_sessions` for a row keyed by the worker's number with `answers->>'_lane' = 'report_confirm'`: if it exists, the draft was written and sent (or attempted); if the job has no `worker_email`, or the worker has no phone on `worker_profiles`, nothing was sent and nothing was stored, silently, by design, since there is nobody to draft it for.

```sql
select wa_id, answers->>'job_id', answers->>'draft_text', answers->>'ai_summary', updated_at
  from wa_intake_sessions where answers->>'_lane' = 'report_confirm';
```

**The client only ever hears from `evidence_report_confirmed`.** If a worker replied and the client still heard nothing, check `net._http_response` for that kind specifically; a `403` there means the shared secret is out of sync again, see the entry below on regenerating it correctly. If the worker's reply never registered at all, check that the `report_confirm` session row above still exists at the moment they replied: a fresh evidence photo sent in the meantime overwrites it, since `wa_intake_sessions` holds one row per phone number, and that is a known, accepted limitation, not yet solved.

## The notify trigger secret gets out of sync (again)

**Never generate a fresh secret when adding a new trigger function that calls `yaad-notify-client`.** This mistake happened twice in one afternoon before being caught both times. The correct pattern, every time:

```sql
select substring(prosrc from '''secret'', ''([0-9a-f]+)''')
  from pg_proc where proname = 'notify_client_quote_arrived';
```

Extract the existing plaintext from an already-deployed, already-correct trigger function's own body, and bake that same value into the new one. Never call `gen_random_bytes` again once the first trigger in this file already has, or every other trigger sharing the stored hash starts failing its own check with a `403`, silently, since `net._http_response` records that as a normal completed request, not a crash.

**To check all triggers sharing this secret agree, right now:**

```sql
select
  (select value from app_settings where key = 'notify_trigger_secret_sha256') as stored_hash,
  proname,
  encode(extensions.digest(substring(prosrc from '''secret'', ''([0-9a-f]+)'''), 'sha256'), 'hex') as fn_hash
from pg_proc
where proname in ('notify_client_quote_arrived','notify_client_on_job_change','notify_client_dispute_raised','notify_worker_of_portal_comment','relay_confirmed_report');
```

Every `fn_hash` should equal `stored_hash`. If one does not, that function was regenerated with a new secret by mistake; fix it the same way, extracting the value every OTHER function still agrees on and re-baking that into the broken one, never picking a fresh value to settle the disagreement.

**Confirmed live, 31 Aug 2026: two separate instances of this drift, currently both live.** The query above, run against the real database while verifying the burst-photo debounce fix, shows `notify_worker_of_portal_comment` and `relay_confirmed_report` both reporting a `fn_hash` that does not match `stored_hash` right now, meaning a worker's WhatsApp comment notification and a confirmed evidence report relay to the client are both silently failing their own secret check today. Fix the same way as above: extract the plaintext every other trigger still agrees on, re-bake it into these two.

**A third and fourth time, same afternoon, this time with a second, worse failure riding along with it.** Found while verifying an unrelated fix (the vision resize step): the same drift again, and this time `notify_client_on_job_change()` had also lost its `evidence_landed` branch entirely, not just its secret. Whoever last edited that function to add the `walkthrough_notes_ready` condition replaced the whole function body rather than extending it, and the transition into `jobs.status = 'evidence'` that fires the entire worker-confirms-first draft/relay loop was gone, not merely mismatched. **`create or replace function` replaces the whole body. Read the function's current, live source back before changing it, every time, not just before renaming a parameter.** A function this many things depend on should be extended by reading what is there and adding to it, never rewritten from a mental model of what it probably still contains. Fixed the same way as the secret: extract the plaintext, restore `evidence_landed` ahead of whatever conditions were legitimately added, leave those additions as they were rather than reverting them. Verified live afterward: all five functions agree with the stored hash again, and a real evidence insert on a test job produced a real `evidence_landed` call.

**The same drift exists in a shape this query does not check: an environment secret, not a trigger function.** `yaad-job-health`, `yaad-followup-check` and `yaad-evidence-landed-check` are Edge Functions, not `pg_proc` triggers, so they cannot bake a plaintext into their own source the way a trigger does; they read `YAAD_CRON_SECRET` from the environment instead and send that as `secret` when calling `yaad-notify-client` directly. Confirmed live, 31 Aug 2026: `YAAD_CRON_SECRET`'s current value does **not** hash to `notify_trigger_secret_sha256` (checked with a temporary diagnostic log comparing the two SHA-256 digests directly, then removed). Every `yaad-notify-client` call these three functions make gets a silent `403`, `net._http_response`-invisible the same way a trigger's own mismatch is, since none of these three go through `net.http_post`, they call `fetch()` from inside the function itself: check `function_logs` for `"notify-client" ... 403` on the calling function, not `net._http_response`. Not yet fixed: correcting it means rotating `YAAD_CRON_SECRET` to a fresh value, hashing it, and updating `notify_trigger_secret_sha256` in `app_settings` to match, which touches every live trigger that checks that same stored hash, a bigger blast radius than any one of these three functions on its own. Confirm with Monique before rotating it.

**Fixed, 1 Sep 2026.** The secret had already been exposed and rotated; the new value sat in a Supabase Vault entry (`notify_trigger_secret_plaintext_20260831x`) with its own note to copy it into `YAAD_CRON_SECRET` via the dashboard or CLI, then delete the entry. Two attempts at the copy landed a value that still did not hash-match before a third attempt, copied by hand in the Edge Functions Secrets page, finally did: confirmed live by checking `supabase secrets list`'s displayed hash for `YAAD_CRON_SECRET` against `notify_trigger_secret_sha256` directly, not assumed from "I copied it." The Vault entry has been deleted, its job done.

**Superseded 3 September 2026: the plaintext is out of the function bodies entirely.** Everything above is history and is kept because it explains why the design changed. The secret now lives in Supabase Vault under the name `notify_trigger_secret`, and every caller fetches it at call time with `public.notify_trigger_secret()`. There is no plaintext in any function body to extract, to re-bake, or to drift, so the "extract it from a function that still agrees" pattern above no longer applies and must not be revived. Adding a new trigger that calls `yaad-notify-client` now means calling `public.notify_trigger_secret()` in the body, nothing more.

**The check, in its current shape:**

```sql
select p.proname,
       p.prosrc like '%notify_trigger_secret()%' as uses_vault_lookup,
       p.prosrc ~ '[0-9a-f]{64}'                 as carries_a_plaintext
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and (p.prosrc like '%yaad-notify-client%' or p.proname = 'notify_trigger_secret')
 order by p.proname;
```

Every row should read `uses_vault_lookup = true` and `carries_a_plaintext = false`, except `notify_trigger_secret` itself, which is the lookup rather than a caller. Confirmed live 4 September 2026: ten rows, all correct. Note this query never prints the secret, which the older queries in this section did.

**Rotating it, now that it is in Vault.** Update the Vault secret, set `app_settings.notify_trigger_secret_sha256` to the SHA-256 of the new value, and set `YAAD_CRON_SECRET` to the same new value with `supabase secrets set`. No function body has to change, which is the whole point of the move. `YAAD_CRON_SECRET` is still a separate copy held outside Postgres by `yaad-job-health`, `yaad-followup-check` and `yaad-evidence-landed-check`, so it is still the piece a rotation forgets; it fails silently with a `403` visible only in the calling function's own logs.

**The repository and the database had drifted on exactly this, found 4 September 2026.** The migration that made the Vault move was applied to production on 3 September as version `20260903083651`, but its file was never committed. That is the reverse of section 18's usual direction and it was the more dangerous way round: a rebuild from migrations would have recreated the old plaintext function bodies carrying a value that no longer works, and every client notification would have failed a `403` silently. The file has been recovered by reading the live definitions back and committing them as `supabase/migrations/20260903a_the_notify_secret_lives_in_the_vault_not_the_trigger_body.sql`. If you ever find production and the repository disagreeing about a function body, read the live one back with `pg_get_functiondef` and commit that; do not reconstruct it from memory.

## The AI photo review comes back empty

**Check the function's own console output, not just the trace.** `reviewEvidencePhotos()` in `yaad-notify-client` logs a specific reason with `console.error` on every failure path as of 31 Aug 2026: `NVIDIA_API_KEY` unset, no image URLs to review, an HTTP error from NVIDIA, or the model's response not containing a JSON array at all. Query `function_logs` for the function around the time of the send:

```sql
select timestamp, event_message from logs
where source = 'function_logs' and event_message ilike '%yaad-vision%'
order by timestamp desc limit 20
```

**Fixed, 31 Aug 2026: the refusal was the model, not the wiring.** `nvidia/nemotron-nano-12b-v2-vl` was declining outright, "I'm not going to engage in this discussion topic," on a system prompt that read like a content-moderation trigger ("reviewer", "hazards", "diagnosis", a preamble about not being a licensed surveyor). Switched to `meta/llama-3.2-11b-vision-instruct` and reworded the prompt to describe visible condition for a job log rather than "review for hazards," same categories, same JSON shape. Confirmed live: the refusal did not recur across seven live test calls after the switch. `microsoft/phi-3.5-vision-instruct` was tried as a second option and returns 404, not a valid model slug on NVIDIA's `integrate.api.nvidia.com` catalog; do not reach for it without checking the model actually exists first.

**Not fixed, and not going to be from this side: NVIDIA's hosted latency for the working model is uneven call to call.** Confirmed live the same day, same single photo, same everything else: one request back in about fifteen seconds, the next past thirty five with nothing, the next a flat `http 500 Internal Server Error`. `reviewEvidencePhotos()` now retries once, only on a timeout or a 5xx (25s per attempt), and gives up rather than trying a third time; a refusal or unparseable body is not retried, since asking the same question again is unlikely to change the answer. In a small sample of live tests after the fix, this still failed outright (both attempts) more often than it succeeded. That is a real, current characteristic of NVIDIA's free-tier hosted inference for this model, not a bug in this repository: the feature degrades correctly when it happens (the client still gets the fixed sentence, nothing crashes, nothing blocks), and `yaadly.vision.outcome` (`ok`, `timeout`/`infra_error`, `unusable_response`) plus `yaadly.vision.attempts` on the span tell you which happened without reading function_logs. If this needs to be more reliable than that, the next lever is a different vision provider entirely, not a longer timeout on this one.

**Findings are now attributed to a specific photo, not just the stage** (evidence item codes, below): each image is labelled `Photo P1:` before it in the prompt, and the model is asked to echo `photo_code` back per finding. A model that drops the label on a single-photo stage still resolves correctly (there is only one candidate); on a multi-photo stage a dropped label is left unattributed rather than guessed onto the wrong photo.

**Log query timing note.** `function_logs` entries were not reliably queryable for roughly a minute after the request that produced them, in testing 31 Aug 2026; `net._http_response`, by contrast, reflected a completed request within a few seconds every time. When chasing a fresh failure, check `net._http_response` first to confirm the request actually landed, then allow real time before concluding `function_logs` has nothing to show.

## A deployed Edge Function is suddenly missing hours of work

**This happened live, 31 Aug 2026, to `yaad-notify-client`, mid-session, with two Claude sessions working in the same tree.** `supabase functions list` showed the live version had reverted to code with no `evidence_report_confirmed`, no `evidence_comment`, no AI vision review, nothing from that day's Stage 6 or reporting-agent work, roughly six hours of shipped features gone from production in one deploy. The working tree on disk was correct the whole time; only the deployed bundle was stale.

**The cause was almost certainly a deploy tool that takes pasted file contents rather than reading from disk**, the exact failure CLAUDE.md already names ("Never paste file contents into a deploy tool. It has silently shipped a different intake flow before"), now confirmed a second, different way: a second session (or the same one, at a different point) deployed an old in-memory copy of the file over a newer one already live on the CLI path, with no warning and no version conflict shown to either side.

**Found by symptom, not by suspicion.** A live call that should have worked returned `{"error":"secret, jobId and a valid kind are required."}` for a `kind` that plainly existed in the source on disk. Reading the deployed source back (`get_edge_function` in the Supabase MCP tools, or the dashboard) showed a `KINDS` array missing that value entirely, i.e. a genuinely different, older file than the one in the working tree.

**Fixed by redeploying from disk immediately**, the ordinary `supabase functions deploy <name> --project-ref <ref>` path, which is always the fix once this is spotted: the file on disk is the source of truth, so redeploying it always wins.

**If a live call fails in a way that makes no sense against the code you are reading, check the deployed source before debugging the code further.** `get_edge_function` (or the dashboard's function source view) shows exactly what is running, which may not be exactly what is in the file in front of you, especially with more than one session active. Cheap to check, expensive to assume.

## A worker or client's comment did not attribute to the right photo

**Every evidence row now carries a short `item_code`** (`P1`, `P2`, ...), assigned automatically at insert, sequential per job in filing order (20260831zzzz2). Check it directly:

```sql
select item_code, label, stage, created_at from evidence
 where job_id = 'JOB-XXXX' order by created_at;
```

**A comment only attributes to one photo when the message actually names its code.** `pickEvidenceItem()` in `supabase/functions/yaad-inbound/evidence-item-match.ts` requires a `p` or `P` immediately before the digits, word-bounded (`p1` matches, `p12` does not match `P1`, a bare `1` never matches). A plain comment with no code sets `evidence_comments.evidence_id` to null, exactly as it did before item codes existed: it is still read as being about the whole stage, not guessed onto one photo.

**The portal writes `evidence_id` directly**, no code-parsing involved: `EvidenceItemComment.tsx` on `EvidenceLedger.tsx` calls `commentOnEvidence()` in `web/app/portal/job-actions.ts` with the exact evidence row's own id, since the client is looking straight at the photo they are commenting on.

**A stray code that matches nothing on that job's own list attributes to nothing**, same as no code at all, rather than guessing the nearest one. If a client swears they typed a code and it did not attribute, check the digits against `item_code` on that stage exactly: `P9` on a stage that only goes up to `P3` will not match.

**Two AI vision findings for the same stage now carry a `photo_code` each, assigned by which call produced them, not parsed from the model.** `reviewOnePhoto()` in `yaad-notify-client` reviews exactly one photo per call, run in parallel across a stage's photos, because NVIDIA's hosted `meta/llama-3.2-11b-vision-instruct` refuses more than one image in a single request (`http 400`, "At most 1 image(s) may be provided in one prompt"), confirmed live 31 Aug 2026. `summariseFindings()` prefixes each note with its code in the text a worker reads, but only when the stage has more than one photo, so a single-photo stage's message stays uncluttered. A partial result is expected and correct, not a bug: if one photo's call fails and another's succeeds, the ones that worked still ship.

## A client's comment on one specific photo went nowhere, or a worker never saw the button

**The button is `EvidenceItemComment.tsx`, client-only, one per photo in `EvidenceLedger.tsx`.** It only renders for `role === "client"`; a worker never sees it, and even a stray client-side bypass would be refused by the RLS insert policy on `evidence_comments` (`client writes an evidence comment from the portal`, 20260831z), which locks `from_role = 'client'` and `origin = 'portal'` and checks the signed-in email against `jobs.client_email` itself. Checked live by impersonating three identities directly against the database: the job's real client succeeds, its own worker is refused, and a stranger is refused, all before any application code runs.

**It is write-only, on purpose, matching the WhatsApp half of the same loop.** There is no persisted thread view in the portal for either channel yet: a client's WhatsApp comment isn't shown back to them there either. Building a full comment thread view is a separate, bigger piece of work than the button that was asked for; if a client says "I don't know if the worker saw it," the honest answer today is that they get a "Sent to the worker" confirmation and the worker gets a real WhatsApp notification (`yaadly.evidence_comment.worker_notified` on the trace), not a visible reply back in the portal.

**To see what was actually written**, `evidence_comments.origin = 'portal'` is the whole filter:

```sql
select stage, evidence_id, body, created_at from evidence_comments
 where job_id = 'JOB-XXXX' and origin = 'portal' order by created_at;
```

## A promised next step was never followed up, or a worker got an unexpected draft to confirm

**Read `job_followups` first**, the actual record of what was promised and when it is due:

```sql
select stage, reason, created_at, due_at, fired_at from job_followups
 where job_id = 'JOB-XXXX' order by created_at desc;
```

**A row only exists when the reporting agent actually named a real next step.** `composeEvidenceReport()`'s own `what_happens_next` field creates or refreshes one (`create_job_followup`, called from `yaad-notify-client`'s `evidence_landed` branch) whenever that text is non-empty and does not start with "nothing"; a report that said there was nothing further leaves no row, correctly, since there is nothing to check back on.

**One pending row per job and stage.** A fresh report on the same stage before the old promise is due replaces it (same reason column, refreshed due date), rather than the two piling up: `job_followups_pending_uniq` is a partial unique index on `(job_id, stage) where fired_at is null`, and `create_job_followup` upserts against exactly that.

**`fired_at is null` rows disappear on their own once the stage shows real activity, before the reply.** `clear_resolved_followups()`, run first on every `yaad-followup-check` call, deletes a pending row the moment evidence, an arrival, or a stage approval lands on that job and stage AFTER the row's own `created_at`. This is not a bug if a follow-up "vanishes" before its due date: it means the promised thing (or something else on that stage) already happened.

**If `due_at` has passed and `fired_at` is still null, the daily check has not run yet, or it ran and the re-notify call itself failed.** `yaad-followup-check` runs at 14:00 UTC as `cron.job` "yaad-followup-check", one hour after `yaad-job-health`. It marks a row fired whether or not the re-notify call to `yaad-notify-client` succeeded, the same "we attempted this" distinction every other notification in this file already draws; check `net._http_response` for a fresh `evidence_landed` call against that job around the time `fired_at` was set to see whether it actually landed.

**What actually happens when one fires: the exact same worker-confirms-first draft/relay loop `evidence_landed` already runs**, not a second, different reminder. The worker gets a fresh drafted report to confirm or rewrite, based on whatever evidence exists on the stage right now; nothing here invents new wording or messages the client directly. If a worker says "I got a random draft to confirm out of nowhere," check `job_followups` for a row on that job whose `due_at` matches: this is very likely why.

**To run the check by hand rather than waiting for the schedule**, sign in as an admin and POST to `yaad-followup-check` with an `Authorization: Bearer <admin JWT>` header and no `secret` in the body, same as `yaad-job-health`.

**Never a payment decision.** `approve_stage()` does not read this table, and nothing in `yaad-followup-check` touches `jobs.status`, `stage_approvals` or `evidence` directly; it only ever calls `yaad-notify-client`, the same door every other coordination notification in this repository already goes through.

## A client can book a worker by replying on WhatsApp, no account needed

**Since 1 Sep 2026 this only ever works when exactly one quote is open on the job.** `choose_worker_via_whatsapp()` refuses outright, telling the client to use the portal link, the moment more than one `job_quotes` row is `status = 'submitted'` — deliberately, because more than one quote can now be live at once (a client can accept more than one and compare Kickoff Packs) and this door has no way to ask which one a bare "yes" was about. Its own `scope_agreements` pre-check is no longer what actually books anyone; the real gate lives one call further in, inside `_do_choose_worker()` (next section). A reply that passes this door's own check can still be refused there if that quote's Kickoff Pack is not yet confirmed by both sides.

```sql
select id, status, worker_email from job_quotes where job_id = 'JOB-XXXX';
```

- More than one row `status = 'submitted'`: the reply was refused with "More than one price is open on this job. Use the link to choose." Working as designed; send the client their portal link.
- Exactly one `submitted` row and nothing happened: check `yaadly.whatsapp_quote_accept.outcome` on the trace for that message; most likely the reply did not contain the job's own code exactly, the same strict match `approve_stage_via_whatsapp()` uses.
- The reply went through but the job still shows no worker: check that quote's own Kickoff Pack next (see "Choosing a worker now refuses" below) — `_do_choose_worker()` needs `both_confirmed_at` set on it, which a bare WhatsApp "yes" cannot produce on its own.

**The price message a client replies to states the worker's proposed scope, not only the price.** `yaad-notify-client`'s `quote_arrived` kind reads `job_quotes.note`; if a worker left that blank, the client only sees the price. If this matters for a specific job, ask the worker to add a line to their quote and re-submit.

**`choose_worker_via_whatsapp()` and `choose_worker()` are two doors onto the exact same `_do_choose_worker()` core**, same as `approve_stage()`/`approve_stage_via_whatsapp()`. A change to booking rules belongs in `_do_choose_worker()`, never duplicated into either door separately.

## `request_kickoff_as_me()` (the no-account `/jobs/[id]/quotes` page, and the signed-in portal) asks for a Kickoff Pack, it does not book

**As of 1 Sep 2026 this replaced `accept_quote_as_me()`, which is deleted.** Accepting a quote used to book it outright; now it only flips that quote's `job_quotes.status` from `submitted` to `kickoff_requested`, touching nothing on `jobs`. A client can call it again for a different quote on the same job — that is the point, not a bug to guard against. If a client says they "accepted" a price and the job still shows no worker, that is correct: booking now only happens through `choose_worker()`/`chooseQuote`, once that quote's Kickoff Pack is confirmed by both sides (next section).

```sql
select id, status, worker_email, worker_name from job_quotes where job_id = 'JOB-XXXX';
```

`kickoff_requested` on more than one row at once is expected and fine. `submitted` never moves on its own; nothing polls for it. If a quote is stuck on `kickoff_requested` with no draft or pack appearing, see "A worker never gets told a Kickoff Pack exists" below.

**If a client says they pressed the button and nothing ever happens** (status stays `submitted`, no draft, no pack, ever), check `job_quotes_touch()` is still the version from `20260901h`. This function silently reverts any status change from a non-admin caller unless the transaction first sets `set_config('yaadly.choosing', '1', true)` — the whole reason `request_kickoff_as_me()`, `_do_choose_worker()` and `choose_worker_via_whatsapp()` all wrap their own status updates in it. A new status-changing function that forgets this will look exactly like this: the RPC succeeds, returns a job id, and nothing in `job_quotes` moves. This has now happened twice for two different functions (`accept_quote_as_me()` before 31 Aug, `request_kickoff_as_me()` on 1 Sep) — if a THIRD function ever needs to write `job_quotes.status`, set the flag around it on the first draft, not after finding this section.

## A burst of WhatsApp photos only got one evidence_landed message, later than the first photo

**This is by design, not a delay to chase.** `evidence_landed` no longer fires the moment the first photo of a stage lands; every evidence insert resets a 90 second quiet timer for that job and stage (`evidence_landed_pending`, `20260831zzzz6`), and the notification only actually goes out once nothing new has landed for the full 90 seconds, checked once a minute by `yaad-evidence-landed-check` (`20260831zzzz7`). One photo still notifies, just after a short pause; several photos sent close together get one notification covering all of them instead of one covering whichever photo happened to land first, which was the actual bug this replaced.

**To see an open timer, or check whether one already fired:**

```sql
select job_id, stage, created_at, due_at, fired_at from evidence_landed_pending
 where job_id = 'JOB-XXXX' order by created_at desc;
```

`fired_at is null` means still waiting out the quiet window (or waiting on the once-a-minute check to notice it has elapsed, up to a minute past `due_at`). `fired_at` set with no `evidence_landed` having reached anyone means `due_evidence_landed_notifies()` found the stage no longer worth notifying about at check time, evidence landed but the stage was approved, disputed, or moved past in the meantime, the same "real activity already answered it" clearing `job_followups` does; this is correct behaviour, not a dropped notification.

**If a timer fires (`fired_at` set) but nobody was actually told**, check `yaad-evidence-landed-check`'s own logs for a `403` from `yaad-notify-client` first: `YAAD_CRON_SECRET` not matching `notify_trigger_secret_sha256` (see "The notify trigger secret gets out of sync (again)", above) is a live, confirmed cause as of 31 Aug 2026, not hypothetical. If that check comes back clean, the fault is downstream in `yaad-notify-client` itself (no worker phone on file, an AI review failure, a Twilio send failure), the same causes as `evidence_landed`'s existing failure modes elsewhere in this file, not anything specific to the debounce.

**Retuning the 90 second window** is one constant, `interval '90 seconds'` in `schedule_evidence_landed_notify()`, plus the cron cadence itself if the check needs to run more or less often than once a minute (`cron.schedule('yaad-evidence-landed-check', ...)`, `20260831zzzz7`). Both need a new migration, not a dashboard edit, same as every other constant in this file that has one.

## Choosing a worker now refuses with "choose unlocks once this worker's Kickoff Pack is confirmed by both sides"

**That is the intended behaviour, not a bug.** As of 1 Sep 2026, `_do_choose_worker()` requires the specific quote being chosen to have its own `kickoff_packs` row with `both_confirmed_at` set — drafted, approved, and signed by both the client and that worker. Not any pack on the job: that quote's own, matched by `quote_id`. To check what a specific quote actually has:

```sql
select p.id, p.quote_id, p.status, p.both_confirmed_at
from kickoff_packs p where p.job_id = '<job id>' order by p.updated_at desc;
```

No row for that `quote_id`: the client has not requested one yet (`job_quotes.status` should be `kickoff_requested`; if it is still `submitted`, that is why), or it is still drafting — see the next section. A row with `both_confirmed_at` null: one or both sides have not confirmed it yet, check `kickoff_pack_agreements` (see "A client or worker can't confirm the Kickoff Pack" below).

## The portal stage rail is showing generic labels instead of the Kickoff Pack's own stage names

**Check that the job actually has an *approved* pack, not just a drafted one.** `jobStages()` in `web/lib/portal/journey.ts` only reads `payment_schedule.stages` from a pack whose `status = 'approved'` (`page.tsx`'s `trulyApprovedPack`, deliberately with no fallback to a draft) - showing unconfirmed AI content as if it were the live stage structure would be exactly the mistake the human-approval gate exists to prevent. A job whose worker was chosen before 31 Aug 2026 has no approved pack and will always show the old fixed rail; that is the correct fallback, not a defect, and nothing needs fixing for it.

**The amount shown against the current stage** is computed on the page, not stored anywhere: `proportion_percent` of the accepted quote's `labour_jmd`. If it looks wrong, check those two numbers directly rather than looking for a third, cached figure, there isn't one.

## The Kickoff Pack pages on the portal

**Nine documents, each its own page**, `/portal/jobs/[id]/pack` (the table of contents) and `/portal/jobs/[id]/pack/[doc]` (one document, with prev/next), replacing the single long-scroll page from before 31 Aug 2026. The list of documents and how each one renders lives in one place, `web/lib/portal/packDocs.tsx`, shared by both pages so they can never drift into naming a document two different things.

**`human_review_notes` is not one of the nine and never will be shown here.** It is Monique's own pre-issue checklist against the draft, not client-facing content; it stays visible only in the concierge desk's Kickoff Packs view.

## A client or worker can't confirm the Kickoff Pack, or the "both confirmed" tick never appears

**The confirm section only shows once the pack is `approved`.** Since 1 Sep 2026 that can happen before anyone is booked (`yaad-kickoff-check` auto-issues a guardrail-clean draft), so `agree_kickoff_pack()` no longer matches the worker side against `jobs.worker_email` alone: it checks the pack's own `quote_id` first, via `job_quotes.worker_email`, and only falls back to `jobs.worker_email` for the post-booking case. Same for the RLS that lets the page load at all (`kickoff_packs`, `kickoff_pack_agreements`, and `jobs` itself for a worker's own portal pages) — all three also match a worker via `job_quotes.worker_user`, not only a booked `jobs.worker_email`. If a worker with a live quote can't even open `/portal/jobs/[id]` or `/portal/jobs/[id]/pack`, check those three policies are still the versions from `20260901g`, not reverted.

**A job with more than one Kickoff Pack in flight**: `/pack` and `/pack/[doc]` take an optional `?quote=` to say which one; failing that, they fall back to matching the confirm code in the link, and only fall back to "the job's latest updated pack" for an old link with neither. If someone reports seeing the wrong worker's pack, check which of the three the URL they used actually carried.

**"That confirmation code does not match the current version of this pack"** means exactly what it says: the code being submitted does not match `kickoff_packs.confirm_code` right now. The two ordinary causes are someone confirming from an old WhatsApp link after the pack was revised (a real revision issues a new code, on purpose, so a stale link fails rather than silently confirming content that changed), or a copy-paste error. Reopening the pack page fetches the current code fresh; the on-page button never needs one typed by hand.

**To check who has confirmed what, for a given job:**
```sql
select p.id, p.rev, p.both_confirmed_at, a.side, a.email, a.agreed_at
from kickoff_packs p
left join kickoff_pack_agreements a on a.pack_id = p.id and a.rev = p.rev
where p.job_id = '<job id>'
order by p.updated_at desc;
```
Two rows (`client`, `worker`) for the current `rev` and `both_confirmed_at` set means both sides have signed this exact revision. One row, or none, means it is still waiting on someone.

## A job doesn't show up on the Job Invoices view, or its "Raise & send" button won't light up

**Check three things exist, in this order**, in concierge or SQL:
```sql
select id, worker_email from jobs where id = '<job id>';
select job_id, status from job_quotes where job_id = '<job id>' and status = 'accepted';
select job_id, status from kickoff_packs where job_id = '<job id>' and status = 'approved';
select job_id, stage from stage_approvals where job_id = '<job id>';
```
No `worker_email`: the job never appears on this view at all, it only lists booked jobs. No accepted quote, or no approved pack: the job appears in neither the "no jobs" empty state nor a card - `raise_job_stage_invoice()` and the view's own render both need both to compute a fee, and silently skip a job missing either rather than showing a broken card. A stage's button stays disabled ("Waiting on evidence") until a `stage_approvals` row exists for that exact stage number - the same gate `_do_approve_stage()` writes, portal or WhatsApp.

**"Stage % on this job has already been raised."** Not a bug: `invoices.stage` plus `job_id` is the exact check, and any invoice in a non-void status counts, including a `draft` one you haven't sent yet. Void it first if it was raised in error, then raise again.

## Raise & send didn't email anybody, or a client can't see their invoice

**"RESEND_API_KEY is not set..."** means the invoice raised correctly (check Recent invoices in concierge, it will be sitting there as a `draft`) but `yaad-invoice`'s `send` action could not reach Resend. Set the secret, then open that draft, render it, and mark it sent by hand, or re-raise once the secret is in place - raising again for the same service is harmless, it just numbers a fresh pair.

**A client says they can't see an invoice in their portal.** Check `invoices.service_id` is actually set on the row - `/portal/services/[id]/page.tsx` filters on it, so an invoice raised without one (the free-text drafting flow only sets it if the admin passes one) is invisible there even though RLS would let the client read it. `raise_service_invoice()` always sets it when called with `p_service_id`; the concierge "Raise & send" card does not currently ask for one, since no real service booking carries a `catalogue_id` yet for it to look up (`services.type` is free text, not linked to `service_catalogue`) - that link is the next real gap, not this one.

**"An AI-drafted invoice needs a human to read it first."** Working as designed: `send` refuses a `drafted_by = 'ai'` invoice outright. Render it from the free-text drafting card's own flow, check the lines, then use that card's own "mark sent" instead.

## A client replies with a job code to book a worker and nothing happens, or "No price is open on this job to accept"

**Check `job_quotes.status` and `jobs.status` together, not either alone:**
```sql
select id, status from job_quotes where job_id = '<job id>';
select id, status, client_phone from jobs where id = '<job id>';
```
As of 1 Sep 2026, a quote ready to book sits at `kickoff_requested`, never `submitted` - `submitted` means nobody has asked for a Kickoff Pack against it yet. If `jobs.status` reads `open_for_quotes` instead of `quoted` while a real quote exists, that is stale: touch the row (any update fires `sync_job_status()`) and it corrects itself, matching `20260901l`. If it stays wrong after that, `sync_job_status()` itself has regressed - it must count `kickoff_requested` alongside `submitted` when deciding a job has a live quote.

**If the reply is accepted but refuses with "choose unlocks once this worker's Kickoff Pack is confirmed by both sides"**, that is the real, correct gate: see "Choosing a worker now refuses" below for how to check both sides have actually confirmed. There is no other path to booking by WhatsApp; `choose_worker_via_whatsapp()` no longer has its own separate readiness check to get out of sync with this one (`20260901m` removed it, and the `PENDING_WORKER_SCOPE` message with it - if anyone reports seeing that exact phrase, the code they are running predates that fix).

## A worker (or client) can confirm a Kickoff Pack by replying with the job code, no portal needed

**As of 1 Sep 2026 this is the worker's ONLY way to confirm.** The portal's "Confirm as the worker" button is gone, on purpose (CLAUDE.md §9: the worker's surface is WhatsApp, full stop). The client still has a portal button too; either side can also just reply to the WhatsApp message with the job's own code.

```sql
select p.id, p.job_id, p.both_confirmed_at,
  exists(select 1 from kickoff_pack_agreements a where a.pack_id=p.id and a.rev=p.rev and a.side='client') as client_confirmed,
  exists(select 1 from kickoff_pack_agreements a where a.pack_id=p.id and a.rev=p.rev and a.side='worker') as worker_confirmed
from kickoff_packs p where p.job_id = '<job id>' order by p.updated_at desc;
```

**"That did not go through: No Kickoff Pack on this job is waiting on your confirmation right now."** Either this phone is not on file as the client (`jobs.client_phone`) or the worker (`worker_profiles.phone`, matched through that job's own quote) for this specific job, or that side already confirmed. `agree_kickoff_pack_via_whatsapp(p_job, p_phone)` checks only the named job, never "does this phone have anything pending anywhere" - a worker can have more than one real pack waiting at once, on different jobs, and replying with one job's code must never touch the other. Getting this wrong is exactly the bug found and fixed live the night this shipped (`20260901j`, `20260901k`); if this ever regresses, that is what broke.

## A worker's quote form never shows Yaadly's own starting draft

**Check `quote_pack_drafts.status` for that job, not just whether a row exists.** As of 1 Sep 2026 (`20260901r`) a draft has to be `approved` before RLS will even let a worker read it - `ready` alone used to be enough and no longer is, on purpose, the same review gate the big Kickoff Pack already had.

```sql
select job_id, status, approved_by, approved_at, guardrail from quote_pack_drafts where job_id = '<job id>' order by created_at desc;
```

- No row: `yaad-quote-pack-check` has not picked the job up yet, or it does not qualify - open, unassigned, stage 0, non-empty `descr`.
- `status = 'ready'`, no `approved_by`: waiting on the automatic guardrail check (runs alongside the request poll, once a minute) or held for a human. Check `guardrail` for `price_language_detected` / `banned_language_detected`; either one means it is held on purpose, visible in the concierge desk's Quote Pack Drafts view, approve manually from there once fixed (`approve_quote_pack_draft`, refuses outright while either flag is set, same as the big pack's own manual door).
- `status = 'approved'`: should be visible. If a worker still reports nothing, check `/jobs`'s own query is filtering to `vmode === "worker"` and the job is genuinely still open, unassigned, stage 0 - the same `jobs` conditions the RLS policy checks independently.

## A quote somehow has two Kickoff Packs, with two different confirm codes

**Should be impossible as of 1 Sep 2026** (`20260901q`): `kickoff_packs.quote_id` is now unique. Caused once, live: `yaad-kickoff-check` triggered by hand (concierge, or testing) landing in the same window as pg_cron's own minute-tick - Phase 2 reads every ready, unlinked draft once per call, and two calls close enough together can both read before either writes. The constraint turns that race into a clean insert failure (already handled, logged as `linkFailed`) instead of a silent duplicate. If this ever shows up again, check for a second thing invoking `yaad-kickoff-check` on the same cadence as the cron.

## A worker never gets told a Kickoff Pack exists, or a quote never gets one drafted at all

**As of 1 Sep 2026 a pack is requested BEFORE anyone is chosen, not after.** `request_kickoff_as_me()` (portal click) moves a quote to `job_quotes.status = 'kickoff_requested'`; `yaad-kickoff-check` (pg_cron, once a minute) polls for exactly that, per quote, not per job, requests a draft from `yaad-kickoff` carrying that `quote_id`, links a guardrail-clean finished draft straight to `'approved'` against that same `quote_id`, and that transition fires `notify_worker_kickoff_pack_ready`, which now also carries `quote_id` so the right worker gets told about the right pack.

**If a quote has been `kickoff_requested` for more than a couple of minutes with still no pack:**
```sql
select d.id, d.quote_id, d.status, d.error, d.created_at, d.finished_at
from kickoff_drafts d
where d.job_id = '<job id>'
order by d.created_at desc;
```
- No rows at all: `yaad-kickoff-check` has not picked it up yet, or the job does not qualify. It only considers a quote whose job has a non-empty `descr` (used as the intake's `brief`); missing that, the quote sits out of the poll silently, not stuck, just never eligible. Check `jobs.descr` is actually set.
- A row stuck at `'drafting'` for several minutes: the background model call is still running (normal, up to a few minutes) or was culled by the platform's worker lifetime limit without ever writing `'failed'` (rare). Three consecutive `'failed'` drafts for the same quote stop the poller from retrying it automatically, on purpose. `draftPart()` logs the actual raw model content on a parse failure (`console.error`, added 1 Sep 2026) — check `function_logs` for `yaad-kickoff` before guessing at the cause.
- A row at `'ready'` but still no pack: check its `guardrail` column. Any of `price_language_detected`, `banned_language_detected` or `foreign_text_detected` being `true` holds it back deliberately. It stays visible in the concierge desk's Kickoff Drafts view; fix or redraft it, or link it manually from there once clean.

**If a pack shows `status = 'approved'` but the worker says they never heard anything**, that is the notify side, not the drafting side: check `function_logs` for `yaad-notify-client` for a `403` (secret mismatch, see "The notify trigger secret gets out of sync (again)" above) or check the worker actually has a phone on `worker_profiles` (no phone means `emailed: false, whatsapp: {sent: false, reason: "no recipient phone on the job"}` in the response, since this kind never attempts email). `yaad-notify-client` resolves the worker via the quote named in `meta.quoteId`, not `jobs.worker_email` (still blank pre-booking) — if that `meta` is missing on the trigger's own payload, check `notify_worker_kickoff_pack_ready()` is the `20260901g` version.

**A worker with a live, unbooked quote appears on their own worker portal job list.** `/portal/worker` and the door page (`(gated)/page.tsx`) both widen their worker filter with a direct `job_quotes` lookup (`worker_user = auth.uid()`), not only `jobs.worker_email`, so the WhatsApp link is a shortcut into the job, not the only way in. It reads `status = 'quoted'` ("You have quoted, waiting on the client") through the whole compare-and-choose window; that label already existed and needed no change, since it was already true.

**The service role key is what authorises the automatic path, not a shared secret.** `yaad-kickoff` accepts a call as either a real admin session or a request whose `Authorization` bearer exactly equals `SUPABASE_SERVICE_ROLE_KEY`. If that secret is ever rotated in the Supabase dashboard, `yaad-kickoff-check` picks up the new value automatically on its next cold start (both read the same project secret), so there is nothing to keep in sync by hand the way `YAAD_CRON_SECRET` needs to be, the whole reason this path was built this way rather than with another baked-in trigger secret.

## The concierge "Built a job, never signed" (Intake) panel and its badge count

Reads `jobs` where `status = 'awaiting_client_setup'`, as of 1 Sep 2026. It used to read `client_user is null`, and nothing in this repository, on any intake path, has ever written `jobs.client_user`, so before that date the panel showed almost every job forever, live and finished ones included, and never cleared once a client actually signed up. If this panel is ever showing something that does not match what you would expect from `status`, that is the thing to check, not the `client_user` column, which is dead.

## You expect a "New job" push or email for something that arrived on WhatsApp

**There is one WhatsApp path now: `yaad-inbound`, over Twilio.** `yaad-whatsapp-webhook`, a second, direct-Meta-Cloud-API function that duplicated part of this, never received real traffic (Meta was never approved) and was deleted 1 Sep 2026. Its `notifyAdmin()` fires twice per conversation: once on the first message of a new thread, so a lead is never silently sitting there before it is even a real job, and once when the job reaches `stage = 'done'`. If neither push nor email arrived for a real message, check `app_settings.ntfy_topic` and `admin_email`, and `RESEND_API_KEY`, the same three this function's own error logging names.

A session in this repo spent real effort fixing two bugs in `yaad-whatsapp-webhook`'s dormant guided-intake code (`trade` not written to the column, no admin notification) before realising it was testing a function that could never receive a real message; `yaad-inbound` already did both correctly on its own, independently, before either fix existed. Founder's instruction, same session: strip the dead code and delete the file rather than leave it to confuse whoever reads this next. Both the client-intake code that prompted the fixes and the worker-signup lane living in the same file went with it. Full account in DECISIONS.md, 1 Sep 2026.

## A worker's quote form shows blank scope/timeline/payment fields instead of a drafted starting point

**Expected the first minute or two after a job goes live.** `yaad-quote-pack-check` polls once a minute for jobs matching `open_jobs`' own definition of live (`open = true`, unassigned, `stage = 0`) with no `quote_pack_drafts` row yet, and requests one from `yaad-quote-pack`. Check the draft directly:

```sql
select id, status, error, guardrail from quote_pack_drafts where job_id = 'JOB-XXXX' order by created_at desc;
```

- No row at all: the cron has not caught it yet (wait up to a minute), or the job is missing a `descr` (`skippedNoBrief` in the cron's own response) — nothing drafts without a brief.
- `status = 'drafting'` for more than a few minutes: check `yaad-quote-pack`'s own logs; the model call has a 120s timeout, so it should resolve to `ready` or `failed` well before that.
- `status = 'failed'` three times running: the cron stops requesting more (`skippedTooManyFailures`), same backoff shape as `yaad-kickoff-check`. Read `error` and fix the underlying cause before it will try again; nothing auto-retries past three.
- `status = 'ready'` but the worker still sees blank fields: check `guardrail`. `QuotePanel.tsx`'s `usableDraft()` refuses to show a draft with `price_language_detected` or `banned_language_detected` set, on purpose, and falls back to blank editable fields rather than a document that leaked a price or the word escrow into a live quote. There is no admin-desk view onto this yet (unlike the big Kickoff Pack's own Kickoff Drafts view); a dirty draft is only visible by querying the table directly, as above.

**One draft per job, not per worker.** Every worker who opens the quote form for that job sees and edits their own copy of the same starting draft; editing it happens client-side in `QuotePanel.tsx` and is never written back to `quote_pack_drafts`. What actually goes to the client lives on `job_quotes` (`scope_summary`, `included_note`, `excluded_note`, `timeline_note`, `payment_stage_note`), written once, by `submitQuote()`, when the worker sends.

**This is a different agent from the big Kickoff Pack and fires at a different moment.** `yaad-quote-pack` drafts once, when a job goes live, and is never client-facing on its own. `yaad-kickoff` drafts per accepted quote, when a client requests one (`kickoff_requested`), and becomes the actual client-facing document once guardrail-clean. If a worker reports the wrong one (a 12-section document instead of a short overview, or vice versa), check which function actually ran in the trace, not just which cron fired: both poll once a minute and can look similar in the logs at a glance.

## Signing in to the admin desk dead-ends on desk.yaadly.co.uk

**Fixed 1 Sep 2026, dashboard only, nothing in this repo changed.** The Cloudflare Access application "Yaadly Desk" (Zero Trust, self-hosted app id `b9426e96-86a0-4c66-9fdd-ed4832dc08f7`) had two Destinations by original design, `desk.yaadly.co.uk` and `concierge.yaadly.co.uk` (see `[C] Admin Desk Move 25 Aug 2026.md` and `[C] Handover Prompt - 27 Aug 2026.md` in the YaadlyHub folder, one deliberately kept as lockout insurance for the other). At some point `desk.yaadly.co.uk`'s own DNS and Pages site stopped resolving; its source lives unmerged on branch `claude/festive-shtern-a29961` and was never brought into `main`. With the DNS gone, a sign-in attempt through this Access application still redirected back through `desk.yaadly.co.uk`'s `/cdn-cgi/access/authorized` and dead-ended there.

Fixed by removing `desk.yaadly.co.uk` from that application's Destinations, leaving only `concierge.yaadly.co.uk`. Confirmed live the same day. If `desk.yaadly.co.uk` is ever brought back, it must be re-added to this application's Destinations before it is used, or it will be open to the internet behind whatever DNS points at it, no sign-in wall.

## The Evidence view in the concierge desk shows a label but not the photo itself

**Should not happen since 1 Sep 2026** (see DECISIONS.md, "The concierge desk could read an evidence row, but never actually asked storage for the photo"). A row with no picture falls back to a plain text chip with an honest reason rather than a broken image, so check which one you are seeing:

- **"no file recorded against this row"** means `evidence.storage_path` is null on that row. Check which function filed it (`yaad-inbound`, `yaad-evidence-video`, or the portal's `evidence-actions.ts`) and whether its upload step actually succeeded; a row can exist with nothing behind it if the insert ran but the upload failed first, though every filing path is written to avoid exactly that ordering.
- **"could not sign a link to this file just now"** means `storage_path` is set but `sb.storage.from("evidence").createSignedUrls()` came back empty or errored for that admin session. Check `pg_policies` on `storage.objects` still has "admins read every bucket" covering `bucket_id = 'evidence'`, and that the signed-in admin session's `is_admin()` still returns true. If the policy is intact and it is still failing, check whether the object actually exists at that path (a `move()` from `_pending/` to its final path can fail after the database row was already written).
- **Nothing rendering at all, no fallback text either:** open the browser console. Signing runs in a batch on every view load (`preEvidence` -> `signEvidenceImgs`), wrapped in its own try/catch so one bad path cannot blank the rest of the view; a console error here is the actual `createSignedUrls` failure, not a rendering bug.

Signed links here last 3600 seconds, not the 300 used for a one-shot WhatsApp or portal notification link, on purpose: a review can sit open on screen for a while. A photo that rendered fine a couple of hours ago and now shows broken is very likely just that link expiring; reload the view to sign fresh ones rather than treating it as a fault.

## An arrival check-in is not showing a location, or `far_from_site` looks wrong

**Missing lat/lon is normal, not a bug.** `log_arrival()` never refuses a check-in for missing coordinates: a worker who says no to the browser's location prompt, whose phone could not get a fix inside 8 seconds, or whose browser has no geolocation at all still checks in, with `arrival_log.lat`/`lon`/`accuracy_m` left null. Only check `ArrivalCheckIn.tsx`'s `readLocation()` and the browser's own permission state if location is missing on every single check-in from one worker, not on an occasional one.

**`far_from_site` is a sanity flag for a human to glance at, not a verdict.** It compares the one captured point against the job's own `parish` text, matched through `normalize_parish()` to a static table of 14 parish (plus Portmore) town centroids in the same migration (`20260901za`), flagged `true` past 30km. `null` means either no coordinates were captured, or `jobs.parish` did not match any known spelling, check `select normalize_parish(parish) from jobs where id = '<job>'` first. A `true` flag on its own proves nothing: a legitimate trip to the materials store, a big parish, or a bad GPS fix all read the same as a wrong site. It is not shown to the worker or the client anywhere, and nothing in this repository refuses or escalates on it automatically; treat it exactly like `worker_stall_history`, something to query and look at, not something with a listener attached.

**Retuning the 30km radius or adding a parish** is one constant (`v_km > 30` in `log_arrival()`) and one row in `parish_centroid()`'s VALUES list, both needing a new migration, same as every other constant in this file that has one.

## The daily worker prompt (`yaad-daily-checkin`) says "nothing sent" every time it runs

**That is the honest, expected answer until a WhatsApp Content Template is approved and its ContentSid is set.** This ping is business-initiated on a fixed schedule, every day, on every live job, so it can never rely on the free 24 hour customer-service window `yaad-notify-client` and `yaad-job-health` sometimes get to use: it always sends through a Meta-approved template, no exceptions, or it sends nothing at all rather than gambling on Twilio error 63016 mid-run. To bring it live:

1. Twilio console → Messaging → Content Template Builder → new WhatsApp template, category **Utility** (this is an operational check-in on an existing job, not marketing, category matters for approval speed).
2. Body text, one variable: *"Yaadly here. How did {{1}} go today? Send a voice note, or a couple of words and a photo, whenever you get a moment."* `{{1}}` is filled with the job's title.
3. Submit for WhatsApp approval. Usually resolves within a day; Twilio's console shows the status.
4. Once approved, copy its ContentSid (`HX...`) and set it as the `TWILIO_CONTENT_SID_DAILY_CHECKIN` function secret on the `leffyisvfvjwzilydlwf` project. No redeploy needed, it is read fresh from the environment on every run.

**Runs once a day, 21:00 UTC (16:00 Jamaica), via pg_cron.** Same shape as `yaad-job-health`: a shared secret, generated once and kept only as a SHA-256 hash in `app_settings.daily_checkin_cron_secret_sha256`, plaintext living solely in the cron job's own stored command (`select command from cron.job where jobname = 'yaad-daily-checkin'` if it ever needs re-deriving). A manual run is available to a signed-in admin the same way `yaad-job-health` is, no secret needed, `is_admin()` is enough.

**One row per job per Jamaica-local day** in `daily_checkin_log` stops a re-run, or a cron overlap, from messaging the same worker twice. It is written whether or not the send actually succeeded, same reasoning as `job_stall_state`'s own nudge marker: this is a once-a-day ask, not a retry queue.

**This is deliberately separate from `yaad-job-health`'s nudge.** That one waits for three days of silence before saying anything; this one asks every day regardless of silence, because the daily ask is the point, not a symptom of a job going quiet. A worker on a genuinely healthy job still gets asked daily. If that turns out to be more noise than it is worth once it is live, skipping the day a worker already reported through is a small, later change to `yaad-daily-checkin`'s own candidate query, not a redesign.

## A worker's voice note or text reply is not turning into a report

**Check `yaad-inbound`'s trace for which lane actually claimed the message first.** A worker's freeform update (the general "here's where things stand" lane, `yaadly.worker_update.*` attributes) only ever gets a turn once every more specific lane above it in the file has already passed: `report_confirm` (answering an existing draft), the client-comment-reply lane, the Kickoff Pack code confirm, the booking code. If a worker's reply was meant to answer one of those and got read as a fresh update instead, or the reverse, that ordering is the first thing to check, the same way DECISIONS.md already documents for this file's other lanes.

**A voice note only transcribes if the phone number resolves to a worker with at least one active job.** `lookupWorkerWithActiveJobs()` has to find that number in `worker_profiles.phone`, `active = true`, with a job in `jobs.worker_email` that is not `complete` or `cancelled`. A worker replying from a different phone than the one on file, or a job that has already moved to `complete`, both read as "not a worker," and the message falls through to the client-intake pipeline instead, exactly the fallback that already existed before this lane did.

**More than one active job asks for the job's code first**, same shape as the evidence-photo lane: a `text_update` session opens (`wa_intake_sessions`, one row, expires the same way an evidence session does) holding the update text until a code comes back. If a worker seems stuck mid-conversation, `select answers from wa_intake_sessions where wa_id = '<their WhatsApp number>'` shows exactly what it is waiting on.

**Filed straight into `evidence`, no separate table.** `label` carries the update text, `storage_path`/`img`/`bytes`/`mime`/`sha256` are all left null, same as the portal and the concierge desk already render for "filed without an image." `schedule_evidence_landed_notify()` (on `evidence`, any insert) and `sync_job_status()` (recomputing `jobs.status` to `evidence` once there is unapproved evidence against the stage being worked, via `poke_job_on_evidence_insert()`'s update to `jobs.updated_at`) both fire exactly the same as they do for a photo. `yaad-evidence-landed-check` picks it up on its usual minute-by-minute pass, 90 seconds after the last thing landed on that stage, and `composeEvidenceReport` already reads `evidence.label` text regardless of whether the row carries a file: nothing in `yaad-notify-client` needed to change for this to work. The worker still confirms the drafted report before the client sees it, the same "1" or their own words prompt a photo update gets.

**Verified against the live database, evidence insert through to `jobs.status = 'evidence'` and a scheduled debounce timer, both confirmed with real SQL against real (rolled-back) rows.** The one thing this could not verify locally is `yaad-inbound` actually recognising a live, Twilio-signed WhatsApp message as this lane: that needs a real signature from the real `TWILIO_AUTH_TOKEN`, which this session never has and should not have. Send one real WhatsApp message from a phone number on file in `worker_profiles` (text or a voice note, no photo, on an active job) to confirm this end to end; the reply should be "Got it, on record for `<job id>`..." and an `evidence` row should appear against that job's current stage within a few seconds.

## WhatsApp only ever means Twilio in this repository now

`yaad-whatsapp-webhook`, a direct Meta Cloud API webhook, is gone (1 Sep 2026; see above and DECISIONS.md). It never received real traffic: `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` were never set, and the founder's own instruction on 31 Aug 2026 was to stop pursuing Meta entirely: "remove meta from this moving forward." **Real WhatsApp traffic flows through `yaad-inbound`**, via Twilio, `whatsapp:` prefixed sender addresses on the same webhook Twilio SMS uses, `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_FROM` the secrets that matter. If a real WhatsApp message is not reaching the system, look at `yaad-inbound`'s Twilio signature check and Twilio's own console configuration. If code or a doc anywhere still names `yaad-whatsapp-webhook`, that reference is stale; say so rather than trying to make it work.

## A Quote Pack job never reaches `complete`, or its stage count looks wrong

**Check which of the two documents `sync_job_status()` actually found.** Since 2 Sep 2026 (`20260902g`, see DECISIONS.md) the completion trigger checks an approved `kickoff_packs` row first, then an approved `quote_pack_drafts` row if that came back empty. A job stuck at the wrong stage count, or one that will not flip to `complete` no matter how much evidence gets approved, means neither lookup found an approved row:

```sql
select
  (select status from kickoff_packs where job_id = '<job id>' order by updated_at desc limit 1) as kickoff_status,
  (select status from quote_pack_drafts where job_id = '<job id>' order by created_at desc limit 1) as quotepack_status;
```

If the relevant one isn't `approved`, that's the actual problem, not the trigger. **The two documents store their stage count differently**: a Kickoff Pack keeps it nested at `docs->'payment_schedule'->'stages'`, a Quote Pack draft keeps a plain array at `docs->'payment_stages'`. A job can only ever have gone through one path (`20260902d`), so exactly one of the two should ever be populated for it; both being empty, or both being approved, is itself worth a second look. Recompute a job stuck on a now-fixed lookup by touching it: `update jobs set updated_at = now() where id = '<job id>'`, which re-fires `sync_job_status()` without changing anything else.

## A job needs two invoices raised, not one, and someone raised the wrong one or only one

**There are two separate invoice types on the same `invoices` table now (`20260902i`), told apart by `payable_to`.** `payable_to = 'yaadly'` (the default, and every invoice raised before 2 Sep 2026) is Yaadly's own 15% Guarantee & Support fee, paid to Yaadly. `payable_to = 'worker'` is a record of what the client owes the worker, labour plus materials at cost, paid to the worker directly, off-platform, exactly as before this existed. Raising one never raises or requires the other; check both explicitly:

```sql
select id, status, payable_to, total_pence from invoices where job_id = '<job id>' and status <> 'void';
```

**As of `20260902j`, the worker pay invoice normally raises itself, one per stage, the moment the client approves that stage's evidence.** `trg_raise_worker_pay_on_stage_approval` fires on every insert into `stage_approvals`, whatever channel the approval came through, and calls `raise_job_stage_worker_pay_invoice(job, stage)`. It lands as a `draft`; nobody has clicked anything yet, and it will sit there until someone does, see below. The older whole-job version, `raise_job_worker_pay_invoice()` (`20260902i`), still exists and still requires `status = 'complete'`, kept as a manual fallback on the desk, not the normal path any more.

**If a stage approval doesn't produce an invoice, check which of three reasons it is, in order.** (1) One already exists for that exact job and stage, `payable_to = 'worker'`, not void, look it up before assuming nothing happened. (2) The computed amount came out zero or less, unusual but not impossible. (3) Genuinely nothing to raise against: no accepted quote, or no client email on the job. All three are silent no-ops by design, logged as a `WARNING` from the trigger's exception handler rather than surfaced anywhere client-facing, since a stage approval must never fail because invoicing had a bad day. Check Postgres logs for `raise_job_stage_worker_pay_invoice(%, %) failed:` if something seems to have gone actually wrong rather than correctly skipped.

**A job with no approved Kickoff Pack or Quote Pack still gets a worker-pay invoice, on the founder's own stated default: 25% on stage 1, the rest on stage 2, nothing on a third.** Not a bug if a stage 3 approval on such a job raises nothing, that default only ever defines two parts. `invoices.notes` says outright when a stage used this default rather than an agreed document.

**As of `20260902l`/`m`, the per-stage worker pay invoice goes straight to `sent`, no admin click, the moment it's raised.** The client's own approval is the confirmation this one needed, per the founder's own instruction; see DECISIONS.md. `invoice_status_guard` still requires `is_admin()` before anything ever reaches `paid`, unchanged, that gate was never touched. The desk's Job Invoices view still shows a **Send** button on any `draft` row, kept for the whole-job fallback (`raise_job_worker_pay_invoice`, `20260902i`) and the agency fee invoice, both still admin-raised and admin-sent exactly as before. If a worker-pay invoice for a specific stage is ever sitting as `draft` rather than `sent`, that means it did not come from the trigger, worth asking why before just clicking Send on it.

**A real ordering bug lived here for one migration, `20260902l`, caught before it reached a client: inserting an invoice as `status = 'sent'` directly, then inserting its lines, hits `invoice_line_price_guard`'s "a sent invoice's lines are frozen" and fails outright.** If that error ever reappears (`invoice %s is sent and its lines are frozen`), it means something is once again trying to add lines after marking an invoice sent rather than before. Insert as `draft`, add the lines, only then flip to `sent`, the order `20260902m` fixed it to.

**If a worker-pay invoice's rendered document ever shows Yaadly's own bank details, that is a real bug, stop and fix it before sending another.** `renderInvoice()` in `yaad-invoice` branches its footer on `inv.payable_to`: a worker-pay invoice must never print `app_settings.invoice_pay_to`, since that would tell a client to pay the worker's money into Yaadly's own account. Preview any worker-pay invoice before it goes out if the function has been touched since: `Job Invoices → Preview` on the desk, check the footer reads "This is a record of what you agreed to pay your tradesperson, not a bill from Yaadly," not a bank sort code.

**As of `20260902n`, a worker can read the invoice raised in their own name, `invoices.worker_email` plus `invoices_worker_read`/`lines_worker_read`, mirroring the client-read policies exactly.** Set only on `payable_to = 'worker'`; null and irrelevant on an agency fee invoice. If a worker reports they can't see a payment they know was raised, check `worker_email` on that invoice is actually populated, filed before this migration and never backfilled would be the one real way this breaks.

## `git status`/`git branch --show-current` disagrees with what a file's content looks like

**This repo's working tree is shared by more than one session (CLAUDE.md 12), and `HEAD` can move to a different branch without this session doing it.** Caught live, 2 Sep 2026: reading `DECISIONS.md` mid-task to append an entry returned a version missing everything written earlier the same session, because the working tree had silently moved to `main`, whose own copy of the file predates the branch this session was actually working on. Nothing was lost, commits already made are safe on whatever branch `HEAD` genuinely pointed to at commit time (each `git commit` output names it), but any *edit* made while `HEAD` is somewhere unexpected would land on the wrong branch entirely, or silently disappear when `HEAD` moves again.

**If a file you just wrote a version of now reads like an older one, do not edit what's on screen. Check `git branch --show-current` and `git status` first.** If the branch isn't the one you meant to be on, and `git status` shows nothing you'd lose, `git checkout <the right branch>` and re-verify the file's content before touching it again. Never assume a Read reflects the branch you think you're on in this repository specifically.

## A service booking is stuck, or an enquiry will not convert

**Since `20260902o`, a services booking has a lifecycle: `held` → `awaiting_payment` → `live` → `complete`/`cancelled`, and only three things ever move it forward.** (1) You convert an enquiry from the desk's Enquiries view, which creates it `held`. (2) You click "Confirm the work" on the Services view, which raises the invoice against `service_catalogue` and parks it `awaiting_payment`. (3) You mark that invoice paid in the Invoices view, and `trg_start_service_on_invoice_paid` flips the booking to `live`, stage at least 1, on its own. No public form and no function anywhere else creates a service booking; that is the founder's bandwidth gate, not a gap.

**"Convert to booking" refused with "already a booking":** the enquiry was converted before; find it under Services (search the client's email). **"Confirm the work" refused:** the row is not `held`, or has no `catalogue_id`, or no client email, and the error names which. A row showing "before the lifecycle" has `status` null, typed in by hand before `20260902o`; give it a status and a `catalogue_id` from the row editor if it should join the flow. **Paid but not live:** the invoice's `service_id` is null (raised from the "per your own published terms" box, which does not link a booking) rather than through Confirm the work. Set `service_id` on the invoice or nudge `services.status` by hand. **The invoice went nowhere:** Confirm the work drafts it; sending is still your click in the Invoices view, same as every invoice.

## A service client says they never got the booking, confirmed, or payment received message

**Since `20260902p`, one trigger on `public.services` (`trg_notify_service_change`) fires `yaad-notify-client` at three moments:** insert as `held` sends `service_booked` (the receipt, carrying the portal code and the join link), the move to `awaiting_payment` sends `service_confirmed` (the invoice is coming, delivery date if one is set), and the move to `live` sends `service_live` (payment received, work under way). Same channel ladder as every job message: Twilio WhatsApp, then Meta, then SMS, then email always.

**Nothing arrived:** check the booking has a `client_phone` or `client_email`; the fire test result `told:false, "no recipient email on the job"` means the row had nobody to reach, and the fix is filling the contact in before converting, not resending by hand. **Check what actually happened:** `select status_code, content from net._http_response where content::text like '%service_%' order by created desc;` a 200 with `told:true` means it went; a 403 means the trigger secret drifted, see the secret rule below. **The secret rule, again:** the plaintext lives only inside the trigger function bodies; `20260902p` recovers it from `notify_client_quote_arrived()` rather than generating a new one, and any future trigger must do the same or every notify trigger breaks at once. Verify all of them agree: hash each function's embedded secret and compare against `app_settings.notify_trigger_secret_sha256` (the query is in the 20260902p session log; nine functions, all true, as of 2 Sep 2026).

## A service booking's Kickoff Pack is missing, wrong, or stuck out of the portal

**Since `20260902q`, every service booking gets a Kickoff Pack made regardless:** `yaad-kickoff-check` (the same every-minute cron) requests a draft for any booking at `held`, `awaiting_payment` or `live` that has none, and auto-issues it at `approved` once the draft is guardrail-clean. An approved pack shows in the client's portal room under "Your Kickoff Pack"; the desk shows every pack under Kickoff packs with the booking's reference in the For column.

**Editing and approving, the desk's two new levers (they exist for job packs too):** "Edit a section" rewrites the prose of cover, scope summary, timeline basis or the payment note, in your own words. Any edit bumps the revision and knocks the pack to `in_review`, which removes it from the portal until you press "Approve": edit first, approve once it reads right. Approve is refused while the payment stages do not total exactly 100 percent, and that refusal is the gate working. **A dirty draft** (price language, banned language, foreign text) is never auto-issued; it sits in Kickoff Drafts for you, and "Link to a service" attaches it once fixed, or a redraft replaces it. **No pack at all after ~5 minutes:** check `kickoff_drafts` for a `failed` row (three failures stop the retries), and check the cron responses in `net._http_response` for `svcRequested`/`svcLinked`.

## Booking directly on the web

**`yaad-book-service` (verify_jwt off, like `yaad-enquiry`) is the public booking door on yaadly.co.uk/services.** It creates a `held` services row priced from `service_catalogue`, records the exact label the visitor clicked in `notes`, and the insert itself fires the `service_booked` WhatsApp/email receipt. Nothing is charged and nothing moves until "Confirm the work" in the desk, so a flood of bookings costs attention, never delivery. Throttles: 3 per caller per day, 20 per day overall (`booking_attempts`, hashed keys, swept after two days). **Watch for:** the marketing page shows founding rates (£149 deposit check) while the catalogue holds full prices (£249), so the booking row carries the catalogue price and the clicked label side by side; reconcile at confirm before raising the invoice. Technical Sign-off has no catalogue row and deliberately falls back to WhatsApp on the page.

## Somebody asked to speak to a person on WhatsApp, or you need to reply as Yaadly

**The handoff is automatic.** When a client asks for a person (or sends three messages the assistant cannot make a job of), `yaad-inbound` tells them Monique will come back to them, sets `human_handling` true on their `intake_threads` row, and from then on holds every further message for you: transcript and photos still saved, ntfy push per message ("They wrote again"), no model call, no bot reply beyond "Monique has this". **Replying as Yaadly:** desk → Conversations → open the row → "Reply from the Yaadly number". Your words go out through Twilio exactly as typed (no model in that path, `yaad-desk-reply`), so the client sees the same chat continue. A send also marks the thread as with you. **Handing back:** the assistant stays quiet on that number until you press "Hand back to the assistant" on the thread; there is no timeout on purpose, so a thread you forget stays silent, not embarrassing. The per-message pushes are the reminder. **A refused send:** "more than 24 hours since their last message" is WhatsApp's own rule, not a fault; ask them to send anything to reopen the window, or reply from your own phone that once. **Wrong or missing Twilio config** shows as the send failing with the env var named; the vars are the same ones `yaad-notify-client` uses (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`).

## The chat on the website, and a visitor who wants a person

**What it is.** The "Ask Yaadly" button in the corner of every page on yaadly.co.uk (`docs/chat.js`) is the WhatsApp assistant with a different front door: it posts to `yaad-inbound` on `channel: "web"`, so the prompt, the no-price rule, the three-turn handoff and the banned-language screen are the same code, not a copy. A web conversation shows in desk → Conversations with a random token in the From column and a draft job behind it, exactly as a WhatsApp greeting does. **It answers the FAQ.** The twelve answers on `docs/faq.html` live, condensed, in `supabase/functions/yaad-inbound/faq.ts`; change the page, change that file in the same commit, then redeploy `yaad-inbound`. **The figure guard.** The assistant may repeat Yaadly's published service prices word for word and nothing else with a currency sign: `price-figures.ts` cuts any pound, J$ or percent figure not on its list before a reply goes out, on WhatsApp too, and logs "price guard: cut" in the function log. Publishing a new price means adding it there and in `faq.ts` together, or the assistant will be cut off mid-sentence every time it mentions it.

**Reaching you, two ways.** When the assistant hands over (they ask for a person, three turns without enough, or the screen blocks a reply) the thread is marked with you and pinged to your phone. (1) **Reply in their chat:** desk → Conversations → open the web row → "Reply in their website chat". Your words go into `web_chat_replies` and appear in their window as "Monique" within about six seconds, while they still have the page open; nothing is sent anywhere else, and the note tells you so. (2) **WhatsApp:** the widget also shows a green "Continue on WhatsApp" button pre-filled with their reference, `JOB-WEB-…`, for the visitor who is leaving. Their first WhatsApp message carrying that reference (a digit out is tolerated) adopts the web thread onto their number: transcript carried across, job code kept, `client_phone` filled in. **The assistant carries on there first** (your call, 2 Sep 2026: "AI should try help in the whatsapp chat before get passed to me"), reading the whole web conversation with a fresh three-turn allowance, and hands to you by the usual rules. The one exception: a web chat you had already replied in personally stays yours on WhatsApp too, held, with a push "Your web chat moved to WhatsApp". A visitor who closed the tab and never went to WhatsApp is unreachable; that is the honest limit of an anonymous chat, and why the widget asks for nothing personal.

**Throttles:** 30 messages per caller per hour, 40 per visitor token, 600 across the door per hour (`web_chat_attempts`, hashed keys, swept after two hours). Polls for your replies are not counted. A visitor over the limit is told so and pointed at WhatsApp. **"This chat only works on yaadly.co.uk":** the browser's Origin header is not in the allowlist in `web-chat.ts`; add the hostname there and redeploy. **No reply, spinner then an error:** the `yaad-inbound` function log, same as for WhatsApp; the model call and its failures are the same ones. A visitor asking for a person still gets handed over even when the model call fails, by a plain word match on their own text. **Widget missing from a page:** each page carries `<script src="chat.js" defer>` before `</body>`; a new page needs the line. **To take it off the site quickly:** delete that one script line from the pages; the function keeps accepting web messages harmlessly until the next deploy.

## Pricing an invoice yourself, and the founding rate

**Since `20260902s` the price on an invoice is yours in three places.** (1) "Confirm the work" on a service booking now asks what you are charging: full price or founding rate straight off `service_catalogue`, or "My own figure" with the amount typed in pounds; the invoice line and the booking's displayed price both follow your choice. (2) The invoice editor's price tier gained "my figure": pick it on any draft line and the Unit cell becomes a box you type the amount into; Save writes exactly what you typed. Service-list tiers are still overwritten from the catalogue on save, on purpose. (3) An AI-drafted invoice refuses my-figure lines until you press "Make it mine to price", which flips `drafted_by` to human on the record; that refusal is `invoice_line_price_guard` doing its job, not a bug. **Technical Sign-off** is now in the catalogue (`technical-signoff`, £245 both tiers) and bookable from the services page like the rest; Full Project Management remains the only card that falls back to WhatsApp.

## A client's photograph is not showing on the board, or you want to publish one

**Since 2 Sep 2026 a photograph on a job is private until you publish it.** Client photographs arrive over WhatsApp, land in the private `intake` bucket, and get a `job_photos` row with `board_ok = false`. The client sees their own pictures in their portal and so does the booked worker; the public board at app.yaadly.co.uk/jobs shows only the ones you have put there.

**To publish one:** desk → Services → Job photos. Every photograph anyone has ever sent is listed, with the picture itself, which job it came with, and whether it is on the board. Open the row and press "Show it on the board". "Take it off the board" reverses it straight away.

**Before you press it:** a photograph sent into a WhatsApp conversation is not consent to put it on a public page. Ask the client, and remember what is usually in these pictures, the inside of a house that is often empty, next to a parish on the same card. If in doubt, leave it private; a worker can still be shown it by other means, and nothing about quoting depends on it being public.

**A picture is missing where you expected one.** Work down these in order:

- **Board shows no photos on a job that has them:** the rows are there but `board_ok` is false. That is the gate, not a fault. Publish from Job photos.
- **"no file" in the Job photos view:** `job_photos.storage_path` is null on that row. It predates the bucket, or the upload in `yaad-inbound` failed and only the row landed (that path is best effort on purpose: a failed photo must never cost the job). Check the `yaad-inbound` function log for "store inbound media".
- **"could not be signed":** the path is set but `createSignedUrls` came back empty for your admin session. Check `pg_policies` on `storage.objects` still has "admins read every bucket" covering `bucket_id = 'intake'`, and that your session's `is_admin()` is still true.
- **Published, but the board tile is blank:** the board mints its own links as it renders, through "board photo files are readable". Check that policy exists and that the object path sits in a folder named after the job (`whatsapp/<job id>/<file>`), which the policy requires; a row whose `storage_path` names a different job's folder is refused on purpose.

**Links here expire.** The board and the portal sign for 300 seconds, the desk for 3600. A picture that rendered an hour ago and is broken now is almost certainly just that; reload the page. Nothing you can copy out of this system is a lasting link to a client's photograph, which is the point.

**Where a client sends photographs.** Their portal, on the job page: the "Add a photo" button inside "What a worker will see", or on the "Your listing" strip once the job is live. The link is the one they already have: `app.yaadly.co.uk/portal/join?job=<job id>&code=<portal code>` for a client who has not set the portal up yet (the wizard shows it on the "job received" screen, and `yaad-notify-client` messages it), then `app.yaadly.co.uk/portal/jobs/<job id>` once they are in. The portal code is on the job row in the desk. There is no separate upload link and there is deliberately no link that works without signing in: a page that accepts photographs of somebody's house on the strength of a URL alone is a page anybody can find.

They can also still send them on WhatsApp, which is where most will come from. Both land in the same place.

**Since 3 Sep 2026 a photo the client uploads themselves is theirs to publish.** The upload form has "Show it on the marketplace with the job", ticked by default, and every thumbnail they sent carries a "Show on marketplace" or "Take off marketplace" button, so a client-sent photo can be on the board with no desk step at all. They can also delete one they sent whether or not it is on the board. You still see every photo in Services → Job photos and can take any of them down. Photos that arrived on WhatsApp are unchanged: private until you publish them, and not the client's to publish or delete, because those were saved out of a conversation rather than sent for the board. If a client asks why a WhatsApp photo has no button, that is why, and the answer is to publish it for them from the desk.

**The demonstration listing.** JOB-DEMO-PHOTOS is a display job carrying a Yaadly stock image from the app's own assets, not a client photograph, and it says so in its own title and first line. It is the only published photo today. Delete the job row and its photo row when you no longer want it on the board.

---

## 11. A card authorisation is about to expire, or already has

Applies to short jobs taken on manual capture (authorise at booking, capture on approval). Decided 3 September 2026, see the ledger entry of that date. Long jobs go out as invoices and none of this applies to them.

**The deadline.** Seven days from authorisation, on every card brand, for online customer-initiated payments. There is no grace period. If nobody captures in time, Stripe releases the funds and the payment status becomes `canceled`. The money is not taken wrongly; it is simply gone, and the client has to pay again.

**Where to look.** Stripe Dashboard, Payments, filter status **Uncaptured**. Every row there is a live deadline. Check it daily while any short job is open. The API field carrying the exact expiry is `payment_method_details.card.capture_before` on the charge.

**On approval, before day 7.** Open the payment and click **Capture**. That is the whole action. A named human clicks it after the client has approved the evidence, never before, and never automatically: capturing is taking the client's money, and `approve_job` is on `HUMAN_ONLY_DECISIONS`.

**Day 6 and no approval yet.** Do not wait for day 7. Two options, both are decisions for a person:
1. The work is done and the client is just slow to look: chase the client, and if the approval will not land in time, tell them the authorisation is expiring and that they will be asked to pay again. Then let it expire, or cancel it (below).
2. The work is not done: cancel the authorisation and rebook the job as an invoice. A job that has already overrun seven days is not a manual capture job.

**To cancel.** Open the payment in the Dashboard and cancel it. The hold is released and the client is charged nothing. Cancel rather than letting it lapse silently, because the client can see the pending amount on their statement and deserves to be told.

**Never do.** Do not capture to beat the deadline while approval is outstanding. That takes money for work the client has not accepted, which is the thing this whole product exists not to do. Do not enable Stripe's `automatic_delayed` capture, which captures on a timer without a human, for the same reason.

**A note on statements.** Some card issuers show an authorisation and a settled payment identically, so a client may believe they have already been charged when they have not. Expect that question and answer it plainly: the money is held by their bank, not taken by Yaadly, until they approve.

---

## A client wants to change the description of their job

**Since 3 Sep 2026 they can do it themselves,** on the job page in their portal: the small "Edit the description" button inside "What a worker will see" (once the job is live and that preview is gone, the same button sits on the "Your listing" strip). Whatever they save is read back below it exactly as the board will show it, with the address, any access contact line and phone numbers stripped by `open_jobs` as before. The edit changes the stored text only; what is published is still decided by the view.

**It stops the moment a worker is booked.** From then on the description is the scope both sides confirmed a Kickoff Pack against, and the button disappears. A client who asks for a change after that is asking for a variation: agree it with both sides and edit the job row in the desk yourself, and say so in the job's messages so the worker has it in writing.

**Quotes already in were priced against the old wording.** The form tells the client that. If a change is big enough to move the price, message the workers who quoted; nothing does that automatically.

**"Only the client of this job can change its description" / "A worker is booked on this job":** those are `edit_job_descr_as_me()` (20260903a) refusing, in words, and both are correct. The first means the signed-in email is not the job's `client_email`; the second is the rule above. There is no override in the portal on purpose.

---

## Changing a colour, or adding a text tier

**Text colours live in six files and must move together.** `--mute` and `--dim` are defined in `web/app/globals.css`, `docs/yaadly.css`, and the inline `:root` blocks of `docs/index.html`, `docs/marketplace.html`, `docs/business.html` and `docs/services.html`. Editing the stylesheet alone reaches exactly half the marketing site, because those four pages carry their own copy. Check with:

```bash
grep -rnE -- '--(color-)?(mute|dim):? *#' docs/*.html docs/*.css web/app/globals.css
```

Every line that comes back should show the same two values. Today: `--mute:#9E9ECB`, `--dim:#7C7CA6`.
Seven lines, six files. The app spells them `--color-mute` and `--color-dim`, because Tailwind v4
derives `text-mute` and `text-dim` from that prefix; the plain names are aliased to them further down
`globals.css` for the CSS ported from the preview. Same values, two spellings, one meaning.

**Any colour used for text must clear 4.5:1 against `--bg` (`#07071A`).** That is not a preference, it is the WCAG AA floor for normal text, and `--dim` sat at 2.04:1 until 3 Sep 2026. To check a candidate, open any page and run this in the browser console:

```js
const lin=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)};
const L=h=>{const n=parseInt(h.slice(1),16);return 0.2126*lin((n>>16)&255)+0.7152*lin((n>>8)&255)+0.0722*lin(n&255)};
const ratio=(a,b)=>{const x=L(a),y=L(b);return ((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)).toFixed(2)};
ratio('#7C7CA6','#07071A')   // must be 4.5 or above
```

**Status pill colours are `web/components/portal/statusTone.ts`, one file.** Four tones: `waiting` gold, `moving` purple, `done` green, `idle` grey. Add a tone there, never in the component asking for it, and check it against the panel background the same way. The wording of each status stays in `JobList.tsx`, per audience, because a client and a worker read the same status differently.

**The ink on a brand gradient is `--color-onbrand`, one token.** It was hardcoded as `#04211D` in 53 places, a leftover green from the retired teal palette. If the gradient ever changes, this changes with it and nothing else needs to.

**The favicon is the same purple mark on all eight marketing pages and the app** (`web/app/icon.svg`). Audit with:

```bash
for f in docs/*.html; do printf '%-24s ' "$f"; grep -o "fill='%23[0-9A-Fa-f]\{6\}'" "$f" | head -1; done
```

All eight should read `%237B4FE0`. Four of them were still the old teal square until 3 Sep 2026.

---

## A database function is exposed to the open internet, or the desk stops being able to invoice

**The rule.** PostgREST publishes EVERY function in the `public` schema that the caller's role may execute, at `/rest/v1/rpc/<name>`. Supabase's default privileges grant EXECUTE to `anon` and `authenticated` when a function is created. **A new `SECURITY DEFINER` function is therefore on the open internet the moment it exists, unless you take it off.** Do that in the same migration that creates it.

**To see what is currently exposed:**

```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('anon', p.oid,'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid,'EXECUTE') as auth,
       exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as public_grant
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef and has_function_privilege('anon', p.oid,'EXECUTE')
order by p.proname;
```

Anything in that list that does not open with `if not public.is_admin()` or check `auth.uid()` is a hole. Anything called only by an Edge Function should not be in the list at all.

**What is deliberately still on that list, as of 3 Sep 2026.** Seven, and none of them writes anything:

| Function | Why it stays |
|---|---|
| `job_for_code`, `quotes_for_code` | The whole point of "no account to get quotes". The job code is the bearer token and the page at `/jobs/[id]/quotes` is public. |
| `request_kickoff_as_me` | Reached from that same public page. It refuses anybody who is not the job's signed-in client, so an anonymous call just fails. |
| `current_doc_version`, `job_open_for_quotes` | Read-only lookups with no personal data in them. |
| `job_client_email_matches`, `may_use_agents` | **Do not revoke these without checking first.** They look like oracles, and they are: an anonymous caller can test whether an email matches a job. But they are almost certainly evaluated inside RLS policy expressions, and a function called in a policy runs as the querying user, so revoking EXECUTE would make those policies fail for everybody rather than merely closing an oracle. Closing them properly means moving the check inside a definer function first. Worth doing, not worth doing quickly. |

**Always revoke from `public` as well as `anon`.** A grant to PUBLIC covers `anon` no matter what `anon` itself holds, so `revoke ... from anon` alone is a silent no-op on any function carrying one. The `public_grant` column above is how you spot it. `release_materials_tranche` was exactly that case on 3 Sep 2026.

**Never revoke `authenticated` without checking the desk first.** `concierge/concierge.html` reads Postgres with the PUBLISHABLE key, so Monique signed in is `authenticated`, and `is_admin()` is what separates her. These are the functions the desk calls and they must keep `authenticated`:

```bash
grep -oE "rpc/[a-z_]+|rpc\(.[a-z_]+" concierge/concierge.html | sed -E "s|rpc/||; s|rpc\(.||" | sort -u
```

Today, ignoring the `args` line the pattern also picks up: `is_admin`, `raise_job_agency_fee_invoice`, `raise_service_invoice`, `release_materials_tranche`. The desk reaches these two ways, a fetch to `/rest/v1/rpc/<name>` and a `supabase.rpc("<name>")` call, which is why the pattern matches both shapes; a grep for only the first misses three of the four.

**If the desk starts refusing with a permission error after a grant change,** re-grant it: `grant execute on function public.<name>(<exact arg types>) to authenticated, service_role;`. The argument list must match exactly or you will create a second entry rather than fixing the first.

**Migration files here are a record, not the mechanism.** `supabase migration list` skips every file in `supabase/migrations/` because the names are `20260903c_...` rather than a 14-digit timestamp, so `supabase db push` will NOT apply them. They are applied through the dashboard or the API, which records its own timestamped entry. Write the file for the reasoning, apply it separately, then verify with the query above.

---

## WhatsApp intake is returning 503 and nothing is arriving

Since 3 Sep 2026 `yaad-inbound` **refuses** a Twilio request it could not verify, rather than letting it through. A 503 with `"Inbound verification is not configured."` means exactly one thing: `TWILIO_AUTH_TOKEN` is missing or wrong on the function.

```bash
npx supabase secrets list --project-ref leffyisvfvjwzilydlwf | grep TWILIO
```

`TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` must both be present. Set the token from the Twilio console (Account Info, Auth Token) with `npx supabase secrets set TWILIO_AUTH_TOKEN=... --project-ref leffyisvfvjwzilydlwf`, then redeploy nothing: secrets are read at request time.

**Do not "fix" this by removing the check.** Before it existed, a missing token meant every unsigned request was accepted, on an endpoint that runs with `--no-verify-jwt` and can agree quotes, agree Kickoff Packs, choose workers and approve stages. Approving a stage raises a worker pay invoice. The 503 is the system telling you the front door is unlocked; the answer is the key, not the alarm.

A 403 with `"Signature check failed."` is different and is the sender's problem: the token is set and the signature did not match. Usually the URL Twilio posts to has changed. See `twilio-signature.ts` for why the URL is rebuilt candidate by candidate.

---

## Somebody asks about a password, or a password reset email arrives

**There are no passwords.** Sign in is a code, sent to the email address on the account, good for about an hour. `/portal/forgot` and `/portal/reset` both now forward to `/portal/sign-in`; they used to run the retired password flow, and `/portal/reset` could still set a password that nothing accepted.

**If somebody cannot get in:** send them to `app.yaadly.co.uk/portal/sign-in`, have them type their email and leave the code box empty, and press the button. That sends a fresh code.

**Outstanding, and it is the founder's call:** the Supabase Auth email templates may still contain a "reset your password" template pointing at `/portal/reset`. That link still works, because the route forwards and carries the session fragment across, so nobody is stranded. But the email says password and the product has none. Retiring or rewording that template changes what clients receive, so it has not been done for you. Dashboard, Authentication, Emails.

---

## Money is showing a different figure in two places on the same job

**Every money string in the app comes from `web/lib/money.ts`.** If two panels disagree, one of them has grown its own formatter again. That is what this file exists to stop: there were ten, seven rounded and three did not, so a job could read J$1,234,567.89 in one panel and J$1,234,568 in another.

```bash
grep -rn 'toLocaleString("en-JM")\|toLocaleString("en-US")\|"J\$" +' web/app web/components
```

Anything that comes back other than `web/lib/money.ts` is the fault. Four exports, and they differ only in what they do with a missing figure:

| Use | When |
|---|---|
| `jmd(n)` | you already know you have a number |
| `jmdOrNull(n)` | the component renders nothing when there is no figure |
| `jmdOrBlank(n)` | the caller concatenates the result regardless |
| `amount(minorUnits, currency)` | an invoice total, in whatever currency it was raised |
| `gbp(pence)` | a plain pence column, always two decimals |

J$ is always rounded, because Jamaican pricing is quoted in whole dollars. Card currencies keep both decimals, because a statement has them. `amount(null, ...)` returns "not set", never a dash: a dash in a money column is ambiguous between nothing and zero.

---

## The question box on /ask is refusing people, or being flooded

Since 3 Sep 2026 `/ask` writes through `ask_question()` in Postgres, not by direct insert, and `questions` has no INSERT policy for anon at all. Ten questions an hour per caller.

**Somebody says they cannot ask.** The page tells them which of four things happened, so ask them what it said:

| The page says | Means |
|---|---|
| "ten questions in an hour" | the throttle. Genuine, and it clears within the hour. |
| "too short to answer well" | under 10 characters. |
| "did not save, and it is our end" | the RPC errored. Check the function exists and `anon` can execute it. |
| nothing appears after asking | working as intended: rows land unpublished and a person publishes them. |

**To publish a question:** it is a row in `questions` with `published = false`. Set it true from the desk or the SQL editor. Answers come from vetted workers who have signed the Worker Guidelines; the policy enforces both.

**To check the throttle is actually on:**

```sql
select has_function_privilege('anon','public.ask_question(text,text,text)','EXECUTE') as anon_can_ask,
       exists (select 1 from pg_policies
                where schemaname='public' and tablename='questions'
                  and cmd='INSERT' and roles::text like '%anon%') as anon_can_insert_directly;
```

`anon_can_ask` must be true and `anon_can_insert_directly` must be **false**. If the second is true, the direct door is open again and the throttle is decorative.

The caller key is a truncated SHA-256 of the address, computed in the server action, never the address itself. It is a throttle key, not a visitor log, and `question_attempts` sweeps itself within hours.

---

## Somebody cannot finish the "Post a job" form, or a job arrives with no urgency on it

`/jobs/new` is six stages since 3 Sep 2026: the work, the property, urgency, photos, contact, review. It talks to two Edge Functions and nothing else. `yaad-post-job` in draft mode saves the job card, on the way out of stages one, two and three. `yaad-enquiry` sends the name and the contact detail, once, on Send.

**Start by asking what the screen said.** The form shows the Edge Function's own words, so the message identifies the fault.

| They saw | Means | Do |
|---|---|---|
| "That is a lot of job requests in one hour" | `yaad-post-job`'s per-caller throttle, eight creates an hour. A shared connection or an office can trip it. | Nothing is broken. Tell them to press **Carry on without saving**: the job still reaches you, without a reference number. Or finish it with them on WhatsApp. |
| "Posting is not configured" | `SUPABASE_SERVICE_ROLE_KEY` is missing from the function's environment. | §9 of this runbook. Nothing saves until it is set. |
| "That did not send. Nothing is lost on your side." | `yaad-enquiry` failed. The job card is already saved; only the contact detail did not go. | Ask them for the reference number on screen and their number. The job is in `jobs` and you can reply from the desk. |
| "We need your name, a way to reach you, and what you want to ask" | `yaad-enquiry` got a blank field. Should be unreachable, the form checks first. | Report it, it is a bug. |
| a stuck **Saving…** button | the invoke never came back. | Reload. The answers come back off the device, see below. |

**A form that failed a save is never a locked door.** The error box offers **Try again** and **Carry on without saving**. Neither loses a word of what they typed.

**Their answers survive a closed tab.** The trade, parish, description, urgency and access answer are kept in the browser under `yaadly.job.new.v1` for seven days, with the job reference, so a returning visitor lands on the stage they stopped at and keeps working on the SAME job rather than creating a second one. **The name, the contact detail and the portal code are deliberately never stored**, because this form gets filled in on shared family phones and the code is a credential. So somebody coming back re-types their name and number and nothing else. If they want a clean form, the banner has a **Start again** button.

**A job arrives with no urgency or no access answer.** Both are required on the form, so it did not come from `/jobs/new`. It came in on WhatsApp through `yaad-inbound`, where the assistant fills what the conversation gave it. Set them from the desk.

**Access answers matter more than they look.** The answer to "who can let a worker in" is written to `jobs.access_type`, and `enforce_vetted_worker_on_quote` reads it: a worker still in Probation is refused a job where they would hold keys or work inside an occupied home. Before 3 Sep 2026 this form never filled that column, so the gate was skipped on every job posted from the web. It is on now. If a worker says they cannot quote a web job, check their `vetting_state` and the job's `access_type` before assuming a bug: the refusal message names which of the two rules stopped them. The exact wording of the four options is asserted in `web/tests/new-job-form.test.mjs`; do not reword them in the page without reading that file.

**Photographs are not uploaded on this form, on purpose.** Stage four says what to photograph and the confirmation screen hands over a link, `/portal/join?job=…&code=…&next=photos`, which sets up the account and lands directly on the photo panel. The file itself only ever travels the portal route: size capped, private storage, location stripped, deletable by the client. If somebody says the link did not open the photo screen, check that `next=photos` survived whatever copied the link, and that `?photos=1` is on the job URL afterwards.

---

## The worker directory or a worker profile is showing nobody, or `public_worker_profiles` errors

Migration `20260903f_worker_profile_columns_stop_answering_the_open_internet.sql`. Same class of issue as "A database function is exposed to the open internet" above, but in RLS row policies instead of function grants: `worker_profiles.worker_email` and `.phone` sat on the same row as `name` and `trade`, and the old `wp_select_public` / `wp_select_signed_in` policies were row-only, so anybody holding the publishable key could `GET /rest/v1/worker_profiles?select=name,worker_email,phone` and read every active worker's contact details directly. Same shape of leak on `worker_checks` and `portfolio`, both of which carry `worker_email` purely as a join key.

**The fix.** Three views, same pattern as `published_reviews`: `public_worker_profiles`, `public_worker_checks`, `public_portfolio`, none of which carry `worker_email` or `phone`; `worker_checks`/`portfolio` expose `subject_slug` instead of the email so the app can join on the public slug. The base tables are locked down behind them: `worker_profiles` now allows `select` only to the profile's own worker (`worker_user = auth.uid()` or their own `worker_email`) or `is_admin()`; `worker_checks`/`portfolio` keep only their existing admin-only policy.

**web/app/jobs/page.tsx, web/app/jobs/new/page.tsx and web/app/workers/[slug]/page.tsx read the views, never the base tables.** If the worker directory or a profile page is rendering nobody, or a Supabase call against `worker_profiles`/`worker_checks`/`portfolio` from the web app is failing with a permission error, check first whether this migration has actually been applied:

```sql
select viewname from pg_views where schemaname = 'public' and viewname like 'public_%';
```

If the three views are missing, the migration file exists in the repo but was never run against `leffyisvfvjwzilydlwf`. **Migration files here are a record, not the mechanism** (see the entry above): apply it through the dashboard or the Supabase MCP, then verify:

```sql
select has_table_privilege('anon', 'worker_profiles', 'select') as anon_can_read_base_table; -- must be false
select count(*) from public_worker_profiles; -- must return the active worker count
```

**What still needs `worker_email` on the base table, and stays working.** `web/app/portal/(gated)/worker/page.tsx` reads its own `phone` by `worker_user = auth.uid()`. `web/app/jobs/actions.ts` reads its own `name` by `worker_email`, matched against the signed-in user's own email. Both are covered by the new `wp_select_own_or_admin` policy; if either starts failing, check that policy exists and that its two OR-branches still match what those two call sites actually filter on.

**The admin desk is unaffected.** `worker_checks`/`portfolio` keep their pre-existing `admin full ...` ALL-command policies, and `is_admin()` is part of the new `worker_profiles` SELECT policy, so `concierge.html` continues to see full worker rows including phone and email.

---

---

## A tradesperson says they lost their place in the application, or cannot get back to the ID check

`/apply` saves as they type, into `localStorage` under the key `yaadly.application.v1`, on the browser they were using. That is the whole mechanism: no account exists yet, so there is nowhere else to keep it.

What is saved: the application id and upload token (the claim), every document already accepted, a recorded Persona check, the whole form including the three referees and the signature, which screen they were on, which of the two sittings they were in, and the reference once Phase 1 has been sent.

1. **Same phone, same browser, not private mode:** send them back to `https://app.yaadly.co.uk/apply`. It reopens where they left off. If Phase 1 was already sent it reopens on the sent screen, which carries the "Carry on to the ID check" button.
2. **Different phone, or they cleared their browser, or they were in private mode:** there is nothing to restore, and nothing is lost at the desk either. Their application is already in `applications` under its `APP-` reference and every document they sent is on file. Do **not** ask them to apply again, it makes a second row for the same person. Chase the remaining Phase 2 items on WhatsApp instead, which is the intended route anyway.
3. **They want to wipe what is on the phone,** for instance it is a borrowed handset: the line under the heading carries "Start again, and clear what is saved here". It removes the key and reloads. It does not delete anything at the desk.

**To read what a phone is holding,** in the browser's own console on that device:

```js
JSON.parse(localStorage.getItem("yaadly.application.v1"))
```

`sentRef` present means Phase 1 was submitted. `continuing: true` means they were in the second sitting. `step` is an index into that sitting, and an out-of-range value is clamped to the last screen rather than blanking the page.

Note that the upload token stays on the phone until the second sitting is finished or "Start again" is pressed. Phase 2 uploads need it. If a handset is lost and the applicant is worried, the desk can invalidate it: change `upload_token` on their row in `applications` and their old browser copy stops working. They then finish over WhatsApp.

---

## The progress counter on /apply, and why it must never say "of 9"

Phase 1 shows three dots, Phase 2 shows four, and the number comes from the length of the sitting being shown, not from a written constant.

This is deliberate and it reverses nothing. The nine-item step rail was removed on 30 Aug 2026 because it was the first thing an applicant saw and a list of nine outstanding things is a reason to close the tab. A counter that spans both sittings is that rail again in smaller type. If a screen is added to a sitting the count follows on its own; if anybody proposes one counter across the whole check, the answer is no, and the reason is in `DECISIONS.md` under the 3 Sep 2026 entry.

---

## A photograph or an introduction video on /apply says "Could not record that document"

The `doc_type` column on `vetting_documents` has a check constraint, and a value the constraint does not list fails at the insert **after** the file has already uploaded. The row shows that message, and the file sits orphaned in the bucket until the ninety day purge collects it.

`intro_video` was in exactly this state from 31 Aug to 3 Sep 2026: accepted by the browser and by the edge function, refused by the database, every single time. `profile_photo` was added on 3 Sep. Both are in migration `20260903g`.

**To see what the live constraint actually allows** (the migration history is not the schema, which is how the above went unnoticed):

```sql
select pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.vetting_documents'::regclass
  and conname = 'vetting_documents_doc_type_check';
```

Adding a new document type takes **four** changes, and missing any one of them fails in a different place:

1. The constraint above, by migration. Miss it and the insert fails after a successful upload.
2. `DOC_TYPES` in `supabase/functions/yaad-vetting-upload`. Miss it and you get "Unknown document type" before anything uploads.
3. `DocType` in `web/app/apply/JoinFlow.tsx`, and a row to upload it.
4. **If it shows a person's face,** `IDENTITY_DOCS` in `supabase/functions/yaad-vetting-review`, in the same change. Miss it and the face is sent to a model. Today that list holds the photo ID, the selfie, the face turn, the introduction video and the profile photograph.

---

## What did an applicant actually agree to about AI reading their paperwork

The question is on `/apply`, on the Phase 1 work screen and again on the Phase 2 identity screen. One answer, whichever screen they use.

```sql
select app_id, name, ai_review_consent, ai_review_consent_version, ai_review_consent_at
from public.applications
order by created_at desc
limit 20;
```

- `granted` means the proof of address, TRN, certificates, CV and portfolio were sent to NVIDIA's vision model to be read, and flags were written for the desk. The photo ID, selfie, face video and profile photograph were **not**, whatever they chose: `IDENTITY_DOCS` withholds those before the download.
- `declined`, or NULL, means nothing left Yaadly and a person reads every page by hand. The reviewer refuses to run, and so does the automatic hand-off from submit.
- `ai_review_consent_version` is the sentence they agreed to. `ai-review-v3` is current, from 3 Sep 2026. Never read an older version as agreement to a newer or broader one; each is narrower than the last, so an old yes covers what is done today, but the version is the record of what was actually asked.

**If a run of applications all say `declined` and nobody chose that:** the browser has stopped sending the field. That happened between 30 Aug and 3 Sep 2026, when the consent UI was removed from the page and the submit stopped sending `aiReviewConsent`; the server reads a missing field as declined, correctly, so every application in that window records a refusal nobody gave and no review ever ran for them. Check that `JoinFlow.tsx` still sends `aiReviewConsent` and `aiReviewConsentVersion` in the `submit` call. Those applications can be reviewed by hand at the desk, or re-asked; do not back-fill a consent nobody was asked for.

**To change the wording of the question:** bump `AI_CONSENT_VERSION` in `JoinFlow.tsx` in the same commit. That is CLAUDE.md §6 and it is not a formality. The whole value of the column is that somebody can later ask what a given yes said.

## 17. Turning the CSP from report-only to enforcing

**Diary item, on or after 17 September 2026.** A Content-Security-Policy went out in report-only on 3 Sep with a two-week watch, founder's decision, no collector. If nobody does this, the policy sits there protecting nothing.

**No collector means the reports go to the browser console and nowhere else**, so finding violations is a person walking the site with devtools open. That is the whole watch. Do it at least twice in the fortnight, and once more on the day.

**Walk these, signed in, with the console open**, because each one loads something the others do not:

1. `/jobs` — the board, client photographs on signed URLs, the chat widget from `yaadly.co.uk`
2. `/jobs/new` — the post-a-job flow, photo upload
3. `/apply` — **the important one.** The Persona identity step runs in an iframe from `inquiry.withpersona.com` and asks for the camera. If any single thing breaks under this policy it will be this.
4. `/portal/jobs/<id>` — evidence images, video, the money panels
5. `/portal/jobs/<id>/pack` — a Kickoff Pack document
6. `/workers` and a worker profile

Anything the console reports as a CSP violation is a source the policy is missing. Add it to the matching directive in `web/next.config.ts`, where every source already carries a comment saying where it came from. **A violation is not automatically something to allow**: if you cannot explain why the app is loading it, that is the policy doing its job.

**To enforce**, in `web/next.config.ts`:

1. Rename the header key `Content-Security-Policy-Report-Only` to `Content-Security-Policy`.
2. Delete the separate `frame-ancestors 'none'` header above it. It is kept enforcing alongside the report-only policy on purpose, because that one clause is proven; the full policy already contains it, so leaving both would be duplication.
3. Deploy, then walk the same six routes again. **This time a mistake breaks the page rather than logging.**

**If something breaks after enforcing**, rename the key back to `Content-Security-Policy-Report-Only`, redeploy, and you are back to safe within one deploy. That is the whole rollback.

**`'unsafe-inline'` on `script-src` is knowingly in there.** Next injects an inline bootstrap script, so removing it needs nonces threaded through the document. That is its own change and it is worth doing later; the policy is worth having in the meantime, because it still closes off every origin the app has no business talking to.

**`service_catalogue` names and active flags can drift from what the marketing page and specs actually decided, since nothing keeps them in sync automatically.** On 3 Sep 2026, `eyes-on-it` still read "Eyes On It" and `condition-report` still read "Property Condition Report" in the live table, months after `specs/PRICING.md` and `CHANGELOG-2026-08-26.md` §4 renamed them to "Visual Check" and "Condition Report" on the day the invoicing migration was written; the seed data in `20260826_invoicing.sql` just never picked the rename up. Separately, `setup-pack` and `document-check` were still `active := true`, both listed under "Removed" in the same spec, which is why they were still raisable from the concierge desk's own catalogue dropdown (`loadCatalogueOptions` reads `active = true` straight off the table) and still selectable in the `<select id="bk-svc">` on `docs/services.html`, which never had its two leftover `<option>`s pulled when their product cards came off the page. Fixed in `20260903h`: renamed the two rows, set both retired ids `active = false`, dropped the two `<option>`s, and dropped `docs`/`setup` from the `BOOKABLE` allowlist in `yaad-book-service` so a crafted request can't book them even with the page unchanged; redeployed. **If a "removed" service becomes bookable again**, check three places: the row's `active` flag, whether its `<option>` is back in `docs/services.html`, and whether its key is back in `BOOKABLE`.

**A bigger, separate gap found while fixing the above and not yet acted on:** several `service_catalogue` pence values still hold pre-26-Aug numbers, while `specs/PRICING.md` (dated the same day) records the founder's decided prices with sourced comparables. Live catalogue vs. spec, as of 3 Sep 2026: Visual Check full £125 vs. decided £149 · Condition Report £249/£349 vs. decided £245/£325 · Oversight Retainer £395/£495 vs. decided £595 fortnightly (and the catalogue has no weekly tier at all, spec wants one at £1,095) · Property Care standard/large/villa £45/£70/£95 flat vs. decided £95/£135/£175 · Technical Sign-off £245/£245 vs. decided £245/£300. The public page (`docs/services.html`) already shows the *decided* founding figures, so a client sees one number and, once an admin raises the invoice, `raise_service_invoice()` prices it off the *stale* catalogue figure. This is a money change, not a label fix, and the retainer needs an actual schema decision (one row or two), so it was left for the founder to confirm before anyone touches it.

---

## 18. A migration is in the repository but not in the database

Found this way on 3 September 2026: `/apply` said "Could not record that document" for every profile photograph and introduction video, and had been doing so silently since the feature shipped. The file was committed. It had never been applied.

**The folder is the intent. `supabase_migrations.schema_migrations` is the fact.** Do not trust one for the other. Symptoms look like a bad connection, a flaky upload, or nothing at all, because the code path in front of the missing change usually succeeds first.

### Check for drift, both directions

```bash
ls supabase/migrations | sed 's/\.sql$//' | sort > /tmp/repo-migrations.txt
```

Then read the applied list and compare by name, remembering that the live `name` often drops the `20260903x_` prefix the filename carries, and that one file may have been applied as several named parts:

```sql
select version, name from supabase_migrations.schema_migrations order by version desc limit 40;
```

Two different problems come out of this and they need different answers:

- **In the repository, not in the database.** A change nobody is getting. Read the file, check it is still what you want, then apply just that one. Do NOT reach for `supabase db push`: on 3 Sep it would have applied four migrations, of which two were already live under different names and one was a decision nobody had taken yet.
- **In the database, not in the repository.** Worse, because the folder can no longer rebuild the database. Write the migration back as a file, copying the statements out of `schema_migrations` rather than from memory, and keep the reverts as their own files instead of tidying them away. The ordering mistake is usually the useful part.

### Apply one migration, not all of them

Use the Supabase MCP `apply_migration` with the single file's contents, or run the statements directly. Then prove it took, against the live schema rather than against the file you just ran:

```sql
select pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.vetting_documents'::regclass
  and conname = 'vetting_documents_doc_type_check';
```

### Before applying anything that re-adds a CHECK constraint

`drop constraint` then `add constraint` validates every existing row. Count what is in the column first, or the add fails and, outside a transaction, leaves the table with no constraint at all:

```sql
select doc_type, count(*) from public.vetting_documents group by doc_type;
```

### Still open, and it is a founder decision

`20260901i_worker_guidelines_v14_drops_police_check_and_trial_job.sql` is unapplied. The app ships Worker Guidelines v1.4; `app_settings.worker_guidelines_version` still says 1.3. `match_workers_for_job` compares a worker's signed `doc_version` to that setting exactly, so a worker signing the text now on screen matches no jobs, and the two workers who signed the withdrawn v1.3 text still do. Applying it swaps which half is broken until those two re-sign. See DECISIONS.md, 3 Sep 2026.

---

## 19. A page 404s correctly but answers 200

A `loading.tsx` on a dynamic route puts a Suspense boundary in front of the page, so Next flushes the shell with a 200 before the page's `notFound()` runs. The visitor sees the right page. Search engines are told every URL exists.

Check any public route that can 404:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://app.yaadly.co.uk/workers/does-not-exist
```

404 is right, 200 is the bug. To confirm the cause, move the route's `loading.tsx` aside and curl again: if it becomes 404, that is it. The fix is to resolve the record in `generateMetadata`, which runs before the shell is flushed, and call `notFound()` there; keep the one in the page as the backstop.
## The legal pages, and the placeholders that are still in them

`docs/privacy.html`, `docs/cancellation.html` and `docs/terms.html` went up on 3 September 2026 with their open questions marked on the page rather than filled with guesses. Every gap is in a visible amber box or a square-bracketed `[TO BE INSERTED...]`, so to find all of them at once:

```bash
grep -rn "TO BE INSERTED\|gapcard" docs/privacy.html docs/cancellation.html docs/terms.html
```

What each one is waiting on:

1. **Registered office address** (privacy, cancellation, and every page footer). Blocked on a registered office service address, which the founder decided on 3 September 2026 to take rather than publish her home address. It must be an "appropriate address" under the rules in force since 4 March 2024, meaning post reaches someone acting for the company and delivery can be acknowledged, so a PO Box does not qualify. Roughly £30 to £50 a year. Then file an AD01 within 14 days, and change the director's correspondence address at the same time.

   Until it is filed the site carries no address at all, which leaves the Regulation 25 disclosure (part of the UK, registered number, registered office address) unmet on the third element. That is a known and accepted gap, chosen over republishing a home address on all eleven pages of a site fed by a 9,000 follower TikTok. It was briefly published on 3 September and reverted the same evening when the founder chose the service address instead; nothing reached `main`, so it was never live.

   When the address exists, it goes in three places: the footer of all eleven pages in `docs/`, the "who we are" table in `docs/privacy.html`, and the postal route in `docs/cancellation.html`. Find them all with:

```bash
grep -rn "TO BE INSERTED\|no. 17358077" docs/*.html
```

   Honest limit worth knowing before you spend the money: a home address used as a registered office cannot be removed from the Companies House register. Filing the change protects the record going forward and historic filings stay visible. Suppressing it from other documents is a separate application at £32 per document, and a serving director has to supply an alternative address to replace it.

2. **ICO registration number** (privacy). Register at ico.org.uk, around £52, then paste the number in.
3. **Retention periods** (privacy). Legal decision, not a technical one. Identity document retention especially. Do not invent a number to close the box.
4. **The model cancellation form and the statutory instructions** (cancellation). The text is substantially prescribed by Schedules 3 and 4 of the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013. Take it from legislation.gov.uk verbatim and adapt only the company details. Note that legislation.gov.uk is blocked by the remote session's egress proxy, so this one has to be fetched from a normal browser and pasted in. Do not write it from memory.
5. **Whether United States and Canada clients get the same cancellation rights, and whose law governs** (cancellation, terms). Genuinely open, with the adviser. In the meantime the site applies the 14 day right to every consumer client, wherever they are, as Yaadly's own commitment.
6. **Liability, the workmanship guarantee and its length, governing law** (terms). With the adviser. The guarantee in particular is not to be promised before it is insured.

Two rules that hold when editing these pages. The consent and provider facts on the privacy page mirror what the code actually does, so if `supabase/functions/_shared/textmodel.ts` moves off MiniMax, or a provider is added anywhere, the provider table and the "two things we will not soften" box change in the same commit or the page is lying. And the whole of `docs/` is subject to the language rules in CLAUDE.md §8: `guardrails.scan` does not read marketing copy, so nothing catches "escrow" or "held safely" on these pages except whoever is writing. Sweep before pushing:

```bash
grep -rnoiE "escrow|ring-fenc|segregated|held in trust|held safely|zero fraud|removes all fraud|fully covered" docs/*.html
grep -rn $'—\|–' docs/*.html   # em and en dashes, banned in copy
```

**A third sweep, added 3 September 2026: the tradesperson's money must never be described as waiting on the client's click.** Under the principal structure the client owes Yaadly and Yaadly owes the tradesperson, and those two obligations are independent. Copy saying "nobody is paid until you approve" glues them back together, which is the escrow picture the structure exists to avoid, and it is also untrue of the worker, who is Yaadly's subcontractor and gets paid whether or not a client abroad has replied. The client's gate is not removed by this, it is pointed at the right party: their sign-off closes the job with Yaadly and releases the balance they owe Yaadly. Eleven places said the old thing on 3 September and all eleven were changed in one commit. Note the contraction, which is why the sweep is two patterns and not one: `docs/marketplace.html` said "Nobody's paid", not "Nobody is paid", and the first sweep missed it.

```bash
grep -rniE "(nobody|no one|nothing)('s| is| are)? (paid|charged) until|paid until you|until you release" docs/*.html preview/*.html web/app supabase/functions
```

Hits on the client's own card ("nothing is charged until you pick one", "authorised at booking") are correct and stay: that is the client's money and the gate genuinely is theirs. Hits describing the *worker* being paid are the bug.

**And the sweep must cover the signed terms, not only the marketing pages.** `web/lib/legal-copy.json` is what a client and a worker put their name to, and on 3 September 2026 it still said the client pays the worker directly while the website said the opposite. A contradiction between a marketing page and a signed document resolves in favour of the document, so the terms are the more important half, and they are the half nobody thinks to grep. The same wording was also duplicated inline in `web/app/apply/JoinFlow.tsx` (what an applicant reads before signing anything) and in `supabase/functions/yaad-inbound/faq.ts` (the facts the reply model may state to a real client), so fixing the canonical JSON is never the whole job.

**Changing either guidelines document is a three-part change, and doing two parts is worse than doing none.**

1. Edit the section in `web/lib/legal-copy.json`, and add a `<p class="amend">` saying what changed and whether earlier signatures carry over. The convention set in v1.1 is that they do not.
2. Bump `WG_VERSION` / `CG_VERSION` and the matching date in the same file.
3. Add a migration setting `worker_guidelines_version` / `client_guidelines_version` in `app_settings` to the new number, in the same commit.

Skip step 3 and everyone who signs the new text fails the gate on the old number while everyone holding a withdrawn signature keeps passing it, because `match_workers_for_job` and `client_go_live` both compare the signature's `doc_version` to `current_doc_version()` with `=`. That has now happened twice, `20260828e` and `20260901i`. Read the live values before assuming the folder is the truth:

```sql
select key, value from public.app_settings where key like '%guidelines_version%';
select doc_type, doc_version, count(*) from public.doc_signatures group by 1,2 order by 1,2;
```

Anyone whose signed version is not the current one must re-sign before they can be matched to a job or go live. Tell the founder how many people that is before applying the migration, not after. The two live client message templates, `yaad-inbound` (the facts the reply model may state) and `yaad-notify-client` (the booking confirmation), are inside this sweep on purpose, because they are the only copy a real client reads without visiting the site, and a fix that stops at `docs/` leaves the worst offender live.

## Creating the Stripe payment links

There is a script: `scripts/create-payment-links.mjs`, with its prices in `scripts/payment-links.json`. Read the JSON before you run anything, because it is the list of amounts Stripe will actually charge.

```bash
export STRIPE_SECRET_KEY=sk_live_...          # your own terminal, never a chat session
node scripts/create-payment-links.mjs          # dry run, creates nothing
node scripts/create-payment-links.mjs --live   # actually creates them
```

The URLs land in `scripts/payment-links.out.json` (gitignored). Those are `https://buy.stripe.com/...` addresses: public, safe to paste anywhere, and the thing a session needs in order to wire them to buttons. The secret key is not in that file and must not leave your terminal.

**Why a script and not the Dashboard.** The Dashboard link builder charges the card the moment the client pays and has no hold option. A hold needs `payment_intent_data[capture_method]=manual`, which is API only. Every one-off service on the menu is under £500, and at or under £500 is a hold under the 3 September rule, so the Dashboard is the wrong tool for the entire menu. The hold is what makes "your card is not charged until you approve the work" true, and that sentence is live on three pages.

**Three guards, all tested.** The script refuses to run without a key, refuses a string that is not shaped like a Stripe secret key, and refuses any one-off priced at or above £500 because that is an invoice, not a link. It dry-runs by default even with a live key.

**Re-running is safe.** Every object is created under an idempotency key derived from the service id and its price, so a second run returns the same link instead of a duplicate. Change a price and you get a new link, which is correct: a Payment Link's amount cannot be edited after creation, it has to be replaced and the old one deactivated in the Dashboard.

**A hold is not money in the bank.** A card authorisation lasts seven days on every brand, with no request to Stripe and no special pricing. If nobody captures it in that window it expires and you have to ask the client again. Capturing is a named person's decision on the evidence, never a timer, so the seven days is an operational commitment: work delivered inside seven days can be a hold, anything slower cannot.

**Before running it live, one thing is unresolved.** `docs/services.html` and `public.service_catalogue` disagree on prices. Property Care is the serious one: the site shows £75, £135 and £175, the catalogue holds £45, £70 and £95. Oversight Retainer and Condition Report differ too, and the express tiers and Project Setup Pack exist on only one side. The JSON follows the site, because that is what a client has been shown, and the `_UNRESOLVED` key in it records the conflict. Settling it is a pricing decision and therefore the founder's. Fix both sides in the same change, or the invoice and the payment link will take different amounts for the same job.

## The older note on choosing between Dashboard and API links

Not done, and it cannot be done from a chat session: creating a link needs the Stripe account, and a secret key must never be pasted into one. The founder creates each link in Stripe, hands over the URLs, and a session wires them to the buttons.

Decide this per service before creating any of them, because it cannot be changed on a link afterwards:

- **A Dashboard link** charges the card immediately. Five minutes, no code. It costs the line "your card is not charged until you approve the work", which is a real loss.
- **An API-created link with `payment_intent_data.capture_method` set to `manual`** holds the card instead of charging it, keeping that line. One API call per link, created once and reused. The Dashboard link builder cannot do this; only the API can.

The recommendation on file is manual capture via the API for the six fixed-price services, because the hold is the differentiator and the links are reusable. Dashboard links are the answer only if money needs to move this week.

The rule underneath the table: work delivered inside seven days is a hold, because a card authorisation lasts seven days on every brand with no request to Stripe. Recurring is a subscription. Long or staged work is a deposit plus stages. Variable trade jobs get invoices, never links, because a link carries a fixed amount and a trade job prices differently every time.

One thing left unresolved for the founder: short jobs paid by hold produce no invoice, and the invoice was the evidence of the principal structure, each one saying the client bought the job from Yaadly. Either raise one separately for the record, or decide the Quote Pack plus a written confirmation carries it. Something has to go out either way, because a written confirmation on a durable medium is required by the distance selling rules.

## Which jobs get an invoice and which get a card hold

Founder's rule, 3 September 2026: **above £500 the job is invoiced. At or under £500 the card is authorised at booking and captured when the client approves the work.** The price of the job picks the instrument. Everything else about the terms, the stages and what each covers, is still agreed in writing per job.

The rule is stated in three places and they must not drift apart: `docs/terms.html` (payment section), `docs/payments.html` (paying for a report or a retainer), and `docs/services.html` (the payment note under the service list). Change one, change all three.

Two things to keep true while you edit them:

1. **The card half is not switched on yet.** No Stripe links exist (see the payment links entry above), so today every job is invoiced whatever its size. All three pages say so. Delete that sentence only when the links are actually live, and not before.
2. **"Your card is not charged until you approve the work" is only true on a hold.** It must never appear on, or next to, an invoice job. That is why the sentence is scoped to "at or under £500" everywhere it appears. Sweep it with:

```bash
grep -rn "not charged until\|authorised at booking" docs/*.html
```

This also part-answers the open question about the invoice being the evidence of the principal structure. Above £500 there is always an invoice saying the client bought the job from Yaadly Ltd. At or under £500 there is not, so the written confirmation that goes out at booking has to carry it, and it has to go out anyway to satisfy the durable-medium requirement in the distance selling rules.

## The worker's 12% is displayed but never collected, and the two sides contradict

Found 3 September 2026 while answering "how do I take my fees from the worker". **Needs a founder ruling before any code moves.** Nothing has been changed except the description on `docs/payments.html`.

**What the two sides are currently told, on the same job:**

| Side | What it says | Where |
|---|---|---|
| The worker | Your labour price, less Yaadly's 12%, "You receive" 88% | `web/components/QuotePanel.tsx`, `web/components/portal/FeeBreakdown.tsx` |
| The client | Pay the tradesperson their labour price plus materials, **"no fee added"** | `raise_job_worker_pay_invoice()` in `20260902i`, which totals `labour_jmd + materials_jmd` |

So the client is invoiced to pay him 100% of labour, and he is shown 88%. **There is no mechanism anywhere that collects the 12%**: no invoice type, no `payable_to` value, no function. The number is decorative. Searching for it finds only the two display components above and a label in the desk.

**Why it cannot be fixed by editing the labels.** Under today's live model the client pays the worker directly and Yaadly never touches that money, so "Yaadly pays you 88%" would be false. The display and the invoicing are one decision, not two.

**The two ways out.**

1. **Principal, which the founder chose on 3 September.** One all-in invoice from Yaadly to the client (labour plus the 15%). Yaadly pays the worker labour less 12%. The 12% is never collected because it is never paid out, and Yaadly's margin on a job becomes 27% of labour. This deletes `raise_job_worker_pay_invoice()` as a client-facing document and turns it into a record of what Yaadly owes the worker. It also means Yaadly receives the whole job payment, which is exactly what `docs/payments.html` promises will not happen until legal sign-off and insurance are in hand, so it is gated on that, not on the code.

2. **Stay agent until that gate lifts.** The client keeps paying the worker directly at 100%, and Yaadly bills the worker separately for the 12%. That is legitimate (an invoice for a service rendered to him, not his money passing through Yaadly), but it means chasing a man in Portmore for 12% after he has already been paid in full, with no leverage left. It is the weakest collection position available and it is why option 1 is the recommendation.

Whichever is chosen, the two display components and the desk label at `concierge/concierge.html` (the "Worker 12%, keeps 88%" row) must change in the same commit as the invoicing, or the contradiction just moves.

## The stage worker-pay function is still on the old shape

`raise_job_stage_worker_pay_invoice(p_job, p_stage)` was **not** converted when the whole-job pair moved to the principal structure on 3 September 2026 (`20260903a`). It still computes the old shape: the worker's full labour apportioned by stage, billed to the client, described as "pay them directly".

Until it is converted, do not use it on a job that has been invoiced with `raise_job_client_invoice()`, or the client will be billed twice for the same labour: once inside their all-in invoice and again on the stage document.

Converting it means the same two changes the whole-job version got, plus one more:

1. The amount becomes the stage's share of labour **less 12%**, plus whatever materials rule the existing function applies.
2. `client_email` becomes the `payable@yaadly.invalid` sentinel and `client_name` becomes Yaadly, so the client cannot read Yaadly's cost base through `invoices_client_read`.
3. Its stage apportionment reads `kickoff_packs.docs -> payment_schedule -> stages` and falls back to `quote_pack_drafts.docs -> payment_stages`. Read both before touching it. That fallback is the part most likely to be got wrong in a hurry, which is why it was left rather than rewritten in passing.

Check for the old function and its callers with:

```bash
grep -rn "raise_job_stage_worker_pay_invoice\|raise_job_agency_fee_invoice\|raise_job_worker_pay_invoice" \
  --include=*.sql --include=*.html --include=*.ts --include=*.tsx . | grep -v node_modules
```

The first two names should appear only in migration files as history. Any live caller in `concierge/`, `web/` or `supabase/functions/` is a bug.

## Payment as principal is switched on, and what still is not

Founder's instruction, 3 September 2026: legal sign-off and insurance are in hand, move forward with payment. The client now buys the job from Yaadly at one agreed price, and Yaadly engages and pays the tradesperson. The "not switched on yet" and "pay your tradesperson directly" statements are gone from `docs/payments.html`, `docs/marketplace.html`, `docs/faq.html` (both the visible answer and the structured data), `supabase/functions/yaad-inbound/faq.ts` and `supabase/functions/yaad-notify-client/index.ts`.

**The claim on the site is deliberately hers, and it is narrower than a guarantee.** It says Yaadly reviews the works and makes sure issues are handled. It does not say Yaadly guarantees the work, and it does not state a workmanship guarantee period, because no length has been set and none should be promised before it is insured for that length. The placeholder box on `docs/terms.html` stays until she sets one.

**Two things this did not switch on.**

1. **Card payment.** No Stripe links exist yet, so every job is still invoiced and paid by bank transfer. `docs/terms.html`, `docs/payments.html` and `docs/services.html` all still say so, correctly. That sentence comes out when the links are created, not before.
2. **CLAUDE.md section 9** still lists "payment integration of any kind, before the legal review lands" as deliberately not being built. That is now stale. **Monique owns that file and a session must not rewrite it**, so it needs her edit, not ours.

**Redeploy after any change to the assistant's facts.** `faq.ts` and `price-figures.ts` live in `yaad-inbound`, not `_shared`, so `sync-shared.sh` does not copy them. Deploy from disk:

```bash
supabase functions deploy yaad-inbound --project-ref leffyisvfvjwzilydlwf --no-verify-jwt
supabase functions deploy yaad-notify-client --project-ref leffyisvfvjwzilydlwf
```

Check the live `verify_jwt` setting with `supabase functions list` first and preserve it: `yaad-inbound` carries its own authentication and takes the flag, `yaad-notify-client` does not.

## The figure guard and the published prices move together

`supabase/functions/yaad-inbound/price-figures.ts` holds `PUBLISHED_POUNDS`, an exact list of every pound figure the assistant is allowed to say. Any figure not on it gets the whole sentence cut before the reply is sent.

This bit us on 3 September 2026: the catalogue price alignment changed the published prices without touching the list, so the assistant would have had "Condition Report from £249" and "Property Care from £45" silently stripped, leaving clients with no price at all. The file's own comment says to update it in the same commit as `faq.ts`. Do that.

The list is now `45, 70, 95, 125, 149, 245, 249, 349, 395, 495, 500, 2500`. Whenever a price on `docs/services.html` changes, this list and `faq.ts` change in the same commit, and `service_catalogue` is the source of truth for all three.

Deno is not installed in every session, so if you cannot run `deno test` in `supabase/functions/yaad-inbound`, the four assertions that matter can be checked directly: every £, J$ and % figure in `FAQ_FACTS` appears in the published sets, and `FAQ_FACTS` contains no em or en dash and no backtick or `${`.

## Pasting the Stripe payment links in

The site is wired and waiting. One place to edit: `PAYMENT_LINKS` near the top of the script block in `docs/services.html`.

```js
const PAYMENT_LINKS = {
  deposit:   "https://buy.stripe.com/...",
  visual:    "",
  condition: "",
  signoff:   "",
  care:      "",
  retainer:  ""
};
```

Paste a URL against a service and a pay button appears on that service's booking confirmation. Leave one empty and that confirmation reads exactly as it does today, so there is never a dead button or a half wired payment. The keys are the booking form's own service values, not the catalogue ids.

**Why the pay link is after the booking and not on the service card.** The card buttons are already claimed by the page's own script, which routes them into the booking form. That form is where the client's name, contact and property go on record, where the reference is minted, and where the cancellation information has to reach them. A card button pointing straight at Stripe would skip all of it, and a client would have paid before Yaadly knew who they were or had given them their 14 day cancellation notice. So the link appears on the confirmation, once the booking exists.

Get the URLs by running `scripts/create-payment-links.mjs` with your own key, per the entry above. Do not create them in the Dashboard: those charge immediately and cannot hold.

**Still missing before a link should go live:** the express request to start work inside the 14 days, recorded at booking. Stripe Payment Links can carry a required acceptance checkbox at checkout, pointed at `docs/cancellation.html`. Without it a client can cancel on day ten and owe nothing while Yaadly still owes the checker.

---

## Publishing a question somebody asked on /ask

Read this with the section above, which covers a visitor who cannot ask at all. This one is the other half: a question arrived and nothing happens to it until you act.

**Where they wait.** Every question lands in `questions` with `published = false`. The concierge desk shows them under **Inbox, Questions**, and the Overview carries a tile, "Questions to publish", plus an alert while any are waiting, so you do not have to remember to look.

**To publish one.** Open the row, read the whole thing, then press **Publish it**. It goes onto the public page word for word, where anybody on the internet can read it and any vetted worker can answer it. Check it carries no name, phone number, email or address first. The column **Worth a second read** marks anything number-shaped: a run of seven digits is both a local phone number and a price in Jamaican dollars, and the form deliberately lets that through so pricing questions are not blocked, which makes it yours to judge.

**Take it down** removes it from the public page again, along with any answers under it, because an answer is only public while its question is. The row stays for you.

**To leave one.** Do nothing. There is no reject button and no timing promised to the asker, so an unpublished question simply stays unpublished.

---

## Changing anything a customer reads about money, checks or prices

`docs/COPY-GUIDELINES.md` is the source of truth for customer facing wording, across both the marketing site and the app. Read it before writing page copy, and change it first if the underlying fact has changed. See DECISIONS.md, "Two lanes, named" (4 Sep 2026), for why it exists.

**Say which lane it is, before you say anything about money.** A **managed job**: the client buys the job from Yaadly, and Yaadly engages and pays the tradesperson as its subcontractor. **Oversight only**: the contractor stays the client's, the client pays them directly, Yaadly holds none of that money and invoices only its own fee. Almost every contradiction the September audit found came from a page reaching for the wrong one.

**Never write that the client releases, approves or triggers a payment.** They accept the work. Yaadly then pays its own subcontractor, and a named person at Yaadly makes that call. Both halves, every time. The forbidden phrasings are listed in COPY-GUIDELINES section 3, and the reason is legal rather than stylistic: `docs/terms.html` says the client does not contract with the tradesperson, so a client cannot release that person's pay.

**A price appears in more places than you think.** Changing one means changing all of these in the same commit, or the site starts contradicting itself and, where a founding rate is involved, breaks the Digital Markets, Competition and Consumers Act 2024:

1. `docs/services.html`, the card price and the `price-alt` line under it
2. the `wa.me` prefill message on that same card, which quotes the price in the text
3. `docs/faq.html`, the "What does it cost?" answer
4. `docs/index.html`, the owner door, for the two services listed there
5. `docs/prices.html`, the "What Yaadly charges" table, for fees rather than service prices
6. `web/lib/.../price-figures.ts`, the exact-figure allowlist that governs what the assistant may say
7. `service_catalogue` in the database

**A founding rate must be a real reduction.** Never publish one equal to the standard rate. Where there is no discount, write "Fixed fee, the same rate for everyone".

**Never claim a check the database does not enforce.** `trg_profile_publish_checks` is the gate: a Persona identity check approved or completed, a TRN approved, and an email. That is what "nobody is listed before" may claim. The three-referees rule (any job over £500, any occupied home, any job holding keys) is real policy but is operational, not enforced by the trigger, so it is written as policy. If you find copy claiming a video call or that references are called for everyone, it is wrong: that exact wording was live until 4 September 2026.

**One reply promise, site wide:** a person replies within one working day. Not "same day", not "any time", not "day or night", not "24 hours".

**After changing copy on the app side**, run `npm --prefix web run typecheck`, `npm --prefix web test` and `npm --prefix web run lint`. Several tests assert on visible strings.

---

## The reply clock, and what to do when the Overview goes coral

The Overview's first tile is **Oldest thing waiting**. It reads `v_reply_clock`, which lists everything nobody has answered yet, oldest first, across `intake_threads` (WhatsApp, SMS, email, website chat) and `enquiries` (the contact form).

- **Amber** means somebody is waiting and is still inside one working day.
- **Coral, with an alert row above the tiles**, means the published promise has been missed. Every public page says a person replies within one working day. Clear these first, before evidence and before drafts, because it is the one promise a client can check without your help.

**A thread leaves the clock when you reply from the desk**, not when you read it. `yaad-desk-reply` stamps `first_human_reply_at` once and never clears it, so the number is about the first answer rather than the most recent. An enquiry leaves the clock when its status becomes `replied` or `converted`, stamped by `trg_enquiry_reply_clock`.

**If the tile says "nothing" and you know somebody is waiting**, the row has been answered in a way that did not go through the desk (a reply sent from your own phone, for instance). That is not a bug in the clock, it is the clock telling the truth about what it can see. Reply from the desk, or mark the enquiry, and it will correct itself.

**One working day is 24 hours here**, not a business-hours calculation, because clients are in the UK, the United States and Canada and workers are in Jamaica. The interval lives in `v_reply_clock` and nowhere else.

---

## Pausing the agents, including the one that answers WhatsApp at 2am

The switch is in the top bar of the desk and writes `app_settings.agents_paused`.

**Since 4 September 2026 it reaches `yaad-inbound`**, which is the function that answers WhatsApp, SMS, email and the website chat. Before that it did not, and the desk said so in three places.

What paused actually does:

- No model call happens anywhere, on any path through `yaad-inbound`.
- The message is still recorded. Photographs and voice notes are still kept and still transcribed, because those build the record you then read.
- The client is told a person is reading it and given their reference. Nobody is left in silence.
- The thread is handed to you on their **first** message, not after three turns.

**If you pause and somebody still gets an assistant reply**, check in this order:

1. `select value from app_settings where key = 'agents_paused'` actually says `true`.
2. The deployed `yaad-inbound` is the current one. `agentsPaused()` should be in it. Redeploy from disk if not.
3. Whether the reply was really from the assistant, or from the desk, or a Twilio template such as the daily check-in, which this switch does not touch.

**The read fails closed.** If `app_settings` cannot be read at all, inbound treats itself as paused and hands every conversation to you. So a flood of handoffs with no obvious cause is a symptom of the settings read failing, not of the switch being stuck on.

**Do not widen the Settings or Health copy without widening the code.** A switch that claims more than it does is worse than no switch, and that now cuts in both directions.

---

## Renaming a HubSpot deal stage

Stage labels reach clients through deal notifications, workflow emails, exports and any screenshot. **`guardrails.scan` never sees them**, so the banned-language rules are yours to enforce here by hand. A stage called "Funds Held" was live until 4 September 2026 while every page on the site said Yaadly does not hold money on a client's behalf.

To rename one:

1. **Relabel in the HubSpot UI. Never delete and recreate.** Settings, Data Management, Objects, Deals, Pipelines. Relabelling keeps the internal stage ID; recreating mints a new one and every ID in `web/lib/hubspotConfig.ts` goes stale at once.
2. Update `STAGE_LABELS` in `hubspotConfig.ts` so the file and the portal agree.
3. If the meaning changed rather than only the wording, rename the key in `DEAL_STAGES` and every use of it, and say why in `DECISIONS.md`.
4. `npm --prefix web run typecheck && npm --prefix web test`.

**Outstanding manual step from 4 September 2026:** the code now says `Client Paid, Work In Progress` for stage `presentationscheduled`. The label in the HubSpot portal still says `Funds Held` until somebody relabels it there. The code change does not perform it.

---

## Drafting a report

`yaad-report` turns the notes you wrote on site into the findings of a draft report. It does not finish it, and it cannot.

1. Write your notes however you like, roughly is fine, and gather the photograph captions. Fewer than 40 characters of notes is refused rather than drafted thinly.
2. Call the function with `kind` (`deposit_check`, `condition`, `technical_signoff` or `visual_check`), your `notes`, and any `captions`. It writes a `reports` row at `draft` and its `report_findings`.
3. **Rate every finding** Severe, Moderate or Low. Nothing drafts this and nothing ever will. Your rating is stamped with your email and the time.
4. **Write the verdict and the page one line.** Same rule.
5. Move the report to `issued`. That mints its number and records who issued it.

**If it refuses to issue**, the message says which of the three it is: an unrated finding, a missing verdict, or a measurement that survived the scrubber. All three are the gate working. The third one names the offending sentence: reword it in words rather than numbers, or refer it to a surveyor.

**Check the `scrubbed` array on the report.** It lists every measurement the model produced and had removed. A long list means the notes themselves were full of dimensions, which is worth knowing before you sign something that says Yaadly does not measure.

**If the draft comes back thin or wrong**, it is almost always the notes rather than the model. It is forbidden from adding anything you did not record, which is the correct behaviour and will look like laziness the first time. Read the `omitted` list it returns: that is the agent telling you what it could not source.

---

## Reading a job's whole history

`agent_actions` is the append-only record of what the agents drafted and what a named person then decided. `v_job_history` reads one job as a single list, oldest first.

Use it when a client disputes something, when you want to know why a job took nine days, or before any conversation where somebody is going to ask who decided what.

**It refuses to record a consequential action against a machine.** Releasing or withholding funds, refunding, ruling on a dispute, changing a reputation, suspending a worker, approving a job or a stage: all of these require `actor_kind = 'human'` and a real name. "system", "auto", "agent" and an empty actor are refused by the check constraint. If a write fails with `agent_actions_human_only`, the code doing the writing is wrong, not the constraint.

**Nothing can edit it through the API.** Insert, update and delete are revoked from `anon` and `authenticated`. Writes come from the Edge Functions on the service role. That is what makes it worth putting in front of somebody.

---

## Publishing a change to the How We Use AI page

`docs/how-we-use-ai.html` is linked from the footer of all twelve public pages and from the business page. It makes three specific, checkable claims:

1. The invoicing model has no field for an amount.
2. The sketch packs cannot state a measurement, stopped in three places.
3. Identity documents are held back before the file is fetched, with no setting to override.

**If any of those three stops being true, that page becomes a false claim to clients**, which is worse than never having made it. Before changing anything in `yaad-invoice`, `yaad-sketch` or `yaad-vetting-review`'s `IDENTITY_DOCS`, read that page and decide which sentence has to change with it.

The provider list is deliberately not repeated there. It lives on `privacy.html`, and that is the one to update when a provider changes.
