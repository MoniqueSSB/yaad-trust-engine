"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * The worker corrects the words or the part of the job on an item they filed.
 * Founder instruction, 28 Sep 2026: the worker must always have a way to edit
 * or make corrections.
 *
 * Thin on purpose. correct_evidence_as_me() in Postgres is the gate: only the
 * worker who filed it, only on the stage still being worked, never the file,
 * fingerprint, stage or kind, and every change logged with the wording before
 * it (20260929040000). A refusal is returned as a value, never thrown, so the
 * database's own sentence reaches the worker instead of Next's generic one.
 */
export type CorrectResult = { ok: true; changed: boolean } | { ok: false; message: string };

export async function correctEvidence(formData: FormData): Promise<CorrectResult> {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const jobId = String(formData.get("jobId") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const phase = String(formData.get("phase") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !jobId) {
    return { ok: false, message: "That item could not be found. Reload the page and try again." };
  }
  if (!label) return { ok: false, message: "Say what the item shows before saving." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("correct_evidence_as_me", {
    p_id: id,
    p_label: label,
    p_phase: phase || null,
  });
  if (error) {
    console.error("correctEvidence refused:", error.code, error.message);
    return {
      ok: false,
      message: /function .* does not exist|could not find the function/i.test(error.message)
        ? "Correcting evidence is not switched on yet. Message Yaadly with the change and it will be made for you."
        : error.message,
    };
  }
  revalidatePath(`/portal/jobs/${jobId}`);
  return { ok: true, changed: data === true };
}
