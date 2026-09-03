import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { jmdOrBlank as jmd } from "@/lib/money";

export const dynamic = "force-dynamic";



/**
 * The Quote Pack: the price and terms a worker actually submitted (labour,
 * materials, scope, included, excluded, timeline, payment stage note), read
 * as a document rather than a card in a list. 2 Sep 2026, alongside the
 * dual-agreement mechanism: nothing here is drafted separately, it is
 * exactly what /jobs/[id]/quotes already shows a client with no account,
 * plus who has confirmed it and when. Deliberately one page, not the
 * Kickoff Pack's nine: this is a handful of fields the worker wrote
 * themselves, not a drafted document with a table of contents.
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
  return { title: `Quote pack · ${id} · Yaadly` };
}

export default async function QuotePackPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ quote?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");
  const { id } = await params;
  const { quote: quoteParam } = await searchParams;
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("id,title,parish,client_email,worker_email")
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();

  // Same "prefer the one named in the link, fall back to the newest live
  // one" shape the Kickoff Pack index page already uses (20260831zzzz13):
  // a job can carry more than one quote in flight at once.
  let quoteQuery = supabase
    .from("job_quotes")
    .select(
      "id,worker_name,worker_email,worker_user,labour_jmd,materials_jmd,materials_at_cost,earliest_start,days_estimate,note,status,scope_summary,included_note,excluded_note,timeline_note,payment_stage_note,created_at",
    )
    .eq("job_id", id);
  quoteQuery = quoteParam
    ? quoteQuery.eq("id", quoteParam)
    : quoteQuery.in("status", ["quote_confirmed", "kickoff_requested", "accepted"]);

  const { data: quoteRow } = await quoteQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!quoteRow) notFound();

  const email = (user.email ?? "").toLowerCase();
  const role: "client" | "worker" | null =
    job.client_email?.toLowerCase() === email
      ? "client"
      : quoteRow.worker_email?.toLowerCase() === email
      ? "worker"
      : null;
  if (!role) notFound();

  const { data: agreements } = await supabase
    .from("quote_agreements")
    .select("side, agreed_at")
    .eq("quote_id", quoteRow.id);
  const clientAgreed = (agreements ?? []).find((a) => a.side === "client");
  const workerAgreed = (agreements ?? []).find((a) => a.side === "worker");
  const total = (quoteRow.labour_jmd ?? 0) + (quoteRow.materials_jmd ?? 0);

  // The richer, job-level document a worker was shown before they quoted
  // (yaad-quote-pack): fuller scope, structured included/excluded lists,
  // a payment stage shape in percentages. Job-level, not worker-specific,
  // so it is the same document every worker who quoted this job saw; it
  // still reads as this worker's own starting point since they wrote their
  // price and terms against it.
  const { data: draftRow } = await supabase
    .from("quote_pack_drafts")
    .select("docs")
    .eq("job_id", id)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const draftDocs = (draftRow?.docs ?? null) as {
    scope_summary?: string;
    included?: string[];
    excluded?: string[];
    rough_timeline?: string;
    payment_stages?: { stage: string; proportion_percent?: number; evidence_note?: string }[];
  } | null;

  return (
    <div className="rounded-2xl border border-line bg-panel p-6">
      <Link href={"/portal/jobs/" + encodeURIComponent(id)} className="text-[13px] text-tealb underline-offset-2 hover:underline">&larr; Back to the job</Link>
      <div className="mt-3 border-b-2 border-teal pb-4">
        <h1 className="font-display text-[clamp(22px,3.5vw,30px)] uppercase leading-tight">Quote Pack</h1>
        <p className="mt-1 text-[12px] text-dim">
          {job.title} · {quoteRow.worker_name}
          {job.parish ? " · " + job.parish : ""} ·{" "}
          {quoteRow.status === "quote_confirmed" ? "Confirmed by both sides" : quoteRow.status}
        </p>
      </div>

      <section className="mt-4 rounded-xl border border-line2 bg-panel2 p-4">
        <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Price</h2>
        <div className="mt-2 grid gap-1.5 text-[13.5px]">
          <div className="flex justify-between gap-4">
            <span className="text-mute">Labour</span>
            <span className="font-mono">{jmd(quoteRow.labour_jmd)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-mute">Materials{quoteRow.materials_at_cost ? ", at cost" : ""}</span>
            <span className="font-mono">{jmd(quoteRow.materials_jmd)}</span>
          </div>
          <div className="mt-1 flex justify-between gap-4 border-t border-line pt-2 font-bold">
            <span>Total</span>
            <span className="font-mono">{jmd(total)}</span>
          </div>
        </div>
        {(quoteRow.earliest_start || quoteRow.days_estimate) && (
          <p className="mt-3 text-[12.5px] text-dim">
            {quoteRow.earliest_start ? `Can start ${quoteRow.earliest_start}` : ""}
            {quoteRow.days_estimate ? ` · about ${quoteRow.days_estimate}` : ""}
          </p>
        )}
      </section>

      {/* The worker's own submitted fields win whenever they filled them in
          (QuotePanel pre-fills these from the same draft, editable, before
          they send their quote — this is their edited word, not the
          unedited suggestion). The draft is a fallback only for a worker
          who cleared a field, or one who quoted before this draft existed. */}
      {(quoteRow.scope_summary || draftDocs?.scope_summary) && (
        <section className="mt-4">
          <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Scope</h2>
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-mute">
            {quoteRow.scope_summary || draftDocs?.scope_summary}
          </p>
        </section>
      )}

      {(quoteRow.included_note || quoteRow.excluded_note || (draftDocs?.included?.length ?? 0) > 0 || (draftDocs?.excluded?.length ?? 0) > 0) && (
        <section className="mt-4 grid gap-4 sm:grid-cols-2">
          {quoteRow.included_note ? (
            <div>
              <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Included</h2>
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-mute">{quoteRow.included_note}</p>
            </div>
          ) : (draftDocs?.included?.length ?? 0) > 0 ? (
            <div>
              <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Included</h2>
              <ul className="ml-4 list-disc text-[13.5px] leading-relaxed text-mute">
                {draftDocs!.included!.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </div>
          ) : null}
          {quoteRow.excluded_note ? (
            <div>
              <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Excluded</h2>
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-mute">{quoteRow.excluded_note}</p>
            </div>
          ) : (draftDocs?.excluded?.length ?? 0) > 0 ? (
            <div>
              <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Excluded</h2>
              <ul className="ml-4 list-disc text-[13.5px] leading-relaxed text-mute">
                {draftDocs!.excluded!.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </div>
          ) : null}
        </section>
      )}

      {(quoteRow.timeline_note || draftDocs?.rough_timeline) && (
        <section className="mt-4">
          <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Timeline</h2>
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-mute">
            {quoteRow.timeline_note || draftDocs?.rough_timeline}
          </p>
        </section>
      )}

      {quoteRow.payment_stage_note ? (
        <section className="mt-4">
          <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Payment stages</h2>
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-mute">{quoteRow.payment_stage_note}</p>
        </section>
      ) : (draftDocs?.payment_stages?.length ?? 0) > 0 ? (
        <section className="mt-4">
          <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Payment stages</h2>
          <ul className="mt-1.5 grid gap-2">
            {draftDocs!.payment_stages!.map((s, i) => (
              <li key={i} className="text-[13.5px] leading-relaxed text-mute">
                <span className="font-bold text-ink">{s.stage}</span>
                {s.proportion_percent != null ? ` · ${s.proportion_percent}%` : ""}
                {s.evidence_note && <span className="block text-[12.5px] text-dim">{s.evidence_note}</span>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {quoteRow.note && (
        <section className="mt-4">
          <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Worker&rsquo;s own note</h2>
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-mute">{quoteRow.note}</p>
        </section>
      )}

      <section className="mt-5 rounded-xl border border-line2 bg-panel2 p-4">
        <h2 className="mb-2 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Confirmation</h2>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className={"rounded-full border px-3 py-1.5 text-[12px] font-bold " + (clientAgreed ? "border-softline bg-soft text-tealb" : "border-line text-dim")}>
            {clientAgreed ? "✓ Client confirmed" : "Client not yet confirmed"}
          </span>
          <span className={"rounded-full border px-3 py-1.5 text-[12px] font-bold " + (workerAgreed ? "border-softline bg-soft text-tealb" : "border-line text-dim")}>
            {workerAgreed ? "✓ Worker confirmed" : "Worker not yet confirmed"}
          </span>
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-mute">
          Confirmed by replying to Yaadly&rsquo;s WhatsApp message with the job code, not from this page.
          {role === "client" && !clientAgreed && " Reply with the job code once you're happy with this price."}
        </p>
      </section>

      <p className="mt-5 border-t border-line pt-3.5 text-[11.5px] leading-relaxed text-dim">
        This is what {quoteRow.worker_name} actually quoted, not a document Yaadly drafted. Once both sides
        confirm it, the job can be booked with no Kickoff Pack needed, or you can ask for one first if you want
        the fuller document: scope, payment schedule, risk register and evidence checklist.
      </p>
    </div>
  );
}
