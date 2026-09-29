"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { scrub } from "@/lib/scrub";
import { screenOwnWords } from "@/lib/own-words";

/**
 * Sending a report draft from its edit page.
 *
 * Thin on purpose, the same shape as the Completion Report actions: the rules
 * live in Postgres (send_report_draft_by_code, 20260929200000), so a bug here
 * is a refusal and never a report nobody sent. No login: the code in the
 * WhatsApp link is the key, checked in Postgres, where ten wrong codes lock
 * the link. The database's own words come back when it refuses.
 */

export type DraftActionState = { ok?: boolean; error?: string; changed?: boolean };

export async function sendReportDraft(_prev: DraftActionState, formData: FormData): Promise<DraftActionState> {
  const jobId = String(formData.get("jobId") ?? "");
  // Scrubbed of contact details, the same as every other text that travels
  // between a worker and a client.
  const text = scrub(String(formData.get("text") ?? "").trim().slice(0, 2000)).clean;
  // Screened against the same banned list as everything a model writes. The
  // draft itself has already passed it, so this only ever stops words he added.
  const screened = screenOwnWords(text);
  if (!screened.ok) return { error: screened.message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("send_report_draft_by_code", {
    p_job: jobId, p_code: String(formData.get("code") ?? ""), p_text: text,
  });
  if (error) return { error: error.message };
  const r = (data ?? {}) as DraftActionState;
  if (r.error) return { error: r.error };
  revalidatePath("/draft/" + jobId);
  return { ok: true, changed: Boolean(r.changed) };
}
