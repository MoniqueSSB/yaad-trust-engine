"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Anyone may ask. The row lands unpublished; a person reads it first. */
export async function askQuestion(formData: FormData): Promise<void> {
  const body = String(formData.get("body") ?? "").trim();
  const area = String(formData.get("area") ?? "").trim() || null;
  if (body.length < 10) return;
  const supabase = await createClient();
  await supabase.from("questions").insert({ body: body.slice(0, 500), area, published: false });
  redirect("/ask?sent=1");
}
