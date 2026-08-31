import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { PACK_DOC_ORDER, packDocHasContent, type Dict } from "@/lib/portal/packDocs";

export const dynamic = "force-dynamic";

/**
 * The Kickoff Pack's table of contents. 31 Aug 2026: this used to be every
 * document run together on one long scroll; each one is now its own page
 * under /pack/[doc], reached from here. Only approved packs are readable by
 * the parties; drafts stay internal (kickoff_packs RLS enforces that, not
 * this page).
 */
export default async function PackIndex({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");
  const { id } = await params;
  const supabase = await createClient();
  const { data: pack } = await supabase
    .from("kickoff_packs")
    .select("id,project_title,client_name,parish,status,rev,updated_at,docs,approved_by,approved_at")
    .eq("job_id", id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!pack) notFound();

  const d = (pack.docs ?? {}) as Dict;
  const base = "/portal/jobs/" + encodeURIComponent(id) + "/pack";

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

      <ol className="mt-4 grid gap-2">
        {PACK_DOC_ORDER.map((doc, i) => {
          const has = packDocHasContent(doc.slug, d);
          return (
            <li key={doc.slug}>
              <Link
                href={base + "/" + doc.slug}
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
