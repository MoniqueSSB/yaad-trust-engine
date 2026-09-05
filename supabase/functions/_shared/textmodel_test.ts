import { assert, assertEquals } from "jsr:@std/assert@1";
import { fetchModel, retryAfterMs } from "./textmodel.ts";


Deno.test("a 429 is retried once, which is the whole point", async () => {
  let seen = 0;
  const real = globalThis.fetch;
  globalThis.fetch = ((..._a: unknown[]) => {
    seen++;
    return Promise.resolve(seen === 1
      ? new Response("rate limited", { status: 429 })
      : new Response('{"ok":true}', { status: 200 }));
  }) as typeof fetch;
  try {
    const r = await fetchModel("https://example.invalid", { method: "POST" }, { timeoutMs: 5000, retryDelayMs: 1 });
    assertEquals(r.status, 200);
    assertEquals(seen, 2, "expected exactly one retry");
  } finally { globalThis.fetch = real; }
});

Deno.test("a 5xx is retried, because the request never reached a decision", async () => {
  let seen = 0;
  const real = globalThis.fetch;
  globalThis.fetch = ((..._a: unknown[]) => {
    seen++;
    return Promise.resolve(seen === 1
      ? new Response("upstream", { status: 503 })
      : new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    await fetchModel("https://example.invalid", {}, { timeoutMs: 5000, retryDelayMs: 1 });
    assertEquals(seen, 2);
  } finally { globalThis.fetch = real; }
});

Deno.test("a 400 is NOT retried: a wrong model id does not pass with patience", async () => {
  let seen = 0;
  const real = globalThis.fetch;
  globalThis.fetch = ((..._a: unknown[]) => {
    seen++;
    return Promise.resolve(new Response('{"message":"Invalid model"}', { status: 400 }));
  }) as typeof fetch;
  try {
    const r = await fetchModel("https://example.invalid", {}, { timeoutMs: 5000, retryDelayMs: 1 });
    assertEquals(r.status, 400);
    assertEquals(seen, 1, "retrying a 400 just doubles the wait before the fallback");
  } finally { globalThis.fetch = real; }
});

Deno.test("a 200 is returned untouched and its body is still readable", async () => {
  let seen = 0;
  const real = globalThis.fetch;
  globalThis.fetch = ((..._a: unknown[]) => {
    seen++;
    return Promise.resolve(new Response('{"choices":[]}', { status: 200 }));
  }) as typeof fetch;
  try {
    const r = await fetchModel("https://example.invalid", {}, { timeoutMs: 5000, retryDelayMs: 1 });
    assertEquals(seen, 1);
    // The retry path reads and discards a failed body; a good one must not be.
    assertEquals(await r.text(), '{"choices":[]}');
  } finally { globalThis.fetch = real; }
});

// ── Retry-After, added 5 September 2026 ──
//
// The retry used to wait a fixed 1200ms and never read the header. The Mistral
// 429s on 4 September were watched doing exactly that: fire, wait, fail again.

Deno.test("Retry-After in seconds is honoured instead of the fixed delay", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  const seen: number[] = [];
  const started = Date.now();
  globalThis.fetch = ((): Promise<Response> => {
    calls++;
    seen.push(Date.now() - started);
    return Promise.resolve(
      calls === 1
        ? new Response("slow down", { status: 429, headers: { "retry-after": "1" } })
        : new Response("ok", { status: 200 }),
    );
  }) as typeof fetch;
  try {
    const r = await fetchModel("https://example.invalid", {}, { timeoutMs: 5000, retryDelayMs: 1 });
    assertEquals(r.status, 200);
    assertEquals(calls, 2);
    // It waited about a second, not the 1ms it was told to fall back to.
    assert(seen[1] >= 900, `second call came after ${seen[1]}ms, expected roughly 1000`);
  } finally {
    globalThis.fetch = real;
  }
});

Deno.test("a Retry-After longer than the budget means DO NOT RETRY", async () => {
  // The important one. A 60 second wait cannot be served inside a Twilio
  // webhook, so burning the budget to reach the same 429 is strictly worse
  // than failing now and leaving time to send the person a real reply.
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = ((): Promise<Response> => {
    calls++;
    return Promise.resolve(new Response("slow down", { status: 429, headers: { "retry-after": "60" } }));
  }) as typeof fetch;
  try {
    const r = await fetchModel("https://example.invalid", {}, { timeoutMs: 5000, retryDelayMs: 1 });
    assertEquals(r.status, 429);
    assertEquals(calls, 1, "it should not have tried a second time");
  } finally {
    globalThis.fetch = real;
  }
});

Deno.test("no Retry-After still retries once, exactly as before", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = ((): Promise<Response> => {
    calls++;
    return Promise.resolve(calls === 1 ? new Response("", { status: 429 }) : new Response("ok", { status: 200 }));
  }) as typeof fetch;
  try {
    const r = await fetchModel("https://example.invalid", {}, { timeoutMs: 5000, retryDelayMs: 1 });
    assertEquals(r.status, 200);
    assertEquals(calls, 2);
  } finally {
    globalThis.fetch = real;
  }
});

Deno.test("a nonsense or backwards Retry-After is treated as absent", () => {
  assertEquals(retryAfterMs(null), null);
  assertEquals(retryAfterMs(""), null);
  assertEquals(retryAfterMs("soon"), null);
  assertEquals(retryAfterMs("0"), null);
  // An HTTP date already in the past is not an instruction to hammer it again.
  assertEquals(retryAfterMs("Wed, 01 Jan 2020 00:00:00 GMT"), null);
  assertEquals(retryAfterMs("2"), 2000);
});
