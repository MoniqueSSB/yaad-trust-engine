// Yaadly Edge Function tracing.
//
// A dependency-free OpenTelemetry tracer that emits OTLP/HTTP + JSON. The full
// OpenTelemetry JS SDK is deliberately not used here: it pulls a large npm
// dependency tree into the Deno edge runtime, which costs cold-start time on
// every invocation of a function that is meant to answer a WhatsApp webhook
// inside Meta's timeout. OTLP/HTTP JSON is a stable wire format and is all the
// exporter side actually needs.
//
// Contract, deliberately identical to yaad/telemetry.py in the engine repo:
//   - Nothing is exported unless OTEL_EXPORTER_OTLP_ENDPOINT is set.
//   - Telemetry can never break the request. Every path is wrapped, and a
//     failed export is swallowed.
//   - Attribute naming follows the OpenTelemetry GenAI semantic conventions
//     for model calls, so a collector that understands GenAI spans (and
//     OllyGarden's instrumentation scoring) recognises them without mapping.
//
// Secrets to set on each function:
//   OTEL_EXPORTER_OTLP_ENDPOINT   e.g. https://<your-ollygarden-ingest-host>
//   OTEL_EXPORTER_OTLP_HEADERS    e.g. api-key=xxxx   (comma separated k=v)
//   OTEL_SERVICE_NAME             optional, defaults to the value passed in code

const ENDPOINT = Deno.env.get("OTEL_EXPORTER_OTLP_ENDPOINT") ?? "";
const TRACES_ENDPOINT = Deno.env.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") ?? "";
const RAW_HEADERS = Deno.env.get("OTEL_EXPORTER_OTLP_HEADERS") ?? "";
const DEPLOY_ENV = Deno.env.get("OTEL_DEPLOYMENT_ENVIRONMENT") ?? "production";

export const tracingEnabled = Boolean(ENDPOINT || TRACES_ENDPOINT);

function tracesUrl(): string {
  if (TRACES_ENDPOINT) return TRACES_ENDPOINT;
  return ENDPOINT.replace(/\/+$/, "") + "/v1/traces";
}

function exportHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  for (const pair of RAW_HEADERS.split(",")) {
    const i = pair.indexOf("=");
    if (i > 0) h[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return h;
}

function hex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

const nowNano = (): string => String(Date.now()) + "000000";

export type AttrValue = string | number | boolean | null | undefined;

function toAttrs(obj: Record<string, AttrValue>): unknown[] {
  const out: unknown[] = [];
  for (const [key, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    let value: unknown;
    if (typeof v === "number") {
      value = Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
    } else if (typeof v === "boolean") {
      value = { boolValue: v };
    } else {
      // Bound attribute size. A stray 6k prompt should not become a span.
      value = { stringValue: String(v).slice(0, 1024) };
    }
    out.push({ key, value });
  }
  return out;
}

interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano?: string;
  attributes: unknown[];
  status?: { code: number; message?: string };
}

export const SpanKind = { INTERNAL: 1, SERVER: 2, CLIENT: 3, PRODUCER: 4, CONSUMER: 5 } as const;

export class Span {
  #rec: SpanRecord;
  constructor(rec: SpanRecord) {
    this.#rec = rec;
  }
  get spanId(): string { return this.#rec.spanId; }
  setAttributes(attrs: Record<string, AttrValue>): this {
    try { this.#rec.attributes.push(...toAttrs(attrs)); } catch (_) { /* never throw */ }
    return this;
  }
  recordError(e: unknown): this {
    try {
      this.#rec.status = { code: 2, message: String(e).slice(0, 512) };
      this.#rec.attributes.push(...toAttrs({
        "error.type": (e as { name?: string })?.name ?? "Error",
        "exception.message": String(e).slice(0, 512),
      }));
    } catch (_) { /* never throw */ }
    return this;
  }
  end(): void {
    try {
      this.#rec.endTimeUnixNano = nowNano();
      if (!this.#rec.status) this.#rec.status = { code: 1 };
    } catch (_) { /* never throw */ }
  }
}

// Parse an inbound W3C traceparent so a trace started elsewhere continues here.
function parseTraceparent(req: Request): { traceId?: string; parentSpanId?: string } {
  try {
    const tp = req.headers.get("traceparent");
    if (!tp) return {};
    const parts = tp.split("-");
    if (parts.length < 4) return {};
    const [, traceId, parentSpanId] = parts;
    if (!/^[0-9a-f]{32}$/.test(traceId) || !/^[0-9a-f]{16}$/.test(parentSpanId)) return {};
    if (traceId === "0".repeat(32)) return {};
    return { traceId, parentSpanId };
  } catch (_) { return {}; }
}

export class Trace {
  readonly traceId: string;
  readonly service: string;
  readonly spans: SpanRecord[] = [];
  #rootId?: string;
  #inboundParent?: string;

  constructor(service: string, req?: Request) {
    const inbound = req ? parseTraceparent(req) : {};
    this.traceId = inbound.traceId ?? hex(16);
    this.service = Deno.env.get("OTEL_SERVICE_NAME") ?? service;
    this.#inboundParent = inbound.parentSpanId;
  }

  startSpan(name: string, kind: number = SpanKind.INTERNAL, attrs: Record<string, AttrValue> = {}, parent?: Span): Span {
    const rec: SpanRecord = {
      traceId: this.traceId,
      spanId: hex(8),
      parentSpanId: parent?.spanId ?? this.#rootId ?? this.#inboundParent,
      name,
      kind,
      startTimeUnixNano: nowNano(),
      attributes: toAttrs(attrs),
    };
    // The first span opened becomes the implicit parent for later spans.
    if (!this.#rootId) {
      rec.parentSpanId = this.#inboundParent;
      this.#rootId = rec.spanId;
    }
    this.spans.push(rec);
    return new Span(rec);
  }

  /** Time an async step as a child span. Errors are recorded and re-thrown. */
  async span<T>(name: string, kind: number, attrs: Record<string, AttrValue>, fn: (s: Span) => Promise<T>): Promise<T> {
    const s = this.startSpan(name, kind, attrs);
    try {
      const out = await fn(s);
      return out;
    } catch (e) {
      s.recordError(e);
      throw e;
    } finally {
      s.end();
    }
  }

  #payload(): unknown {
    return {
      resourceSpans: [{
        resource: {
          attributes: toAttrs({
            "service.name": this.service,
            "service.namespace": "yaadly",
            "deployment.environment.name": DEPLOY_ENV,
            "cloud.provider": "supabase",
            "cloud.platform": "supabase_edge_functions",
          }),
        },
        scopeSpans: [{
          scope: { name: "yaadly.edge", version: "1.0.0" },
          spans: this.spans.filter((s) => s.endTimeUnixNano),
        }],
      }],
    };
  }

  /** Ship the trace. Never throws, never blocks the response. */
  flush(): void {
    if (!tracingEnabled || !this.spans.length) return;
    const send = (async () => {
      try {
        await fetch(tracesUrl(), {
          method: "POST",
          headers: exportHeaders(),
          body: JSON.stringify(this.#payload()),
          signal: AbortSignal.timeout(3000),
        });
      } catch (_) {
        // A telemetry backend being down must never surface to a client.
      }
    })();
    try {
      // Supabase's edge runtime keeps the isolate alive for waitUntil work,
      // so the export completes after the response has already been returned.
      const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
      if (rt?.waitUntil) rt.waitUntil(send);
    } catch (_) { /* fire and forget */ }
  }
}

/** Standard attributes for the span that represents the incoming request. */
export function httpAttrs(req: Request): Record<string, AttrValue> {
  try {
    const u = new URL(req.url);
    return {
      "http.request.method": req.method,
      "url.path": u.pathname,
      "server.address": u.hostname,
      "user_agent.original": req.headers.get("user-agent") ?? undefined,
    };
  } catch (_) { return { "http.request.method": req.method }; }
}
