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

// ── The MiniMax fallback, reinstated 5 September 2026 ──
//
// The three conditions in the header of textmodel.ts, each as a test, because
// the branch that was removed on the 4th for being a silent reroute is only
// acceptable back if it is neither silent nor reachable past a Mistral key.

import { pickTextProvider } from "./textmodel.ts";

// Async on purpose: the failover tests await a call that reads the env
// mid-flight, so the variables have to stay set until the promise settles,
// not just until the function returns.
async function withEnv(vars: Record<string, string | null>, fn: () => void | Promise<void>) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) saved[k] = Deno.env.get(k);
  try {
    for (const [k, v] of Object.entries(vars)) v === null ? Deno.env.delete(k) : Deno.env.set(k, v);
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  }
}

const NONE = { TEXT_MODEL_KEY: null, TEXT_MODEL_API: null, MISTRAL_API_KEY: null, MINIMAX_API_KEY: null };

Deno.test("with a Mistral key, MiniMax is never chosen, even when its key is also set", async () => {
  await withEnv({ ...NONE, MISTRAL_API_KEY: "m", MINIMAX_API_KEY: "x" }, () => {
    const p = pickTextProvider();
    assertEquals(p?.name, "mistral");
    assertEquals(p?.region, "eu");
  });
});

Deno.test("with no Mistral key and a MiniMax key, the fallback is chosen and says where it goes", async () => {
  const real = console.error;
  const lines: string[] = [];
  console.error = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try {
    await withEnv({ ...NONE, MINIMAX_API_KEY: "x" }, () => {
      const p = pickTextProvider();
      assertEquals(p?.name, "minimax");
      assertEquals(p?.region, "cn", "region travels with the call, so telemetry can answer the country question");
      assert(lines.some((l) => /MiniMax \(China\)/.test(l)), "the fallback must announce itself in the log every time");
    });
  } finally { console.error = real; }
});

Deno.test("with neither key there is still no provider, not a guess", async () => {
  await withEnv(NONE, () => {
    assertEquals(pickTextProvider(), null);
  });
});

// ── The file is produced even when Mistral is rate limited, 6 September 2026 ──

import { chatWithFailover, pickFallbackProvider } from "./textmodel.ts";

const MISTRAL = { name: "mistral", api: "https://example.invalid/mistral", key: "m", model: "mistral-small-latest", region: "eu" };

Deno.test("a desk call retries as many times as it is told, honouring Retry-After", async () => {
  let seen = 0;
  const real = globalThis.fetch;
  globalThis.fetch = ((..._a: unknown[]) => {
    seen++;
    return Promise.resolve(seen < 3
      ? new Response("busy", { status: 429, headers: { "retry-after": "0" } })
      : new Response('{"choices":[{"message":{"content":"ok"}}]}', { status: 200 }));
  }) as typeof fetch;
  try {
    const r = await fetchModel("https://example.invalid", { method: "POST" }, { timeoutMs: 5000, retryDelayMs: 1, retries: 2 });
    assertEquals(r.status, 200);
    assertEquals(seen, 3, "first call plus two retries");
  } finally { globalThis.fetch = real; }
});

Deno.test("with no MiniMax key, a Mistral rate limit is still a loud failure and never a reroute", async () => {
  let seen = 0;
  const real = globalThis.fetch;
  globalThis.fetch = ((..._a: unknown[]) => {
    seen++;
    return Promise.resolve(new Response("busy", { status: 429 }));
  }) as typeof fetch;
  try {
    await withEnv({ MINIMAX_API_KEY: null }, async () => {
      assertEquals(pickFallbackProvider(MISTRAL, "http 429"), null);
      const out = await chatWithFailover(MISTRAL, { messages: [] }, { timeoutMs: 5000, retryDelayMs: 1, retries: 1 });
      assertEquals(out.provider.name, "mistral");
      assertEquals(out.res.status, 429);
      assertEquals(seen, 2, "one retry, then it stops");
    });
  } finally { globalThis.fetch = real; }
});

Deno.test("with a MiniMax key, a Mistral rate limit that survives the retries goes to MiniMax, once, logged", async () => {
  const urls: string[] = [];
  const real = globalThis.fetch;
  const realErr = console.error;
  const lines: string[] = [];
  console.error = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  globalThis.fetch = ((url: unknown) => {
    urls.push(String(url));
    return Promise.resolve(String(url).includes("minimax")
      ? new Response('{"choices":[{"message":{"content":"from the fallback"}}]}', { status: 200 })
      : new Response("busy", { status: 429 }));
  }) as typeof fetch;
  try {
    let got: { provider: { name: string; region: string }; res: Response } | null = null;
    await withEnv({ MINIMAX_API_KEY: "x" }, async () => {
      got = await chatWithFailover(MISTRAL, { messages: [] }, { timeoutMs: 5000, retryDelayMs: 1, retries: 2 });
    });
    assertEquals(got!.provider.name, "minimax");
    assertEquals(got!.provider.region, "cn", "the span must say where it actually went");
    assertEquals(got!.res.status, 200);
    assertEquals(urls.filter((u) => u.includes("mistral")).length, 3, "Mistral was tried first, plus two retries");
    assertEquals(urls.filter((u) => u.includes("minimax")).length, 1, "then MiniMax once");
    assert(lines.some((l) => /mistral http 429 after retries, falling back to MiniMax \(China\)/.test(l)), "and it said so in the log");
  } finally { globalThis.fetch = real; console.error = realErr; }
});

Deno.test("a 401 from Mistral goes straight to MiniMax: a refused key says nothing about the other provider", async () => {
  const urls: string[] = [];
  const real = globalThis.fetch;
  const realErr = console.error;
  console.error = () => {};
  globalThis.fetch = ((url: unknown) => {
    urls.push(String(url));
    return Promise.resolve(String(url).includes("minimax")
      ? new Response('{"choices":[{"message":{"content":"ok"}}]}', { status: 200 })
      : new Response('{"detail":"Invalid API Key"}', { status: 401 }));
  }) as typeof fetch;
  try {
    let got: { provider: { name: string }; res: Response } | null = null;
    await withEnv({ MINIMAX_API_KEY: "x" }, async () => {
      got = await chatWithFailover(MISTRAL, { messages: [] }, { timeoutMs: 5000, retryDelayMs: 1, retries: 2 });
    });
    assertEquals(got!.provider.name, "minimax");
    assertEquals(got!.res.status, 200);
    assertEquals(urls.filter((u) => u.includes("mistral")).length, 1, "a 401 is not retried, it is the same answer every time");
    assertEquals(urls.filter((u) => u.includes("minimax")).length, 1);
  } finally { globalThis.fetch = real; console.error = realErr; }
});

Deno.test("a 400 from Mistral does not go to MiniMax: a bad request is bad everywhere", async () => {
  const urls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((url: unknown) => { urls.push(String(url)); return Promise.resolve(new Response("bad", { status: 400 })); }) as typeof fetch;
  try {
    await withEnv({ MINIMAX_API_KEY: "x" }, async () => {
      await chatWithFailover(MISTRAL, { messages: [] }, { timeoutMs: 5000, retryDelayMs: 1 });
    });
    assertEquals(urls.length, 1);
    assert(urls[0].includes("mistral"));
  } finally { globalThis.fetch = real; }
});

// ── Thinking is not the answer, 6 September 2026 ──

import { answerText, firstJsonObject } from "./textmodel.ts";

Deno.test("a <think> block is stripped and the JSON after it is found", () => {
  const raw = "<think>\nLet me analyse the input carefully: 4 frames, all one room.\n</think>\nHere is the result:\n{\"rooms\":[{\"name\":\"Living room\"}]}\nDone.";
  assertEquals(answerText(raw).startsWith("Here is the result"), true);
  assertEquals(firstJsonObject(raw)?.rooms, [{ name: "Living room" }]);
});

Deno.test("an answer with no object in it is null, not a throw", () => {
  assertEquals(firstJsonObject("<think>only thinking, then nothing</think>"), null);
  assertEquals(firstJsonObject("* Room: Front bedroom\n* Visible: a bed"), null);
});
