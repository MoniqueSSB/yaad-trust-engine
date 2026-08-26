"use server";

import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export async function submitReview(input: {
  jobId: string;
  direction: "client_of_worker" | "worker_of_client";
  subjectEmail: string;
  stars: number;
  criteria: string[];
  body: string;
}): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("reviews").insert({
    job_id: input.jobId,
    direction: input.direction,
    author_email: (user.email ?? "").toLowerCase(),
    subject_email: input.subjectEmail.toLowerCase(),
    stars: Math.min(5, Math.max(1, Math.round(input.stars))),
    criteria: input.criteria.slice(0, 8),
    body: input.body.slice(0, 1200) || null,
  });
  if (error) throw new Error("refused");
}
