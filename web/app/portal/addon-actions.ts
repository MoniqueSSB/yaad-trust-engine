"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { scrub } from "@/lib/scrub";
import { stripApp1 } from "@/lib/exif";

/**
 * Add-on work on a booked job (20260928235000). Every decision is made in
 * Postgres: who may write, edit, agree or turn one down, whether the version
 * in front of you is still the latest, and what gets billed. These actions
 * only collect what was typed, take contact details out of the scope (it
 * goes straight to the other side, as a quote change request does), and pass
 * it on.
 *
 * A refusal is RETURNED, never thrown: in production Next replaces the
 * message of anything a Server Action throws, and every refusal the database
 * writes here is a sentence for the person reading it.
 */

export type AddonResult = { ok: true; removed?: string[] } | { ok: false; error: string };

const TERMS = new Set(["in_full", "half_now_half_on_signoff"]);

function amountOf(raw: unknown): number | null {
  const n = Math.round(Number(String(raw ?? "").replace(/[^0-9.]/g, "")));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cleanScope(raw: unknown): { text: string; removed: string[] } {
  const text = String(raw ?? "").trim().slice(0, 1500);
  const { clean, hits } = scrub(text);
  return { text: clean, removed: hits };
}

function done(jobId: string) {
  revalidatePath("/portal/jobs/" + jobId);
}

/** The client writes it: scope, the amount they offer, and how it is paid. */
export async function proposeAddon(jobId: string, scope: string, amount: string, terms: string): Promise<AddonResult> {
  await requireUser();
  const s = cleanScope(scope);
  const a = amountOf(amount);
  if (!s.text) return { ok: false, error: "Say what the extra work is." };
  if (!a) return { ok: false, error: "Put the amount you are offering, in J$." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("propose_addon_as_me", {
    p_job: jobId, p_scope: s.text, p_amount_jmd: a, p_terms: TERMS.has(terms) ? terms : "in_full",
  });
  if (error) return { ok: false, error: error.message };
  done(jobId);
  return { ok: true, removed: s.removed };
}

/** Either side changes it on their turn. It then goes back to the other side. */
export async function editAddon(jobId: string, addonId: string, rev: number, scope: string, amount: string, terms: string): Promise<AddonResult> {
  await requireUser();
  const s = cleanScope(scope);
  const a = amountOf(amount);
  if (!s.text) return { ok: false, error: "Say what the extra work is." };
  if (!a) return { ok: false, error: "Put an amount, in J$." };
  if (!TERMS.has(terms)) return { ok: false, error: "Choose how it is paid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_addon_as_me", {
    p_addon: addonId, p_rev: rev, p_scope: s.text, p_amount_jmd: a, p_terms: terms,
  });
  if (error) return { ok: false, error: error.message };
  done(jobId);
  return { ok: true, removed: s.removed };
}

/** Accept the version in front of you. The revision number stops a stale accept. */
export async function agreeAddon(jobId: string, addonId: string, rev: number): Promise<AddonResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("agree_addon_as_me", { p_addon: addonId, p_rev: rev });
  if (error) return { ok: false, error: error.message };
  done(jobId);
  return { ok: true };
}

/** Turn it down (the side it waits on) or withdraw it (the side waiting). */
export async function declineAddon(jobId: string, addonId: string, reason: string): Promise<AddonResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_addon_as_me", {
    p_addon: addonId, p_reason: scrub(String(reason ?? "").trim().slice(0, 500)).clean || null,
  });
  if (error) return { ok: false, error: error.message };
  done(jobId);
  return { ok: true };
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const MAX_IMAGE_BYTES = 20_000_000;

/** A photograph of the add-on work, filed against that add-on only. Stored in
 *  the job's own evidence folder, fingerprinted on the bytes kept, and never
 *  counted as evidence for the job's stages. */
export async function uploadAddonEvidence(formData: FormData): Promise<AddonResult> {
  await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const addonId = String(formData.get("addonId") ?? "");
  const label = String(formData.get("label") ?? "").trim().slice(0, 300);
  const file = formData.get("photo");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) return { ok: false, error: "That job reference is not valid." };
  if (!/^[0-9a-f-]{36}$/i.test(addonId)) return { ok: false, error: "This form lost track of the add-on. Reload the page." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a photograph first." };
  const ext = EXT[file.type.toLowerCase()];
  if (!ext) return { ok: false, error: "Send a JPEG, PNG or WebP photograph." };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "That photo is too large. Keep it under about 20MB." };

  const stored = stripApp1(Buffer.from(await file.arrayBuffer()));
  const sha256 = createHash("sha256").update(stored).digest("hex");
  const path = `${jobId}/addon-${addonId}/${randomUUID()}.${ext}`;
  const supabase = await createClient();
  const { error: upErr } = await supabase.storage.from("evidence").upload(path, stored, { contentType: file.type.toLowerCase(), upsert: false });
  if (upErr) return { ok: false, error: "The photo could not be stored against this job. Check you are signed in as the client or the booked worker." };

  const { error } = await supabase.rpc("file_addon_evidence_as_me", {
    p_addon: addonId, p_path: path, p_sha256: sha256, p_label: label || null,
  });
  if (error) {
    // A file with no row is litter; the storage policy lets the uploader clear it.
    await supabase.storage.from("evidence").remove([path]);
    return { ok: false, error: error.message };
  }
  done(jobId);
  return { ok: true };
}
