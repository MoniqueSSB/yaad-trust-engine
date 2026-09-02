import { PostJob } from "./PostJob";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Post a job · Yaadly",
  description:
    "Tell us what needs doing on your property in Jamaica. Free, no account needed to get a quote, and a person reads it within one working day.",
};

export default async function NewJob({
  searchParams,
}: {
  searchParams: Promise<{ trade?: string; worker?: string }>;
}) {
  /* ?trade= comes off the one tap trade tiles on the marketing site, so
     somebody who has already said "roof and zinc" is not asked again.
     ?worker= comes off "Book for a job" on the marketplace board: the
     client picked somebody, and rather than a second way to create a job,
     they land in this one flow with that name carried through to the
     enquiry. Resolved to a real active profile here so a hand-typed slug
     cannot put a name on an enquiry that nobody vetted. */
  const { trade, worker } = await searchParams;
  let requestedWorker: string | undefined;
  if (worker) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("worker_profiles")
      .select("name,trade")
      .eq("slug", worker)
      .eq("active", true)
      .maybeSingle();
    if (data?.name) requestedWorker = data.name;
  }
  return (
    <div className="mx-auto max-w-[1080px] px-5 py-10">
      {requestedWorker && (
        <div className="mb-5 flex flex-wrap items-center gap-2.5 rounded-2xl border border-gold/30 bg-gold/[0.06] px-5 py-3.5 text-[13.5px] text-mute">
          <svg viewBox="0 0 24 24" className="size-4 shrink-0 fill-none stroke-goldb stroke-2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
          </svg>
          <span>
            You are requesting <b className="font-semibold text-goldb">{requestedWorker}</b> for this job.
            Post it as normal and we will take it to them first.
          </span>
        </div>
      )}
      <PostJob initialTrade={trade} requestedWorker={requestedWorker} />
    </div>
  );
}
