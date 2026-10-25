import { assert, assertEquals } from "jsr:@std/assert@1";
import { LIMITS, phoneCode, phoneCodeLine, phoneDigits, PHONE_SAME_ANSWER, PHONE_WRONG_CODE, pickEmail } from "./phone-sign-in.ts";

const yes = () => true;
const no = () => false;

Deno.test("a number is read however it was typed, and a short one is refused", () => {
  assertEquals(phoneDigits("+1 876 555 0123"), "18765550123");
  assertEquals(phoneDigits("876 555 0123"), "18765550123");
  assertEquals(phoneDigits("07776 171858"), "447776171858");
  assertEquals(phoneDigits("555 0123"), null);
  assertEquals(phoneDigits(""), null);
});

Deno.test("a code is six digits and nothing else", () => {
  assertEquals(phoneCode("123 456"), "123456");
  assertEquals(phoneCode("12345"), null);
  assertEquals(phoneCode("1234567"), null);
});

Deno.test("a worker with a live profile on that exact number is found", () => {
  const r = pickEmail("18765550123", [{ email: "Devon@Example.com", phone: "+18765550123", source: "worker" }], no);
  assertEquals(r, { email: "devon@example.com", source: "worker" });
});

Deno.test("a client is found only when they already have an account", () => {
  const c = [{ email: "marcia@example.com", phone: "+447776171858", source: "client" }];
  assertEquals(pickEmail("447776171858", c, yes), { email: "marcia@example.com", source: "client" });
  assertEquals(pickEmail("447776171858", c, no), null, "a phone number never opens a new client account");
});

Deno.test("nine shared digits in another country never match", () => {
  // UK +44 7776 171858 and a made up number ending in the same nine digits.
  const c = [{ email: "a@example.com", phone: "+447776171858", source: "worker" }];
  assertEquals(pickEmail("18776171858", c, yes), null);
});

Deno.test("two accounts behind one number are refused, never guessed", () => {
  const c = [
    { email: "a@example.com", phone: "+18765550123", source: "worker" },
    { email: "b@example.com", phone: "+18765550123", source: "client" },
  ];
  assertEquals(pickEmail("18765550123", c, yes), null);
  // The same email found twice (worker and client) is one person.
  const same = [
    { email: "a@example.com", phone: "+18765550123", source: "worker" },
    { email: "A@example.com", phone: "18765550123", source: "client" },
  ];
  assertEquals(pickEmail("18765550123", same, yes), { email: "a@example.com", source: "worker" });
});

Deno.test("the answers say nothing about whether the number is ours, and carry no dashes", () => {
  for (const t of [PHONE_SAME_ANSWER, PHONE_WRONG_CODE, phoneCodeLine("123456")]) {
    assert(!/[–—]/.test(t), t);
    assert(!/not found|no account|does not exist|@/.test(t), t);
  }
  assert(/^If that number is on a Yaadly account/.test(PHONE_SAME_ANSWER));
  assertEquals(LIMITS.send.phone, 3);
  assertEquals(LIMITS.verify.phone, 5);
});
