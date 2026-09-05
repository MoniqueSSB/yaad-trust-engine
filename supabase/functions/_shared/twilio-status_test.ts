import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { withStatusCallback } from "./twilio-status.ts";

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
