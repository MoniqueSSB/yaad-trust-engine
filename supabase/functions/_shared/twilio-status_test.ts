import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { recordAccepted, withStatusCallback } from "./twilio-status.ts";

// Unset is the state every send is in until the secret is set, so it is the
// case that must not change behaviour.
Deno.test("adds nothing when the callback URL is not configured", () => {
  Deno.env.delete("TWILIO_STATUS_CALLBACK_URL");
  const p = withStatusCallback(new URLSearchParams({ To: "whatsapp:+18765551234", Body: "hi" }));
  assertEquals(p.has("StatusCallback"), false);
  assertEquals(p.get("Body"), "hi");
});

Deno.test("adds the callback when configured, and touches nothing else", () => {
  Deno.env.set("TWILIO_STATUS_CALLBACK_URL", "https://example.test/functions/v1/yaad-message-status");
  const p = withStatusCallback(new URLSearchParams({ To: "whatsapp:+18765551234", Body: "hi" }));
  assertEquals(p.get("StatusCallback"), "https://example.test/functions/v1/yaad-message-status");
  assertEquals(p.get("To"), "whatsapp:+18765551234");
  assertEquals(p.get("Body"), "hi");
  Deno.env.delete("TWILIO_STATUS_CALLBACK_URL");
});

// An empty string is what a secret set to "" looks like, and it must read as
// unconfigured rather than as a callback URL of "".
Deno.test("an empty value counts as unconfigured", () => {
  Deno.env.set("TWILIO_STATUS_CALLBACK_URL", "");
  const p = withStatusCallback(new URLSearchParams({ To: "x" }));
  assertEquals(p.has("StatusCallback"), false);
  Deno.env.delete("TWILIO_STATUS_CALLBACK_URL");
});

// recordAccepted: what the message was, written by the sender.

function twilio201(sid: string): Response {
  return new Response(JSON.stringify({ sid, status: "queued" }), { status: 201 });
}

async function capture(fn: () => Promise<void>): Promise<{ url: string; body: Record<string, string> }[]> {
  const calls: { url: string; body: Record<string, string> }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof fetch;
  try { await fn(); } finally { globalThis.fetch = real; }
  return calls;
}

Deno.test("records the kind and the job against Twilio's own sid, through the one write function", async () => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co/");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  const calls = await capture(() =>
    recordAccepted(twilio201("SM123"), "whatsapp:+44 7700 900123", "whatsapp", { kind: "desk reply", job_id: "JOB-1" }));
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "https://example.supabase.co/rest/v1/rpc/record_message_delivery");
  assertEquals(calls[0].body, { p_sid: "SM123", p_to: "+447700900123", p_channel: "whatsapp", p_kind: "desk reply", p_job: "JOB-1", p_status: "accepted" });
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
});

Deno.test("leaves the response readable for the caller", async () => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  const res = twilio201("SM456");
  await capture(() => recordAccepted(res, "+18765550101", "whatsapp", { kind: "x" }));
  assertEquals((await res.json()).sid, "SM456");
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
});

Deno.test("records nothing for a refused send, or when not configured", async () => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  const refused = await capture(() =>
    recordAccepted(new Response(JSON.stringify({ code: 63016 }), { status: 400 }), "+1876", "whatsapp", { kind: "x" }));
  assertEquals(refused.length, 0);
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  const unset = await capture(() => recordAccepted(twilio201("SM789"), "+1876", "whatsapp", { kind: "x" }));
  assertEquals(unset.length, 0);
  Deno.env.delete("SUPABASE_URL");
});

Deno.test("a failing write never throws into the send", async () => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  const real = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch;
  try {
    await recordAccepted(twilio201("SM000"), "+18765550101", "whatsapp", { kind: "x" });
  } finally {
    globalThis.fetch = real;
    Deno.env.delete("SUPABASE_URL");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});

// The rule this file exists for, checked against the functions themselves: a
// function that sends through Twilio's Messages API says what it sent.
// Without it the desk's "Did it arrive" page shows "a message" with no job,
// which is how every live row read until 16 September 2026.
Deno.test("every function that sends a Twilio message records what it was", () => {
  const root = new URL("../", import.meta.url);
  const missing: string[] = [];
  for (const entry of Deno.readDirSync(root)) {
    if (!entry.isDirectory || !entry.name.startsWith("yaad-")) continue;
    let src = "";
    try { src = Deno.readTextFileSync(new URL(`${entry.name}/index.ts`, root)); } catch { continue; }
    if (!src.includes("/Messages.json")) continue;
    if (!src.includes("recordAccepted(") && !src.includes("rpc/record_desk_delivery")) missing.push(entry.name);
  }
  assertEquals(missing, []);
});
