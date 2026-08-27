"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import legal from "@/lib/legal-copy.json";

export async function signGuidelines(formData: FormData): Promise<void> {
  const user = await requireUser();
  const docType = String(formData.get("docType") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!["client_guidelines", "worker_guidelines"].includes(docType) || name.length < 3)
    throw new Error("missing");
  const version = docType === "client_guidelines" ? legal.CG_VERSION : legal.WG_VERSION;
  const consent =
    `I confirm I have read the Yaadly ${docType === "client_guidelines" ? "Client" : "Worker"} Guidelines version ${version} in full, and I agree to ${docType === "client_guidelines" ? "do business on Yaadly this way" : "work to them on every Yaadly job"}.`;
  const supabase = await createClient();
  const { error } = await supabase.from("doc_signatures").insert({
    signer_user: user.id,
    signer_email: (user.email ?? "").toLowerCase(),
    signer_name: name.slice(0, 120),
    doc_type: docType,
    doc_version: version,
    consent_text: consent,
  });
  if (error) throw new Error("refused");

  // Signing is the last thing standing between a job and a worker, so finish
  // the job here rather than leaving it to a screen the client may never open.
  //
  // client_go_live() creates the client_profiles row and opens the jobs that
  // were waiting only on this. Both facts are required by
  // enforce_signed_before_open, and until this existed nothing anywhere wrote
  // the profile, so the gate could never pass and every job taken on WhatsApp
  // stopped dead at that line.
  //
  // The checks live inside the function, not here: confirmed mailbox,
  // authenticated session, current signature. A rule about somebody else's
  // money should not be enforceable only by whichever caller remembered it.
  if (docType === "client_guidelines") {
    const { error: liveError } = await supabase.rpc("client_go_live");
    // Deliberately not fatal. The signature is recorded and is the thing that
    // matters legally; if opening the jobs fails the client is told what they
    // signed, and the desk still has the job. Losing the signature because a
    // follow-up step failed would be the worse trade.
    if (liveError) console.error("client_go_live", liveError.message);
  }

  revalidatePath("/portal/guidelines");
  revalidatePath("/portal");
}
