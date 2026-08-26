"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * One public reply. Postgres enforces everything: only the subject, only
 * after publication, only once, and nothing else on the row can change.
 */
export async function replyToReview(formData: FormData): Promise<void> {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const reply = String(formData.get("reply") ?? "").trim();
  const slug = String(formData.get("slug") ?? "");
  if (!id || !reply) return;
  const supabase = await createClient();
  await supabase.from("reviews").update({ reply }).eq("id", id);
  revalidatePath("/workers/" + slug);
}
