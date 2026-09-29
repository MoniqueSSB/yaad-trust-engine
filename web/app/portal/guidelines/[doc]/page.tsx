import Link from "next/link";
import { notFound } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import legal from "@/lib/legal-copy.json";
import { DocLogo } from "@/components/portal/DocLogo";
import { PrintReport } from "@/components/portal/PrintReport";

export const dynamic = "force-dynamic";

/**
 * One set of guidelines, whole, as a document to keep. Founder, 28 Sep 2026:
 * every document in "Your documents" can be reviewed as a PDF. The guidelines
 * page only shows the text while it is being signed, so once signed there was
 * nothing left to read or keep. This page shows the current version in full,
 * with the signature against it when the reader has one, and the same
 * Download PDF button as the Completion Report.
 *
 * Reading is public, as on /portal/guidelines. Signing is not done here.
 */

type Sec = { n: number; title: string; html: string };

const DOCS = {
  client: { key: "client_guidelines", label: "Client Guidelines", version: legal.CG_VERSION, date: legal.CG_DATE, sections: legal.client_guidelines as Sec[] },
  worker: { key: "worker_guidelines", label: "Worker Guidelines", version: legal.WG_VERSION, date: legal.WG_DATE, sections: legal.worker_guidelines as Sec[] },
} as const;

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const d = DOCS[doc as keyof typeof DOCS];
  return { title: `${d ? d.label : "Guidelines"} · Yaadly` };
}

export default async function GuidelinesDoc({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const d = DOCS[doc as keyof typeof DOCS];
  if (!d) notFound();

  const user = await getUser();
  const email = (user?.email ?? "").toLowerCase();
  const sig = user
    ? (await (await createClient())
        .from("doc_signatures")
        .select("signed_at, signer_name")
        .ilike("signer_email", email)
        .eq("doc_type", d.key)
        .eq("doc_version", d.version)
        .order("signed_at", { ascending: false })
        .limit(1)
        .maybeSingle()).data
    : null;

  return (
    <div id="guidelines-doc" className="rounded-2xl border border-line bg-panel p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/portal/guidelines" className="text-[13px] text-tealb underline-offset-2 hover:underline">
          &larr; The guidelines
        </Link>
        <PrintReport jobId={"v" + d.version} targetId="guidelines-doc" name={d.label} />
      </div>
      <div className="mt-3 border-b-2 border-teal pb-4">
        <div className="mb-3"><DocLogo /></div>
        <h1 className="font-display text-[clamp(22px,3.5vw,30px)] uppercase leading-tight">{d.label}</h1>
        <p className="mt-1 text-[12px] text-dim">
          Version {d.version} · {d.date}
          {sig ? ` · Signed ${String(sig.signed_at).slice(0, 10)}${sig.signer_name ? " by " + sig.signer_name : ""}` : ""}
        </p>
      </div>
      <div className="doc-body mt-5 text-[13.5px] leading-relaxed text-mute">
        {d.sections.map((s) => (
          <section key={s.n} className="mb-5 break-inside-avoid-page">
            <h2 className="mb-1.5 text-[14px] font-bold text-ink">{s.n} · {s.title}</h2>
            <div dangerouslySetInnerHTML={{ __html: s.html }} />
          </section>
        ))}
      </div>
      <p className="mt-5 border-t border-line pt-3.5 text-[11.5px] leading-relaxed text-dim">
        {sig
          ? `This is the version you signed. A signature is recorded against the exact version and consent sentence, and is never moved onto different words.`
          : `This is the current version. Signing is done on the guidelines page, and is recorded against this exact version.`}
      </p>
    </div>
  );
}
