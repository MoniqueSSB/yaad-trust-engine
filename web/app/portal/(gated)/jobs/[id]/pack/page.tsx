import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { PACK_DOC_ORDER, packDocHasContent, type Dict } from "@/lib/portal/packDocs";
import { agreeKickoffPack } from "@/app/portal/job-actions";

export const dynamic = "force-dynamic";

/**
 * The Kickoff Pack's table of contents. 31 Aug 2026: this used to be every
 * document run together on one long scroll; each one is now its own page
 * under /pack/[doc], reached from here. Only approved packs are readable by
 * the parties; drafts stay internal (kickoff_packs RLS enforces that, not
 * this page).
 *
 * Dual agreement, same day: a change after issue creates a new revision and
 * both sides re-sign, so the confirm code shown below is only ever the
 * CURRENT revision's. A code baked into an older link fails closed in
 * agree_kickoff_pack() rather than silently confirming stale content.
 */
/* Its own title, so two job tabs are two different words in the tab strip.
   The id rather than the job's name because it is already on the page, it is
   what the client quotes when they message, and reading it costs no query. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: `Kickoff pack · ${id} · Yaadly` };
}

export default async function PackIndex({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ code?: string; quote?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");
  const { id } = await params;
  const { code: linkCode, quote: quoteParam } = await searchParams;
  const supabase = await createClient();

  // A job can carry more than one Kickoff Pack in flight since 1 Sep 2026 (a
  // client can accept more than one quote and compare). "Latest updated for
  // this job" is no longer a safe way to pick one: this prefers the quote
  // named in the link, falling back to the confirm code (the shape of the
  // WhatsApp notification link, which does not carry a quote id), and only
  // falls back to "latest for the job" for an older link with neither.
  let packQuery = supabase
    .from("kickoff_packs")
    .select("id,quote_id,project_title,client_name,parish,status,rev,updated_at,docs,approved_by,approved_at,confirm_code,both_confirmed_at")
    .eq("job_id", id);
  if (quoteParam) packQuery = packQuery.eq("quote_id", quoteParam);
  else if (linkCode) packQuery = packQuery.eq("confirm_code", linkCode.toUpperCase());

  const [{ data: pack }, { data: job }] = await Promise.all([
    packQuery.order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("jobs").select("client_email,worker_email").eq("id", id).maybeSingle(),
  ]);
  if (!pack) notFound();

  const email = (user.email ?? "").toLowerCase();
  let role: "client" | "worker" | null = job && job.client_email?.toLowerCase() === email
    ? "client"
    : job && job.worker_email?.toLowerCase() === email
    ? "worker"
    : null;

  // Pre-booking, jobs.worker_email is still blank while this exact worker's
  // own pack exists: match them by the quote it was drafted against instead.
  if (!role && pack.quote_id) {
    const { data: quote } = await supabase.from("job_quotes").select("worker_user").eq("id", pack.quote_id).maybeSingle();
    if (quote && quote.worker_user === user.id) role = "worker";
  }

  const { data: agreements } = await supabase
    .from("kickoff_pack_agreements")
    .select("side")
    .eq("pack_id", pack.id)
    .eq("rev", pack.rev ?? 1);
  const clientAgreed = (agreements ?? []).some((a) => a.side === "client");
  const workerAgreed = (agreements ?? []).some((a) => a.side === "worker");
  const iAgreed = role === "client" ? clientAgreed : role === "worker" ? workerAgreed : false;

  const d = (pack.docs ?? {}) as Dict;
  const base = "/portal/jobs/" + encodeURIComponent(id) + "/pack";
  const docQs = pack.quote_id ? "?quote=" + encodeURIComponent(pack.quote_id) : "";

  return (
    <div className="rounded-2xl border border-line bg-panel p-6">
      <Link href={"/portal/jobs/" + encodeURIComponent(id)} className="text-[13px] text-tealb underline-offset-2 hover:underline">&larr; Back to the job</Link>
      <div className="mt-3 border-b-2 border-teal pb-4">
        <h1 className="font-display text-[clamp(22px,3.5vw,30px)] uppercase leading-tight">Kickoff Pack</h1>
        <p className="mt-1 text-[12px] text-dim">
          {pack.id} · rev {pack.rev ?? 1} · {pack.project_title}
          {pack.parish ? " · " + pack.parish : ""} ·{" "}
          {pack.status === "approved" ? "Approved for issue" : pack.status}
        </p>
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-mute">
        Nine documents, each on its own page. Read them in order or jump straight
        to the one you need.
      </p>

      {pack.status === "approved" && role && (
        <section className="mt-4 rounded-xl border border-line2 bg-panel2 p-4">
          <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
            Confirm this revision
          </h2>
          <p className="mb-3 max-w-[62ch] text-[13px] leading-relaxed text-mute">
            Both sides confirm this exact revision before it is treated as final.
            {pack.both_confirmed_at
              ? " Both sides have confirmed rev " + (pack.rev ?? 1) + "."
              : " If the pack changes after this, a new revision is issued and both sides confirm again."}
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={"rounded-full border px-3 py-1.5 text-[12px] font-bold " + (clientAgreed ? "border-softline bg-soft text-tealb" : "border-line text-dim")}>
              {clientAgreed ? "✓ Client confirmed" : "Client not yet confirmed"}
            </span>
            <span className={"rounded-full border px-3 py-1.5 text-[12px] font-bold " + (workerAgreed ? "border-softline bg-soft text-tealb" : "border-line text-dim")}>
              {workerAgreed ? "✓ Worker confirmed" : "Worker not yet confirmed"}
            </span>
            {!iAgreed && role === "client" && (
              <form action={agreeKickoffPack}>
                <input type="hidden" name="jobId" value={id} />
                <input type="hidden" name="packId" value={pack.id} />
                <input type="hidden" name="code" value={linkCode || pack.confirm_code || ""} />
                <button className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-onbrand">
                  Confirm as the client
                </button>
              </form>
            )}
          </div>
          {/* Reading happens here; confirming does not. The worker's whole
              surface is WhatsApp by design (CLAUDE.md §9), so this is a
              reply, not a button - agree_kickoff_pack_via_whatsapp() reads
              which job was meant from the reply text itself. */}
          {!iAgreed && role === "worker" && (
            <p className="mt-3 text-[13px] leading-relaxed text-mute">
              Reply to Yaadly&apos;s WhatsApp message with <b className="font-mono text-ink">{id}</b> to confirm your side.
            </p>
          )}
        </section>
      )}

      <ol className="mt-4 grid gap-2">
        {PACK_DOC_ORDER.map((doc, i) => {
          const has = packDocHasContent(doc.slug, d);
          return (
            <li key={doc.slug}>
              <Link
                href={base + "/" + doc.slug + docQs}
                className="flex items-center gap-3 rounded-xl border border-line bg-bg px-4 py-3 transition hover:border-teal"
              >
                <span className="grid size-6 place-items-center rounded-[7px] border border-softline bg-soft font-mono text-[11px] text-tealb">
                  {i + 1}
                </span>
                <b className="text-[14px] text-ink">{doc.title}</b>
                {!has && <span className="ml-auto text-[11.5px] text-dim">not drafted</span>}
                {has && <span className="ml-auto text-tealb">&rarr;</span>}
              </Link>
            </li>
          );
        })}
      </ol>

      <p className="mt-5 border-t border-line pt-3.5 text-[11.5px] leading-relaxed text-dim">
        Prepared from the written intake. It is not a survey, a valuation, a
        quantity surveyor&apos;s estimate or legal advice, and it contains no
        prices set by Yaadly. A change after issue creates a new revision and
        both sides re-sign; earlier revisions stay readable forever.
      </p>
    </div>
  );
}
