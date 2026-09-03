import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { PACK_DOC_ORDER, renderPackDoc, type Dict } from "@/lib/portal/packDocs";

export const dynamic = "force-dynamic";

/* Its own title, so two job tabs are two different words in the tab strip.
   The id rather than the job's name because it is already on the page, it is
   what the client quotes when they message, and reading it costs no query. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; doc: string }>;
}) {
  const { id, doc } = await params;
  return { title: `${doc} · ${id} · Yaadly` };
}

export default async function PackDoc({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; doc: string }>;
  searchParams: Promise<{ quote?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");
  const { id, doc } = await params;
  const { quote: quoteParam } = await searchParams;

  const idx = PACK_DOC_ORDER.findIndex((x) => x.slug === doc);
  if (idx < 0) notFound();

  const supabase = await createClient();
  // Same reason as pack/page.tsx: a job can carry more than one pack in
  // flight, so this has to name which one when it can.
  let packQuery = supabase.from("kickoff_packs").select("id,project_title,status,rev,docs").eq("job_id", id);
  if (quoteParam) packQuery = packQuery.eq("quote_id", quoteParam);
  const { data: pack } = await packQuery.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!pack) notFound();

  const d = (pack.docs ?? {}) as Dict;
  const qs = quoteParam ? "?quote=" + encodeURIComponent(quoteParam) : "";
  const base = "/portal/jobs/" + encodeURIComponent(id) + "/pack";
  const prev = PACK_DOC_ORDER[idx - 1];
  const next = PACK_DOC_ORDER[idx + 1];

  return (
    <div className="rounded-2xl border border-line bg-panel p-6">
      <Link href={base + qs} className="text-[13px] text-tealb underline-offset-2 hover:underline">
        &larr; All documents in this pack
      </Link>

      <div className="mt-3 border-b-2 border-teal pb-4">
        <span className="font-mono text-[10.5px] uppercase tracking-[.15em] text-dim">
          Kickoff Pack · document {idx + 1} of {PACK_DOC_ORDER.length}
        </span>
        <h1 className="mt-1 font-display text-[clamp(22px,3.5vw,30px)] uppercase leading-tight">
          {PACK_DOC_ORDER[idx].title}
        </h1>
      </div>

      <div className="mt-5">{renderPackDoc(doc, d)}</div>

      <div className="mt-8 flex items-center justify-between border-t border-line pt-4">
        {prev ? (
          <Link href={base + "/" + prev.slug + qs} className="text-[13px] font-bold text-tealb underline-offset-2 hover:underline">
            &larr; {prev.title}
          </Link>
        ) : <span />}
        {next ? (
          <Link href={base + "/" + next.slug + qs} className="text-[13px] font-bold text-tealb underline-offset-2 hover:underline">
            {next.title} &rarr;
          </Link>
        ) : (
          <Link href={base + qs} className="text-[13px] font-bold text-tealb underline-offset-2 hover:underline">
            Back to the pack &rarr;
          </Link>
        )}
      </div>
    </div>
  );
}
