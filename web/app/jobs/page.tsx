import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The public marketplace at app.yaadly.co.uk/jobs, laid out to mirror the
 * old #market pane on the landing page, whose copy is decided and carried
 * over verbatim. Reads the redacted open_jobs view and the public
 * worker_profiles rows (anon SELECT where active, by design). Acting is
 * behind /portal.
 */

type OpenJob = {
  id: string;
  title: string | null;
  trade: string | null;
  parish: string | null;
  descr: string | null;
  client_signed: boolean | null;
  client_jobs_completed: number | null;
};

type Worker = {
  name: string | null;
  trade: string | null;
  parish: string | null;
  lane: string | null;
  jobs_completed: number | null;
};

export const metadata = {
  title: "The marketplace · Yaadly",
  description:
    "Open property jobs across Jamaica and the verified workers who do them. Money held until the work is proven.",
};

const SITE = "https://yaadly.co.uk";

export default async function Board({
  searchParams,
}: {
  searchParams: Promise<{ trade?: string }>;
}) {
  const { trade } = await searchParams;
  const supabase = await createClient();

  let jq = supabase
    .from("open_jobs")
    .select("id,title,trade,parish,descr,client_signed,client_jobs_completed")
    .order("updated_at", { ascending: false });
  if (trade) jq = jq.eq("trade", trade);

  const [{ data: jobsData }, { data: workersData }, { data: tradeRows }] =
    await Promise.all([
      jq,
      supabase
        .from("worker_profiles")
        .select("name,trade,parish,lane,jobs_completed")
        .eq("active", true)
        .order("jobs_completed", { ascending: false }),
      supabase.from("open_jobs").select("trade"),
    ]);

  const jobs = (jobsData ?? []) as OpenJob[];
  const workers = (workersData ?? []) as Worker[];
  const trades = [
    ...new Set((tradeRows ?? []).map((t) => t.trade).filter(Boolean)),
  ] as string[];

  return (
    <div className="mx-auto max-w-[1080px] px-5 py-10">
      <h1 className="font-display text-[clamp(34px,6vw,64px)] uppercase leading-[0.97]">
        The{" "}
        <span className="bg-linear-to-r from-tealb to-teal bg-clip-text text-transparent">
          marketplace.
        </span>
      </h1>
      <p className="mt-4 max-w-[68ch] text-[15.5px] leading-relaxed text-mute">
        Open to everyone to look at: the jobs waiting for quotes, and the
        verified workers who do them.{" "}
        <b className="text-ink">Taking part is signed-on only.</b> Workers sign
        in to quote. You become a client by creating your profile and signing
        the Client Guidelines, then you can pitch jobs, and your completed jobs
        build your own record, the same way a worker&apos;s do.
      </p>

      <div className="mt-4.5 flex flex-wrap gap-2.5">
        <Link href="/portal/sign-in" className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-3 text-[14px] font-bold text-[#04211D] transition hover:brightness-110">
          Become a client &rarr;
        </Link>
        <a href={`${SITE}/#worker`} className="rounded-full border border-line2 px-5 py-3 text-[14px] font-bold text-ink transition hover:border-teal hover:text-tealb">
          Apply as a worker
        </a>
        <Link href="/portal/sign-in" className="rounded-full border border-line2 px-5 py-3 text-[14px] font-bold text-ink transition hover:border-teal hover:text-tealb">
          Client sign in
        </Link>
        <Link href="/portal/sign-in" className="rounded-full border border-line2 px-5 py-3 text-[14px] font-bold text-ink transition hover:border-teal hover:text-tealb">
          Worker sign in
        </Link>
      </div>

      <div className="mt-4.5 rounded-xl border border-softline bg-soft px-4 py-3 text-[13.5px] leading-relaxed text-[#BDE8DE]">
        ⚖️ <b className="text-ink">How the door works:</b> anyone can look. To
        quote you must be a verified, signed-in worker who has signed the
        Worker Guidelines. To pitch a job you must have created your profile
        and signed the Client Guidelines. Both sides sign the same kind of
        promise, both sides build a scored record, and nobody carries the risk
        alone.
      </div>

      <h2 className="mt-9 text-[11px] font-bold uppercase tracking-[.18em] text-tealb">
        Jobs open for quotes
      </h2>

      {trades.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/jobs" className={"rounded-full border px-3.5 py-1.5 text-[12.5px] font-bold transition " + (!trade ? "border-teal bg-soft text-tealb" : "border-line text-mute hover:border-teal hover:text-tealb")}>
            All trades
          </Link>
          {trades.map((t) => (
            <Link key={t} href={`/jobs?trade=${encodeURIComponent(t)}`} className={"rounded-full border px-3.5 py-1.5 text-[12.5px] font-bold transition " + (trade === t ? "border-teal bg-soft text-tealb" : "border-line text-mute hover:border-teal hover:text-tealb")}>
              {t}
            </Link>
          ))}
        </div>
      )}

      {jobs.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-line bg-panel p-5 text-[13.5px] leading-relaxed text-mute">
          No jobs are open for quotes right now. Pitched jobs land here the
          moment Yaadly opens them, so pitch yours and it can be next.
        </p>
      ) : (
        <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
          {jobs.map((j) => (
            <div key={j.id} className="rounded-2xl border border-line bg-panel p-5">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <h3 className="text-[16px] font-bold leading-snug">
                  {j.title ?? "Job"}
                </h3>
                <span className="rounded-full border border-softline bg-soft px-2.5 py-1 text-[10.5px] font-extrabold tracking-wide text-tealb">
                  OPEN
                </span>
              </div>
              <p className="mt-1 text-[12px] text-dim">
                {j.parish ?? ""} · {j.id} ·{" "}
                {j.client_signed
                  ? `client signed on · ${j.client_jobs_completed ?? 0} completed ${(j.client_jobs_completed ?? 0) === 1 ? "job" : "jobs"}`
                  : "client record pending"}
              </p>
              {j.descr && (
                <p className="mt-2 text-[13px] leading-relaxed text-mute">
                  {j.descr.slice(0, 180)}
                  {j.descr.length > 180 ? "..." : ""}
                </p>
              )}
              <Link href="/portal/sign-in" className="mt-3 inline-block rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-[#04211D] transition hover:brightness-110">
                Sign in as a worker to quote &rarr;
              </Link>
            </div>
          ))}
        </div>
      )}

      <h2 className="mt-9 text-[11px] font-bold uppercase tracking-[.18em] text-tealb">
        The worker network
      </h2>

      {workers.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-line bg-panel p-5 text-[13.5px] leading-relaxed text-mute">
          The worker network is being built parish by parish, and nobody is
          listed before verification is complete: government photo ID on a
          video call, references called, and a trial job. Profiles appear here
          as workers pass.
        </p>
      ) : (
        <>
          <p className="mt-4 text-[12.5px] leading-relaxed text-dim">
            Every person here passed Yaadly verification before their first
            job: government photo ID seen on a video call, references called,
            past work reviewed, and a trial job. The{" "}
            <b className="text-mute">Yaad Score record</b> is verified jobs
            completed on Yaadly: evidence-documented, client-approved, never
            self-reported.
          </p>
          <div className="mt-2.5 grid gap-2.5">
            {workers.map((w, i) => (
              <div key={i} className="flex flex-wrap items-center gap-3.5 rounded-xl border border-line bg-panel2 px-4 py-3">
                <span className="grid size-11 flex-none place-items-center rounded-full bg-linear-to-br from-coral to-[#E0525E] text-[16px] font-extrabold text-white">
                  {(w.name ?? "W")[0].toUpperCase()}
                </span>
                <span className="min-w-0">
                  <b className="block text-[15px]">{w.name}</b>
                  <small className="block text-[12.5px] text-mute">
                    {w.trade ?? "General trades"}
                    {w.parish ? " · " + w.parish : ""}
                  </small>
                  <small className="block text-[12.5px] text-tealb">
                    Yaad Score record: {w.jobs_completed ?? 0} verified{" "}
                    {(w.jobs_completed ?? 0) === 1 ? "job" : "jobs"} completed
                  </small>
                </span>
                <span className={"ml-auto rounded-full px-3 py-1.5 text-[10px] font-extrabold tracking-wide " + (w.lane === "cert" ? "border border-[#4A3A10] bg-[#2E2408] text-sand" : "border border-softline bg-soft text-tealb")}>
                  {w.lane === "cert" ? "CERTIFIED PROFESSIONAL" : "EVIDENCE VETTED"}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-dim">
            Workers are matched or shortlisted for your job by Yaadly, so you
            never have a stranger at your gate. Want someone here for your next
            job? Say so when your job is scoped.
          </p>
        </>
      )}

      <div className="mt-7 rounded-2xl border border-line bg-panel p-5">
        <h3 className="font-display text-[19px] uppercase">
          Want to be <span className="text-mango">part of it?</span>
        </h3>
        <p className="mt-2 text-[12.5px] leading-relaxed text-dim">
          Property owners: create your profile, sign the Client Guidelines, and
          pitch your job, free, and your record starts building from the first
          completed job. Tradespeople: apply free, pass verification, sign the
          Worker Guidelines, and every job on this board is yours to quote.
        </p>
        <div className="mt-3.5 flex flex-wrap gap-2.5">
          <Link href="/portal/sign-in" className="rounded-full bg-linear-to-r from-teal to-mango px-4.5 py-2.5 text-[13.5px] font-bold text-[#04211D] transition hover:brightness-110">
            Become a client &rarr;
          </Link>
          <a href={`${SITE}/#worker`} className="rounded-full border border-line2 px-4.5 py-2.5 text-[13.5px] font-bold text-ink transition hover:border-teal hover:text-tealb">
            Join as a worker &rarr;
          </a>
          <a href={`${SITE}/#client`} className="rounded-full border border-line2 px-4.5 py-2.5 text-[13.5px] font-bold text-ink transition hover:border-teal hover:text-tealb">
            Read the Client Guidelines
          </a>
          <a href={`${SITE}/#worker`} className="rounded-full border border-line2 px-4.5 py-2.5 text-[13.5px] font-bold text-ink transition hover:border-teal hover:text-tealb">
            Read the Worker Guidelines
          </a>
        </div>
      </div>
    </div>
  );
}
