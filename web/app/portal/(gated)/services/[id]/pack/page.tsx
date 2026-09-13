import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { PACK_DOC_ORDER, packDocHasContent, type Dict } from "@/lib/portal/packDocs";

export const dynamic = "force-dynamic";

/**
 * The Kickoff Pack for a service booking, table of contents. Same document
 * set and the same renderers as a job's pack, one parent column apart
 * (kickoff_packs.service_id). Deliberately simpler than the job version:
 * Yaadly itself is the provider, so there is no worker side, no dual
 * confirmation and no confirm code in play. The client reads their plan;
 * nothing here asks them to do anything. Only an approved pack is readable
 * (kickoff_packs RLS enforces that, not this page): an edit in the desk
 * knocks a pack back to in_review and it disappears from here until it is
 * approved again, which is the revision discipline working, not a bug.
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
  return { title: `Pack · ${id} · Yaadly` };
}

export default async function ServicePackIndex({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");
  const { id } = await params;
  const supabase = await createClient();

  const { data: pack } = await supabase
    .from("kickoff_packs")
    .select("id,project_title,client_name,parish,status,rev,updated_at,docs")
    .eq("service_id", id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!pack) notFound();

  const d = (pack.docs ?? {}) as Dict;
  const base = "/portal/services/" + encodeURIComponent(id) + "/pack";

  return (
    <div className="rounded-2xl border border-line bg-panel p-6">
      <Link href={"/portal/services/" + encodeURIComponent(id)} className="text-[13px] text-tealb underline-offset-2 hover:underline">&larr; Back to your service</Link>
      <div className="mt-3 border-b-2 border-teal pb-4">
        <h1 className="font-display text-[clamp(22px,3.5vw,30px)] uppercase leading-tight">Kickoff Pack</h1>
        <p className="mt-1 text-[12px] text-dim">
          {pack.id} · rev {pack.rev ?? 1} · {pack.project_title}
          {pack.parish ? " · " + pack.parish : ""}
        </p>
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-mute">
        The plan for your booking: what is being done, in what order, what you
        will see as proof, and what is needed from you. Read the documents in
        order or jump straight to the one you need.
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
        Prepared from your booking by Yaadly. It is not a survey, a valuation,
        a quantity surveyor&apos;s estimate or legal advice. If anything in it
        does not match what you agreed, reply on WhatsApp or email and a person
        will correct it; a corrected pack replaces this one as a new revision.
      </p>
    </div>
  );
}
