# Yaadly Edge Functions

The Supabase Edge Functions that make up the live platform behind
yaadly.co.uk. Until 20 August 2026 this code existed only inside Supabase and
was not in the repository at all, which meant OllyGarden's instrumentation
review, which reads the GitHub repo, could not see the part of the system
that actually serves real users. That is why these files are here.

**This file opened by saying there were four of them until 4 September 2026.
There are 29.** It had said four since the day it was written and the table
below it listed nine, which is the failure mode CLAUDE.md §11 warns about: a
document that describes what got built rather than a rule goes stale, and a
stale inventory reads as a current one. Corrected by the agent audit.

**Never trust the counts in this file. Read them live:**

```bash
supabase functions list --project-ref leffyisvfvjwzilydlwf
```

As at 4 September 2026: **29 functions in this directory, 30 deployed.** The
extra one is `yaad-nim-probe`, which has no source in this repository, is
mentioned in no document, has had no traffic, and was deployed 42 times in
late August. It looks like a leftover NVIDIA NIM connectivity probe. It runs
with `verify_jwt = true`, so it is not publicly reachable. It has been left
alone rather than deleted, because deleting a deployed endpoint nobody can
read the source of is not a tidy-up, it is a guess. Decide it deliberately.

**Nine of the 29 call a text model**, all of them through
`_shared/textmodel.ts`: `yaad-agent`, `yaad-completion`, `yaad-inbound`,
`yaad-invoice`, `yaad-kickoff`, `yaad-notify-client`, `yaad-post-job`,
`yaad-quote-pack` and `yaad-sketch`. Two more call a vision model directly
(`yaad-sketch` again, and `yaad-notify-client`'s ported photo review), and
`yaad-transcribe` calls speech-to-text. Everything else has no model in it.

(`yaad-vision` was deleted on 4 September 2026. It had existed since 17 August
and nothing ever called it: its logic was ported into `yaad-notify-client` on
31 August because a server-to-server caller had no session to present, leaving
two copies of one prompt with only one of them maintained.)

| Function | verify_jwt | What it does |
|---|---|---|
| `yaad-agent` | true | Intake, trade classifier and Reporting agents. Model comes from `_shared/textmodel.ts`, which has been Mistral in the EU since 4 Sep 2026. Admin session only |
| `yaad-website-intake` | false | Public job request form on yaadly.co.uk → job row + client photos |
| `yaad-enquiry` | false | Public contact form on yaadly.co.uk → enquiry row + emailed receipt |
| `yaad-invoice` | true | Invoicing agent: instruction → numbered draft invoice, admin session only |
| `yaad-sketch` | true | Site Sketch Pack: video stills → rooms, condition schedule, schematic, admin session only |
| `yaad-inbound` | false | Every inbound message: Twilio WhatsApp and SMS, Resend email, and since 2 Sep 2026 the chat widget on yaadly.co.uk (`channel: "web"`, see `web-chat.ts`). One intake assistant, one handoff rule, one banned-language screen, three doors. The web door has no signature; the Origin check plus the `web_chat_attempts` throttle stand in for one, the same posture as `yaad-enquiry` |
| `yaad-desk-reply` | true | Monique's typed reply to a Conversations thread, sent from the Yaadly Twilio number, or into `web_chat_replies` for a website chat thread. No model call anywhere in it; `is_admin()` checked inside as well. A send marks the thread `human_handling`, so `yaad-inbound` stands down until the desk hands it back |

`verify_jwt` matters, and the count in this paragraph was wrong too. It said
three public endpoints. As at 4 September 2026 **ten** run with `verify_jwt =
false`: `yaad-book-service`, `yaad-enquiry`, `yaad-inbound`,
`yaad-notify-client`, `yaad-portal-code`, `yaad-post-job`, `yaad-quote-landed`,
`yaad-vetting-review`, `yaad-vetting-upload` and `yaad-website-intake`. Each
carries its own authentication instead: a signature check, an origin check, a
throttle, or a shared secret. An anonymous website visitor has no Supabase
session, so these cannot be "fixed" to `true`.

Read that list live before acting on it, exactly as CLAUDE.md §12 says. This
line has now been wrong twice, and it is the control.

`yaad-vision` used to have a row in the table above. It is gone, see the note further up.

`yaad-enquiry` sends mail to an address the caller types in, so its throttle is
load-bearing rather than housekeeping: without the per-recipient cap it is an
open relay pointed at whoever somebody names.

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

A new job runs as a guided intake instead of a single-shot card: the agent
asks Monique's seven questions one at a time, holding the answers between
messages in `wa_intake_sessions` (deleted when the job is created). Whatever
the opening message already answered is prefilled and not asked again, and
the job is only inserted once the set is complete.

The last question asks for an email, and the answer is the one thing the
intake can refuse: anything that is neither an address nor a refusal is asked
again rather than saved. The address is never written to `jobs.client_email`,
because that column is the binding and a mailbox nobody has proved must not
bind a job. It only receives the portal link, and clicking that link is what
binds, as everywhere else.

Every inbound message id is recorded in `wa_inbound_seen` before any state
changes and before the transcription and model calls. Meta retries a delivery
that does not get a prompt 2xx, and without the ledger the retry was read as
the client's next answer: a question skipped, or a second job for one client.
A repeat now returns 200 having touched nothing.

The root span's `yaadly.webhook.outcome` says which path ran: `duplicate`,
`intake_started`, `intake_answer`, `intake_photo`, `intake_retry`,
`intake_email_retry`, `intake_cancelled`, `job_created`, `job_insert_failed`,
`follow_up_answered`, or `follow_up_escalated`.

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
