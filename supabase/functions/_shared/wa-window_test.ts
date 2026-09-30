// The 24 hour window, read before sending, the same way in every function.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { approvedTemplateSid, insideWindow, lastInboundInWindow, samePhoneDigits, WINDOW_MS } from "./wa-window.ts";

function fakeAdmin(rows: { from_addr: string; seen_at: string }[] | null, error: unknown = null, setting: string | null = null) {
  const q = {
    select: () => q, eq: () => q, gte: () => q, order: () => q,
    limit: () => Promise.resolve({ data: rows, error }),
    maybeSingle: () => Promise.resolve({ data: setting === null ? null : { value: setting }, error: null }),
  };
  return { from: () => q };
}

Deno.test("the window has a margin and no record reads as outside", () => {
  const now = Date.parse("2026-09-30T12:00:00Z");
  assert(insideWindow(new Date(now - 3600_000).toISOString(), now));
  assert(!insideWindow(new Date(now - WINDOW_MS - 1).toISOString(), now));
  assert(!insideWindow(null, now));
  assert(samePhoneDigits("whatsapp:+18765550199", "18765550199"));
});

Deno.test("the window is read off the person's own last message", async () => {
  const now = Date.parse("2026-09-30T12:00:00Z");
  const recent = new Date(now - 3600_000).toISOString();
  assertEquals(await lastInboundInWindow(fakeAdmin([{ from_addr: "+18765550199", seen_at: recent }]), "18765550199", now), true);
  assertEquals(await lastInboundInWindow(fakeAdmin([{ from_addr: "+18765550100", seen_at: recent }]), "18765550199", now), false);
  assertEquals(await lastInboundInWindow(fakeAdmin([]), "18765550199", now), false);
});

Deno.test("a read that fails is unknown, not outside", async () => {
  assertEquals(await lastInboundInWindow(fakeAdmin(null, { message: "boom" }), "18765550199"), null);
});

Deno.test("only an approved template id is ever returned", async () => {
  Deno.env.delete("TEST_SID_ENV");
  assertEquals(await approvedTemplateSid(fakeAdmin([], null, JSON.stringify("HX" + "a".repeat(32))), "TEST_SID_ENV", "k"), "HX" + "a".repeat(32));
  assertEquals(await approvedTemplateSid(fakeAdmin([], null, "pending"), "TEST_SID_ENV", "k"), "");
  assertEquals(await approvedTemplateSid(fakeAdmin([], null, null), "TEST_SID_ENV", "k"), "");
});
