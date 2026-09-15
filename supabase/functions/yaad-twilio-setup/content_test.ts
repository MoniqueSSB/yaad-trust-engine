// A tap is a way of typing. The row ids must be exactly what a worker typing
// the letter would have sent, or the menu files nothing it says it files.
//
// Run: deno test --allow-read supabase/functions/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { sectionMenuContent } from "./content.ts";

Deno.test("the section menu's row ids are the letters the typed question accepts", () => {
  const c = sectionMenuContent();
  const items = c.types["twilio/list-picker"].items;
  assertEquals(items.map((i) => i.id), ["B", "D", "A", "P", "N", "S"]);
  // WhatsApp's own limits: ten rows, 24 characters per row title, 20 on the button.
  assert(items.length <= 10);
  for (const i of items) assert(i.item.length <= 24, i.item);
  assert(c.types["twilio/list-picker"].button.length <= 20);
  // Exactly one variable, the lead sentence, and the body uses it.
  assertEquals(Object.keys(c.variables), ["1"]);
  assert(c.types["twilio/list-picker"].body.startsWith("{{1}}"));
});
