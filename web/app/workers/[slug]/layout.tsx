import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * This layout exists for one reason: to answer 404 when the worker is not
 * there. It renders nothing of its own.
 *
 * Found by the post-optimisation regression audit, 3 September 2026.
 * `/workers/does-not-exist` returned HTTP 200 with the right page inside it.
 * The reader saw the correct "this profile isn't here" screen; a search engine
 * was told a profile exists for every slug anybody has ever typed.
 *
 * WHY page.tsx CANNOT FIX IT. `loading.tsx` in this folder puts a Suspense
 * boundary in front of the page, so Next flushes the shell, status line and
 * all, before the page's queries resolve. By the time `notFound()` runs the
 * 200 has already gone out. Proved rather than assumed: moving `loading.tsx`
 * aside makes the same URL answer 404, putting it back makes it 200 again.
 *
 * `generateMetadata` is not the fix either, and this was tried first. Next 16
 * streams metadata by default, so it no longer blocks the shell, and throwing
 * there changed nothing for a browser or for a Googlebot user agent. That
 * attempt is why the comment in page.tsx now says so out loud.
 *
 * A LAYOUT IS OUTSIDE THE BOUNDARY. `loading.tsx` wraps the page, and the
 * layout wraps `loading.tsx`, so the shell cannot flush until this resolves.
 * One indexed lookup on the slug is the whole cost, and the page's five
 * queries still stream behind the skeleton exactly as before. Deleting
 * `loading.tsx` would also have worked and would have been worse: a blank tab
 * on a slow connection, which is what the skeleton was added to fix.
 *
 * Reads `public_worker_profiles`, never the base table, for the same reason
 * page.tsx does: `worker_profiles` carries the worker's phone and email.
 *
 * Anyone adding a `loading.tsx` to a route that can 404 inherits this problem.
 * Check the status code, not the rendered page. RUNBOOK.md §19.
 */
export default async function WorkerProfileLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("public_worker_profiles")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();

  /* Checked on the row, not on the name: a published profile with no display
     name is still a profile and still deserves its page. */
  if (!data) notFound();

  return children;
}
