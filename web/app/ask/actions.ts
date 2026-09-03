"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { checkQuestion, type AskState } from "@/lib/ask";

/**
 * Anyone may ask. The row lands unpublished; a person reads it first.
 *
 * THE WRITE PATH IS ask_question(), NOT AN INSERT, and that is settled. It is
 * SECURITY DEFINER, it carries the length floor, both caps, the throttle and
 * `published = false`, and `questions` deliberately has no INSERT policy for
 * anon, so this function is the only door. `20260903j` spells out why, after
 * two earlier attempts got the ordering wrong. Do not put a direct insert
 * back: with one, anybody holding the publishable key can POST straight to
 * `/rest/v1/questions` and skip the counter entirely.
 *
 * WHAT THIS FILE ADDS ON TOP OF THAT, and why it stopped redirecting. It used
 * to redirect to `/ask?sent=...` and let the page read the flag. That works,
 * and it loses everything typed on the way: a refused question came back to an
 * empty box, and a stale link or a refresh drew the same message again for a
 * question nobody had asked. It now returns a result the form renders in
 * place, so the text survives a refusal and the receipt dies with the page.
 * The outcomes are the same four ask_question() already had.
 *
 * What reaches the database is as narrow as it ever was: body, area, published
 * false. No name, no email, no phone. A public Q&A board does not need to know
 * who is asking, so it does not ask.
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

export async function askQuestion(_prev: AskState, formData: FormData): Promise<AskState> {
  const body = String(formData.get("body") ?? "");
  const area = String(formData.get("area") ?? "");

  /* A cheap first pass, so an obviously wrong form does not make a round trip,
     and the only place the contact-details rule is applied. Postgres checks
     the length again and Postgres is the one that counts. */
  const problem = checkQuestion(body, area);
  if (problem) {
    return { status: "error", message: problem.message, field: problem.field, body, area, at: Date.now() };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ask_question", {
    p_body: body.trim(),
    p_area: area.trim() || null,
    p_caller_key: await callerKey(),
  });

  const refused = (message: string): AskState => ({
    status: "error",
    message,
    field: "body",
    body,
    area,
    at: Date.now(),
  });

  if (error) {
    // Deliberately not the raw Postgres message. It tells a visitor nothing
    // and an attacker something. The console line is for whoever is reading
    // the Worker logs when this happens.
    console.error("ask: ask_question failed", error.code, error.message);
    return refused(
      "That did not save, and it is our end rather than yours. Your question is still in the box, so try once more. If it keeps failing, use the chat tab on the right.",
    );
  }

  /* "throttled" is not an apology and not an error. Somebody who has asked ten
     questions in an hour is enthusiastic, not hostile, so the message says
     what happened and when they can go again, and keeps their text. */
  if (data === "throttled") {
    return refused(
      "That is ten questions in an hour, which is where we stop and read. Nothing is lost, and you can ask again shortly.",
    );
  }

  if (data === "too_short") {
    return refused("A little more please, at least ten characters, so a tradesperson has something to answer.");
  }

  return { status: "sent", body: "", area: "", sentBody: body.trim(), at: Date.now() };
}
