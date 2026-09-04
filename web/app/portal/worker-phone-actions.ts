"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Linking a worker's WhatsApp number, so evidence they send there can find
 * its way to the right job. Thin on purpose, same shape as recordPayInfo:
 * link_worker_phone() in Postgres is the gate.
 *
 * CHECKED WITH TWILIO FIRST, 4 September 2026. A worker's entire surface is
 * WhatsApp: the quote pack, the Kickoff Pack confirmation, the daily check-in,
 * the prompt for evidence, the draft report they approve before a client sees
 * it. All of it goes to this one number, which they type themselves. A landline
 * or a transposed digit means none of it arrives and nothing says so; the job
 * goes quiet and the first person to notice is a client wondering why nobody
 * came.
 *
 * So yaad-phone-check runs Twilio Lookup before the number is saved, and does
 * two things with the answer. It REFUSES a number Twilio says is not real,
 * because that is a typo and the worker is right there to correct it. And it
 * saves the properly formatted E.164 rather than the bare digits
 * link_worker_phone would otherwise strip it to, which is what stops the shape
 * mismatch that made phone matching "the last nine digits" in the first place
 * (see 20260904b).
 *
 * A LANDLINE IS REPORTED, NOT REFUSED. A worker who genuinely has no mobile is
 * a business problem for Monique, not a validation error, and a form is the
 * wrong place to make that call. The number is saved and the warning is
 * returned for the page to show.
 *
 * A FAILED CHECK NEVER BLOCKS. If Twilio is unreachable or unconfigured, the
 * number is saved as typed, exactly as it was before this existed. Losing a
 * worker's number over our own outage would be worse than the problem being
 * solved.
 */

export type PhoneLinkResult = { ok: true; warning?: string } | { ok: false; error: string };

type Verdict = {
  ok: boolean; valid: boolean; e164: string;
  lineType: string; note: string; unreachable: boolean;
};

async function checkNumber(phone: string, token: string): Promise<Verdict | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  try {
    const r = await fetch(`${base}/functions/v1/yaad-phone-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ phone, country: "JM" }),
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return null;
    return await r.json() as Verdict;
  } catch {
    return null;
  }
}

export async function linkWorkerPhone(formData: FormData): Promise<PhoneLinkResult> {
  await requireUser();
  const phone = String(formData.get("phone") ?? "").trim();
  if (!phone) return { ok: false, error: "Put your WhatsApp number in first." };

  const supabase = await createClient();
  const { data: session } = await supabase.auth.getSession();
  const token = session?.session?.access_token ?? "";

  const verdict = token ? await checkNumber(phone, token) : null;

  // Only a positive "that is not a number" stops this. A check that could not
  // run, or ran and was unsure, lets the number through as typed.
  if (verdict?.ok && !verdict.valid) {
    return { ok: false, error: verdict.note };
  }

  const toSave = verdict?.ok && verdict.valid && verdict.e164 ? verdict.e164 : phone;

  const { error } = await supabase.rpc("link_worker_phone", { p_phone: toSave });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/portal/worker");

  return verdict?.ok && verdict.unreachable && verdict.valid
    ? { ok: true, warning: verdict.note }
    : { ok: true };
}
