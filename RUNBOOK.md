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


---

## A client says they never heard about their quote

The quote is saved either way: `yaad-quote-landed` is called after the insert and a failure there never loses it. The function reports what it managed, so ask it rather than guess.

**Look at the trace.** `yaadly.notify.outcome` reads `told` when at least one channel worked and `nobody_told` when neither did. `yaadly.notify.emailed` and `yaadly.notify.whatsapp` say which.

**The three ordinary reasons, in the order they actually happen.**

1. **The job has no email and no phone.** A job posted with only one channel has only that one to send on, and a WhatsApp intake job often has a number and no address. Nothing to fix in code: put the missing one on the job.
2. **Twilio Trust Hub KYC is not approved.** This is the live blocker, 31 Aug 2026. The WhatsApp sender is registered and ONLINE (`whatsapp:+447878877567`, "Yaadly LTD"), `TWILIO_WHATSAPP_FROM` is set, the account is Full with a balance, and Twilio still refuses every send:

   > twilio 401 (20003): Primary compliance profile is not approved. Please refer to documentation and complete the KYC process in Trust Hub to gain access.

   Everything else on the WhatsApp path is done and set: the sender, and the approved-template route below. This is the only thing standing between a quote and a client's phone.

   **Fix it in Twilio Console, Trust Hub, Primary Customer Profile**, with the Yaadly Ltd details: England and Wales company **17358077**, the registered address, and a named authorised representative. It is business verification, not a technical step, and nothing in this repository can do it. Nothing else needs changing afterwards: the moment the profile is approved, sends start working with no deploy.

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

**What is set.** `TWILIO_CONTENT_SID_QUOTE` points at `yaadly_quote_landed_v2`, submitted 31 Aug 2026, category UTILITY. `yaad-quote-landed` uses it whenever it is set and falls back to free text when it is not. A template is valid inside the 24 hour window too, so there is one path rather than two half-paths.

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

**"While your account is in Probation..."** Working as intended. A probation worker quotes standard jobs and is refused three things: work over about **J$105,000**, any job where they would hold keys, and any job inside an occupied home. Those are the founder's top tier, and they open when `vetting_state` becomes `verified`, which happens at publishing after the police check and the telephoned references.

**To lift somebody out of Probation**, only once those are genuinely done:

```sql
update public.worker_profiles
   set vetting_state = 'verified', updated_at = now()
 where worker_email = 'them@example.com';
```

**"This account is suspended."** Deliberate. Set `vetting_state = 'suspended'` and keep the row; deleting it loses the record of why.

**The J$105,000 line is £500 at roughly J$211 to the pound.** The rate moves. It is a single constant, `top_tier_jmd`, in that one function, and changing it needs a migration rather than a settings change, on purpose: it is the line between a call-out and somebody's savings.

**The access test reads `jobs.access_type`**, which carries the client's own words, like "Neighbour holds a key" or "Family member on site". A job with no access type set is treated as standard, so a job posted without that answer will not be caught by it. The money test still applies.
