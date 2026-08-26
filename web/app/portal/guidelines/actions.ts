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
  revalidatePath("/portal/guidelines");
}
