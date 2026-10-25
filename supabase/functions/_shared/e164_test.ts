import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { e164, e164Digits } from "./e164.ts";

Deno.test("a UK mobile written nationally gets 44 and loses its 0", () => {
  assertEquals(e164Digits("07776171858"), "447776171858");
  assertEquals(e164Digits("07776 171 858"), "447776171858");
  assertEquals(e164("07776171858"), "+447776171858");
});

Deno.test("a UK mobile typed without the 0 gets 44", () => {
  assertEquals(e164Digits("7776171858"), "447776171858");
});

Deno.test("a Jamaican number without its country code gets 1", () => {
  assertEquals(e164Digits("876 555 1234"), "18765551234");
  assertEquals(e164Digits("(658) 555-1234"), "16585551234");
});

Deno.test("a number that already carries a country code is left alone", () => {
  assertEquals(e164Digits("+447776171858"), "447776171858");
  assertEquals(e164Digits("whatsapp:+18765551234"), "18765551234");
  assertEquals(e164Digits("+1 876 555 1234"), "18765551234");
  assertEquals(e164Digits("12125551234"), "12125551234");
});

Deno.test("the 00 international prefix is dropped", () => {
  assertEquals(e164Digits("00447776171858"), "447776171858");
  assertEquals(e164Digits("0018765551234"), "18765551234");
});

Deno.test("nothing is guessed from a short or empty number", () => {
  assertEquals(e164Digits(""), "");
  assertEquals(e164Digits(null), "");
  assertEquals(e164Digits("5551234"), "5551234");
  assertEquals(e164(""), "");
});
