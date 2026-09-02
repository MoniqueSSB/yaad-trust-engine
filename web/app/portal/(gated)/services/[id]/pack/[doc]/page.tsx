import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { PACK_DOC_ORDER, renderPackDoc, type Dict } from "@/lib/portal/packDocs";

export const dynamic = "force-dynamic";

/** One document of a service booking's Kickoff Pack, same renderers as the
 *  job version. A service booking carries at most one pack, so there is no
 *  quote disambiguation here. */
export default async function ServicePackDoc({
  params,
}: {
  params: Promise<{ id: string; doc: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");
  const { id, doc } = await params;

  const idx = PACK_DOC_ORDER.findIndex((x) => x.slug === doc);
  if (idx < 0) notFound();

  const supabase = await createClient();
  const { data: pack } = await supabase
    .from("kickoff_packs")
    .select("id,project_title,status,rev,docs")
    .eq("service_id", id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!pack) notFound();

  const d = (pack.docs ?? {}) as Dict;
  const base = "/portal/services/" + encodeURIComponent(id) + "/pack";
  const prev = PACK_DOC_ORDER[idx - 1];
  const next = PACK_DOC_ORDER[idx + 1];

  return (
    <div className="rounded-2xl border border-line bg-panel p-6">
      <Link href={base} className="text-[13px] text-tealb underline-offset-2 hover:underline">
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
          <Link href={base + "/" + prev.slug} className="text-[13px] font-bold text-tealb underline-offset-2 hover:underline">
            &larr; {prev.title}
          </Link>
        ) : <span />}
        {next ? (
          <Link href={base + "/" + next.slug} className="text-[13px] font-bold text-tealb underline-offset-2 hover:underline">
            {next.title} &rarr;
          </Link>
        ) : (
          <Link href={base} className="text-[13px] font-bold text-tealb underline-offset-2 hover:underline">
            Back to the pack &rarr;
          </Link>
        )}
      </div>
    </div>
  );
}
