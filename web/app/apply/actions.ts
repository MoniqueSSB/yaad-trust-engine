"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function submitApplication(formData: FormData): Promise<void> {
  const g = (k: string) => String(formData.get(k) ?? "").trim().slice(0, 200);
  if (!g("name") || !g("phone") || !g("email") || !g("trade")) return;
  const supabase = await createClient();
  await supabase.from("applications").insert({
    app_id: "APP-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
    name: g("name"), phone: g("phone"), email: g("email").toLowerCase(),
    parish: g("parish"), trade: g("trade"), years: g("years"),
    work: String(formData.get("work") ?? "").trim().slice(0, 1000),
    ref1: g("ref1"), ref2: g("ref2"), status: "received",
  });
  redirect("/apply?sent=1");
}
