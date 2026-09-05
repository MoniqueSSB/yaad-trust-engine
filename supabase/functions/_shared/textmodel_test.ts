import { assertEquals } from "jsr:@std/assert@1";
import { fetchModel } from "./textmodel.ts";


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
