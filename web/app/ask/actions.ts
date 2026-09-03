"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Anyone may ask. The row lands unpublished; a person reads it first.
 *
 * The validation and the throttle now live in Postgres, in ask_question()
 * (20260903d), not here. That is not ceremony: this was the only unthrottled
 * public write in the application, every other one already has a counter
 * behind it, and a limit enforced in a page file is a limit a second caller
 * can skip. The "anyone may ask" INSERT policy is dropped once this is
 * deployed, so this function is the only door.
 *
 * `area` used to be unbounded. It was capped by a maxLength attribute on the
 * input and nowhere else, and an HTML attribute is not a control. Postgres
 * slices it now, along with the body.
 */

/**
 * A throttle key, not a visitor log.
 *
 * Cloudflare gives the real client address in CF-Connecting-IP; the
 * x-forwarded-for fallback is for local development, where neither exists and
 * the key is simply empty. It is hashed and truncated before it leaves this
 * function, so what reaches the database cannot be read back as an address,
 * nothing joins to it, and the rows are swept within hours. Same shape and
 * same reasoning as post_job_attempts and enquiry_attempts.
 */
async function callerKey(): Promise<string> {
  try {
    const h = await headers();
    const ip =
      h.get("cf-connecting-ip") ??
      (h.get("x-forwarded-for") ?? "").split(",")[0].trim();
    if (!ip) return "";
    return createHash("sha256").update(ip).digest("hex").slice(0, 32);
  } catch {
    // No request headers available. A missing key means the throttle does not
    // apply rather than that the ask is refused: failing to rate limit is a
    // worse outcome than failing to accept a genuine question, but only just,
    // and refusing everybody because a header is absent is the worse of the two.
    return "";
  }
}

export async function askQuestion(formData: FormData): Promise<void> {
  const body = String(formData.get("body") ?? "").trim();
  const area = String(formData.get("area") ?? "").trim() || null;

  // Kept as a cheap first pass so an obviously empty form does not make a
  // round trip. Postgres checks it again, and Postgres is the one that counts.
  if (body.length < 10) redirect("/ask?sent=short");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ask_question", {
    p_body: body,
    p_area: area,
    p_caller_key: await callerKey(),
  });

  if (error) redirect("/ask?sent=error");
  if (data === "throttled") redirect("/ask?sent=throttled");
  if (data === "too_short") redirect("/ask?sent=short");
  redirect("/ask?sent=1");
}
