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
| `yaad-whatsapp-webhook` | false | Meta Cloud API inbound webhook: verify → extract → create job → reply |
| `yaad-website-intake` | false | Public job request form on yaadly.co.uk → job row + client photos |
| `yaad-invoice` | true | Invoicing agent: instruction → numbered draft invoice, admin session only |

`verify_jwt` matters. The two public endpoints must stay `false` — Meta and an
anonymous website visitor have no Supabase session — and they carry their own
authentication instead (HMAC signature verification, and field validation plus
a service-role write). Do not "fix" these to `true`.

## Tracing

Every function is instrumented with OpenTelemetry via `otel.ts`, a
dependency-free OTLP/HTTP + JSON exporter. Spans follow the OpenTelemetry
semantic conventions, including the GenAI conventions for model calls, so any
OTLP-compatible backend understands them without custom mapping.

`otel.ts` is maintained in `_shared/otel.ts` and copied into each function
directory, because Supabase deploys each function as a self-contained bundle.
After editing the shared copy, run `./sync-shared.sh` before deploying.

A single inbound WhatsApp message produces one trace containing:

```
POST /yaad-whatsapp-webhook          (SERVER)
├── webhook.verify_signature          (INTERNAL)  signature checked / valid
├── chat MiniMax-M2.7                 (CLIENT)    gen_ai.*, token usage, parsed?
├── db.insert jobs                    (CLIENT)    db.*, portal code issued?
└── whatsapp.send_reply               (CLIENT)    delivery status
```

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
