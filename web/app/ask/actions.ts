"use server";

import { createClient } from "@/lib/supabase/server";
import { checkQuestion, tidyQuestion, type AskState } from "@/lib/ask";

/**
 * Anyone may ask. The row lands unpublished; a person reads it first.
 *
 * WHY THIS RETURNS A RESULT INSTEAD OF REDIRECTING, which is the whole point
 * of the rewrite. It used to insert, ignore whatever came back, and redirect
 * to /ask?sent=1, which drew "Received" no matter what had happened. Nothing
 * had happened: the table's only write policy was the admin one, so every
 * question a visitor had ever typed was refused by Postgres with 42501 and
 * the page thanked them for it. The insert is unchanged. What changed is that
 * the answer from the database is now read, and a failure is shown to the
 * person who is standing there rather than swallowed.
 *
 * The insert stays exactly as narrow as it was: body, area, published false.
 * No name, no email, no phone, no IP. A public Q&A board does not need to
 * know who is asking, so it does not ask.
 */

export async function askQuestion(_prev: AskState, formData: FormData): Promise<AskState> {
  const body = String(formData.get("body") ?? "");
  const area = String(formData.get("area") ?? "");

  const problem = checkQuestion(body, area);
  if (problem) {
    return { status: "error", message: problem.message, field: problem.field, body, area, at: Date.now() };
  }

  const tidy = tidyQuestion(body, area);
  const supabase = await createClient();
  const { error } = await supabase
    .from("questions")
    .insert({ body: tidy.body, area: tidy.area, published: false });

  if (error) {
    // Deliberately not the raw Postgres message. It would say "new row
    // violates row-level security policy", which tells a visitor nothing and
    // tells an attacker something. The console line is for whoever is
    // reading the Worker logs when this happens.
    console.error("ask: question insert refused", error.code, error.message);
    return {
      status: "error",
      message:
        "We could not save that just now. Your question is still in the box, so try once more. If it keeps failing, use the Ask Yaadly chat on the right.",
      field: "body",
      body,
      area,
      at: Date.now(),
    };
  }

  return { status: "sent", body: "", area: "", sentBody: tidy.body, at: Date.now() };
}
