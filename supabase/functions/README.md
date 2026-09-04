# Yaadly Edge Functions

The four Supabase Edge Functions that make up the live platform behind
yaadly.co.uk. Until 20 August 2026 this code existed only inside Supabase and
was not in the repository at all, which meant OllyGarden's instrumentation
review — which reads the GitHub repo — could not see the part of the system
that actually serves real users. That is why these files are here.

| Function | verify_jwt | What it does |
|---|---|---|
| `yaad-agent` | true | Intake and Reporting agents (MiniMax-M2.7), admin session only |
| `yaad-vision` | true | AI photo review of evidence (NVIDIA NIM vision model), admin session only |
| `yaad-website-intake` | false | Public job request form on yaadly.co.uk → job row + client photos |
| `yaad-enquiry` | false | Public contact form on yaadly.co.uk → enquiry row + emailed receipt |
| `yaad-invoice` | true | Invoicing agent: instruction → numbered draft invoice, admin session only |
| `yaad-sketch` | true | Site Sketch Pack: video stills → rooms, condition schedule, schematic, admin session only |
| `yaad-inbound` | false | Every inbound message: Twilio WhatsApp and SMS, Resend email, and since 2 Sep 2026 the chat widget on yaadly.co.uk (`channel: "web"`, see `web-chat.ts`). One intake assistant, one handoff rule, one banned-language screen, three doors. The web door has no signature; the Origin check plus the `web_chat_attempts` throttle stand in for one, the same posture as `yaad-enquiry` |
| `yaad-report` | true | The report drafting agent: an inspector's notes and photograph captions become the findings of a draft report, admin session only. **No severity field and no verdict field in its schema**, the same shape as `yaad-invoice` having no amount field. See below |
| `yaad-message-status` | **false** | Twilio's delivery callbacks: queued, sent, delivered, read, failed, undelivered, keyed on Twilio's own MessageSid into `message_deliveries`. Carries its own authentication (the same HMAC check `yaad-inbound` uses, from `_shared/twilio-signature.ts`) and refuses outright when the token is missing. Records what it is told and acts on nothing, so a forged callback can only ever make a status wrong, never move anything |
| `yaad-phone-check` | true | Twilio Lookup on a number a worker typed: is it real, is it a mobile, and what is it in E.164. Called from the portal's link-your-number form before the number is saved. Holds no service-role key and touches no table; it reports and the caller decides. `verify_jwt` stays true because Lookup costs money per call |
| `yaad-desk-reply` | true | Monique's typed reply to a Conversations thread, sent from the Yaadly Twilio number, or into `web_chat_replies` for a website chat thread. No model call anywhere in it; `is_admin()` checked inside as well. A send marks the thread `human_handling`, so `yaad-inbound` stands down until the desk hands it back |

`verify_jwt` matters. The three public endpoints must stay `false`, because
Meta and an anonymous website visitor have no Supabase session, and they carry
their own authentication instead (HMAC signature verification, and field
validation plus a service-role write and a throttle). Do not "fix" these to
`true`.

`yaad-enquiry` sends mail to an address the caller types in, so its throttle is
load-bearing rather than housekeeping: without the per-recipient cap it is an
open relay pointed at whoever somebody names.

## Secrets added on 4 September 2026

All Supabase Edge Function secrets. Every one of them is a switch: while it is
unset the feature it belongs to does nothing at all, so none of these changes
behaviour on the live number until it is set.

| Secret | Turns on | Set up |
|---|---|---|
| `HUBSPOT_LEAD_WEBHOOK_SECRET` | a confirmed job becoming a HubSpot contact and deal | already set, both sides |
| `TWILIO_CONTENT_SID_APPROVE` | the tap-to-approve button on the message asking a client to approve | needs a Quick Reply template |
| `TWILIO_CONTENT_SID_DESK_REPLY` | the nudge sent when a desk reply lands outside the 24 hour window | needs a Utility template |
| `TWILIO_STATUS_CALLBACK_URL` | Twilio reporting whether a message was delivered, read or failed | needs `yaad-message-status` deployed |

Full instructions for each are in RUNBOOK.md. Nothing here is a code change:
they are all "build the thing in Twilio, then set the value".

## Tracing

Every function is instrumented with OpenTelemetry via `otel.ts`, a
dependency-free OTLP/HTTP + JSON exporter. Spans follow the OpenTelemetry
semantic conventions, including the GenAI conventions for model calls, so any
OTLP-compatible backend understands them without custom mapping.

`otel.ts` is maintained in `_shared/otel.ts` and copied into each function
directory, because Supabase deploys each function as a self-contained bundle.
After editing the shared copy, run `./sync-shared.sh` before deploying.

Real WhatsApp traffic runs through `yaad-inbound` (Twilio), which carries the
same shape of trace: a signature check, a model call, a `db.insert jobs` (or
`db.update jobs` for a message continuing an existing thread), and a reply.
(This section used to describe `yaad-whatsapp-webhook`, a direct Meta Cloud
API webhook that never received real traffic and was deleted 1 Sep 2026, see
DECISIONS.md.)

A new job is a conversation, not a questionnaire. The whole thread lives in
`intake_threads`, keyed on channel plus sender, and every turn is read back to
the model as one transcript so the second line means something. The job row is
written on every turn and stays `draft` until the client agrees the read-back
is right.

(This paragraph used to describe a guided seven question intake held in
`wa_intake_sessions`. That belonged to `yaad-whatsapp-webhook`, deleted 1 Sep
2026. `wa_intake_sessions` now holds three short-lived WORKER lanes only:
`evidence`, `report_confirm` and `text_update`. Corrected 4 Sep 2026, along
with the Mid-chat view in the concierge, which was describing the same
questionnaire.)

An email address the client types is never written to `jobs.client_email`,
because that column is the binding and a mailbox nobody has proved must not
bind a job. It only receives the portal link, and clicking that link is what
binds, as everywhere else. On the email channel the sender address is different:
they had to control that mailbox to send from it, so it binds directly.

Every inbound message id is recorded in `wa_inbound_seen` before any state
changes and before the transcription and model calls, keyed on Twilio's
`MessageSid` and Resend's `email_id`. A redelivery that does not get a prompt
2xx would otherwise be read as the client's next answer: a question skipped, a
photograph filed twice, or a second job for one client. A repeat now returns
200 having touched nothing.

**This was aspirational until 4 September 2026 and is now true.** The ledger
was created on 30 August for the Meta webhook, that function was deleted on 1
September, and for three days this paragraph described a control that no live
code read or wrote. The same table also carries the per-number hourly throttle
(40 an hour), which this endpoint had no equivalent of at all while the website
chat door had three.

The root span's `yaadly.inbound.outcome` says which path ran. As of 4 Sep
2026: `duplicate`, `throttled`, `unverifiable`, `bad_signature`, `held_for_human`,
`web_thread_adopted`, `web_poll`, `web_bad_origin`, `web_bad_token`,
`web_throttled_caller`, `web_throttled_global`, `gathering`, `job_created`,
`job_write_failed` or `uncaught`. `yaadly.agents_paused` says whether the desk
switch was on, which is the difference between "the model wrote nothing" and
"the model was never asked".

(This list previously named the outcomes of `yaad-whatsapp-webhook`'s guided
intake, none of which this function has ever emitted.)

### Turning it on

Tracing is off until an endpoint is configured, and the tracer is completely
inert when it is — no network calls, no overhead, no possibility of an
exception reaching a request. Set these as Edge Function secrets:

```
OTEL_EXPORTER_OTLP_ENDPOINT   https://<ingest-host>      # base URL, /v1/traces is appended
OTEL_EXPORTER_OTLP_HEADERS    api-key=<key>              # comma-separated k=v
OTEL_DEPLOYMENT_ENVIRONMENT   production                 # optional
```

Get the endpoint and key from your OllyGarden account. The exporter is
vendor-neutral OTLP, so any collector works — useful as a fallback if you want
to see traces immediately without waiting on account setup.

### Design rules for this module

1. Telemetry must never break a request. Every tracer path is wrapped and a
   failed export is swallowed.
2. Nothing is exported unless an endpoint is configured. Same contract as
   `yaad/telemetry.py` in the engine.
3. Exports use `EdgeRuntime.waitUntil` so they never delay a response — which
   matters most for the WhatsApp webhook, where Meta enforces a timeout.
4. Attribute values are truncated to 1024 characters. A 6k prompt must never
   become a span attribute.

## Deploying

Deploy each function with its `otel.ts` alongside `index.ts`, preserving the
`verify_jwt` value in the table above.

## yaad-invoice, and why the model cannot type a number

`yaad-invoice` turns "Marcia's August retainer plus two extra visits to
Portmore" into a numbered draft invoice. The governing rule of this project is
that AI drafts and a named human confirms, and money is the sharpest edge of
that rule, so the guard is in Postgres and not in the prompt.

The model's JSON schema has **no amount field**. It may return a
`catalogue_id` and a tier, nothing else. On write, `invoice_line_price_guard`
looks the amount up in `service_catalogue` and overwrites whatever arrived.
Anything the model could not map to the catalogue is stored as `needs_price`
at zero, and `invoice_status_guard` refuses to let the invoice leave draft
while such a line exists.

Three moves the function will never make:

| Move | Who makes it | What stops the function |
|---|---|---|
| Choosing a price | the catalogue | no field in the schema, and the trigger overwrites |
| Sending an invoice | Monique | the function has no send path at all |
| Marking one paid | Monique, signed in | `invoice_status_guard` calls `is_admin()` and raises |

The function holds no service-role key. Every database call goes out under the
caller's own token, so RLS is doing the access control.

Proof: `supabase/tests/invoicing_guards.sql`, eleven assertions, all passing as
of 26 August 2026. Schema: `supabase/migrations/20260826_invoicing.sql`.

## yaad-sketch, and the line it does not cross

A walkthrough video and a set of photos become an indicative record of a
property: key frames, a room by room condition schedule, and a schematic
sketch showing rooms, doors and where each photo was taken.

**It does not measure anything, and it cannot be made to.** A phone video
carries no scale, so any dimension taken from one is invented. Producing
measured drawings for reward is also regulated work in Jamaica. Yaadly
guarantees what it controls, which is project management, procurement and
oversight judgment, and a drawing with numbers on it is outside that line in
exactly the way price estimation is.

So the rule is enforced three times, and only one of them is a prompt:

| Layer | Where | What it does |
|---|---|---|
| The prompt | `FRAME_PROMPT`, `ASSEMBLE_PROMPT` | forbids stating any dimension, and asks for words instead: "a hairline crack", "most of the ceiling" |
| The scrubber | `MEASUREMENT_RE` in `index.ts` | replaces any measurement the model produced anyway with `[size removed]`, and reports every one to the desk rather than hiding it |
| The database | `has_measurement()` and `sketch_guard_approval` | refuses to let a pack carrying a measurement be approved, naming the offending sentence |

`MEASUREMENT_RE` here and `has_measurement()` in the migration must stay in
step. Both deliberately exclude a bare "in" as a unit, because "1 in 5 tiles is
cracked" is ordinary English and not a measurement. Both are tested against the
same eighteen sentences: `supabase/tests/sketch_guards.sql`.

**The drawing is generated by code, not by a model.** The model supplies the
room list and which rooms connect. `buildSketch()` decides where the boxes go,
using a snaking grid in walk order, with a real door swing where connected
rooms are grid neighbours and a dashed line where they are not. That is why it
is honest to call it a schematic: it shows topology, never geometry.

**Frames arrive already extracted.** There is no ffmpeg in the edge runtime, so
stills are pulled from the video in the browser with a `<video>` element and a
canvas. The walkthrough of somebody's home never leaves the machine it was
loaded on. Only the stills she keeps are uploaded, six per call, which is also
what keeps each request inside the function's timeout.


## yaad-report, and the two fields it does not have

Three of the seven priced services are a document: the Deposit Protection
Check, the Condition Report and the Technical Sign-off. `services.html`
promises a verdict on page one, normally within 72 hours of the visit. Typed by
hand, a £249 report costs an evening, which caps the whole business at roughly
four reports a week.

So the agent drafts the findings. It does not write the two things the client
is actually paying for.

**A client paying for a Condition Report is not buying prose.** They are buying
somebody with seven years of UK construction project management saying "this
one is Severe, and here is what I would do about it". Draft the prose and you
save an evening. Draft the rating and you have sold a judgment nobody made.

| Move | Who makes it | What stops the function |
|---|---|---|
| Rating a finding Severe, Moderate or Low | Monique | no field in the schema; `report_guard_issue` refuses to issue with any finding unrated; `report_stamp_rater` requires `is_admin()` and records who rated it |
| Writing the page one verdict | Monique | no field in the schema; the same trigger refuses to issue without one |
| Stating a measurement | nobody, ever | the prompt forbids it, `MEASUREMENT_RE` scrubs and reports what arrives anyway, and `has_measurement()` refuses the issue |
| Pricing a remedy | Monique | no field in the schema, same as `yaad-invoice` |
| Answering valuation, title, structure or boundaries | four named professionals | the prompt routes them to `questions` instead of writing a finding |

`MEASUREMENT_RE` here and `has_measurement()` in `20260904c` are the same rule
the sketch packs already use, deliberately reused rather than reimplemented: a
second copy of that regex would drift, and the sketch one is already tested
against eighteen sentences.

There is a second scrub, `RATING_WORDS`, which is belt and braces on rule 1.
A model told not to rate will occasionally rate in prose anyway, and "this is a
severe problem" inside a body reads to a client exactly like the rating they
paid a person for.

The function holds no service-role key. Every database call goes out under the
caller's own token, so RLS is doing the access control.

Proof: `supabase/tests/report_guards.sql`, eleven assertions.
Schema: `supabase/migrations/20260904n_the_report_drafter.sql`.
