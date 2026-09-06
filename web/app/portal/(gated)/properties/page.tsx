import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { whenDate } from "@/lib/date";
import {
  groupIntoProperties,
  portfolioSummary,
  type PropertyJob,
} from "@/lib/portal/properties";

// Never cached. A portfolio showing a stale job is worse than a slow one.
export const dynamic = "force-dynamic";

export const metadata = { title: "Your properties · Yaadly" };

/**
 * The portfolio view, for a client with more than one property.
 *
 * Roadmap item 11 of the agent audit. The audit's own framing: every agent
 * works one job at a time, so a landlord with four properties gets four
 * separate threads and no way to see the whole thing.
 *
 * The founder chose the live page over a monthly PDF, and chose it FIRST
 * rather than instead: the PDF renders from this same grouping later, once
 * this page has shown what a portfolio client actually asks for. Building the
 * document first would have meant guessing at that.
 *
 * ── The honest bit, which is most of the value today ──
 *
 * There is no properties table. A property is whatever somebody typed into
 * jobs.addr, and on 4 September 2026 only 5 of 40 jobs had one. So this page
 * groups what exists and is plain about what does not, rather than showing an
 * empty portfolio to somebody who owns four houses.
 *
 * A row reading "Address not given, Portmore, 3 jobs" is not an error state.
 * It is the page showing the person who can fix it the one thing that would
 * turn this into a real portfolio, without telling them off for it. The data
 * gets better because the page exists.
 *
 * No .eq() on email anywhere. Row level security already limits these rows to
 * jobs where the signed-in address is a party, and a filter in this file would
 * be a second place for that rule to be wrong.
 */
export default async function PropertiesPage() {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("id,title,trade,parish,addr,stage,status,open,updated_at,client_email")
    .order("updated_at", { ascending: false });

  const email = (user.email ?? "").toLowerCase();
  const mine = ((data ?? []) as (PropertyJob & { client_email: string | null })[]).filter(
    (j) => j.client_email?.toLowerCase() === email,
  );

  const properties = groupIntoProperties(mine);
  const sum = portfolioSummary(properties);
  const unnamed = properties.filter((p) => p.unidentified).length;

  return (
    <main className="mx-auto w-full max-w-[900px] px-5 py-8">
      <h1 className="font-display text-[26px] font-normal tracking-[-0.01em]">Your properties</h1>
      <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-dim">
        Every property Yaadly has worked on for you, and where each one stands
        right now. This is the whole picture in one place, rather than one job
        at a time.
      </p>

      {error && (
        <p className="mt-4 rounded-xl border border-coral/40 bg-coral/5 p-4 text-[13px] text-coral">
          Your properties could not be loaded just now. Reload the page, and if
          it happens again message Yaadly.
        </p>
      )}

      {properties.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-line2 bg-bg/30 px-5 py-8 text-center">
          <b className="mb-1 block text-[14px] font-semibold text-ink">Nothing here yet</b>
          <p className="mx-auto max-w-[46ch] text-[12.5px] leading-relaxed text-dim">
            Your properties appear here once Yaadly has a job on one.{" "}
            <Link href="/jobs/new" className="text-tealb underline underline-offset-2">
              Post a job
            </Link>{" "}
            to start.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-dim">
            <span>
              <b className="text-mute">{sum.properties}</b> propert{sum.properties === 1 ? "y" : "ies"}
            </span>
            <span>
              <b className="text-mute">{sum.openJobs}</b> job{sum.openJobs === 1 ? "" : "s"} under way
            </span>
            <span>
              <b className="text-mute">{sum.jobs}</b> in total, all time
            </span>
          </div>

          {/* Said once, at the top, rather than repeated as a warning on every
              unnamed row. A client who has not given addresses is not doing
              anything wrong; they just have not been asked until now. */}
          {unnamed > 0 && (
            <p className="mt-4 rounded-xl border border-mango/30 bg-mango/[.06] p-4 text-[12.5px] leading-relaxed text-mute">
              <b className="text-ink">
                {unnamed === 1 ? "One group below has no address." : `${unnamed} groups below have no address.`}
              </b>{" "}
              Jobs without one are grouped by parish, so two different buildings
              in the same parish will look like one here. Adding the address to
              a job separates them, and it is what will let Yaadly send you a
              proper report per property later. Message Yaadly with the address
              and the job reference, and it will be put on.
            </p>
          )}

          <ul className="mt-5 grid gap-3">
            {properties.map((p) => (
              <li
                key={p.key}
                className={
                  "rounded-2xl border p-5 " +
                  (p.openJobs > 0 ? "border-mango/40 bg-mango/[.05]" : "border-line bg-panel")
                }
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <b className={"text-[15px] " + (p.unidentified ? "text-mute italic" : "text-ink")}>
                    {p.label}
                  </b>
                  {!p.unidentified && p.parish && (
                    <span className="text-[12.5px] text-dim">{p.parish}</span>
                  )}
                  <span className="ml-auto text-[11.5px] text-dim">
                    {p.openJobs > 0
                      ? `${p.openJobs} under way`
                      : `${p.jobs.length} job${p.jobs.length === 1 ? "" : "s"}, all closed`}
                  </span>
                </div>

                <ul className="mt-3 grid gap-2">
                  {p.jobs.map((j) => (
                    <li key={j.id}>
                      <Link
                        href={`/portal/jobs/${j.id}`}
                        className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-xl border border-line bg-bg/40 px-3.5 py-2.5 transition hover:border-line2"
                      >
                        <span className="font-mono-app text-[11.5px] text-dim">{j.id}</span>
                        <span className="text-[13px] text-ink">{j.title || "Untitled job"}</span>
                        {j.trade && <span className="text-[12px] text-dim">{j.trade}</span>}
                        <span className="ml-auto text-[11.5px] text-dim">
                          {whenDate(j.updated_at) ?? ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-7 text-[12.5px] text-dim">
        <Link href="/portal/client" className="text-tealb underline underline-offset-2">
          Back to your portal
        </Link>
      </p>
    </main>
  );
}
