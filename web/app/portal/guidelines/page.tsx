import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import legal from "@/lib/legal-copy.json";
import { signGuidelines } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Reading and signing the guidelines, in the portal where the signature
 * legally lives. The copy is the decided text, carried verbatim from the
 * canonical reference. A signature row records the exact version and the
 * exact consent sentence; changing the wording means a new version and a
 * re-sign, never a moved signature.
 */

type Sec = { n: number; title: string; html: string };

export default async function Guidelines({
  searchParams,
}: {
  searchParams: Promise<{ read?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");
  const { read } = await searchParams;
  const supabase = await createClient();
  const email = (user.email ?? "").toLowerCase();

  const { data: sigs } = await supabase
    .from("doc_signatures")
    .select("doc_type,doc_version,signed_at")
    .ilike("signer_email", email)
    .in("doc_type", ["client_guidelines", "worker_guidelines"]);

  const docs = [
    { key: "client_guidelines", label: "Client Guidelines", version: legal.CG_VERSION, sections: legal.client_guidelines as Sec[] },
    { key: "worker_guidelines", label: "Worker Guidelines", version: legal.WG_VERSION, sections: legal.worker_guidelines as Sec[] },
  ];

  return (
    <>
      <h1 className="font-display text-[clamp(26px,4vw,38px)] uppercase leading-none">
        The guidelines
      </h1>
      <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-mute">
        You sign once, not once per job. If the wording ever changes you are
        asked to re-sign the new version; a signature is never moved onto
        words you did not read.
      </p>

      {docs.map((d) => {
        const sig = (sigs ?? []).find(
          (s) => s.doc_type === d.key && s.doc_version === d.version,
        );
        const open = read === d.key;
        return (
          <section key={d.key} className="mt-5 rounded-2xl border border-line bg-panel p-5">
            <div className="flex flex-wrap items-center gap-3">
              <b className="text-[15.5px]">{d.label}</b>
              <span className="text-[12px] text-dim">Version {d.version}</span>
              {sig ? (
                <span className="ml-auto rounded-full border border-softline bg-soft px-3 py-1 text-[11px] font-bold text-tealb">
                  ✓ Signed {String(sig.signed_at).slice(0, 10)}
                </span>
              ) : (
                <a href={`/portal/guidelines?read=${d.key}`} className="ml-auto rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-[#04211D]">
                  Read and sign
                </a>
              )}
            </div>

            {open && !sig && (
              <>
                <div className="doc-body mt-4 max-h-[420px] overflow-y-auto rounded-xl border border-line bg-bg p-4 text-[13px] leading-relaxed text-mute">
                  {d.sections.map((s) => (
                    <div key={s.n} className="mb-4">
                      <h3 className="mb-1.5 text-[13.5px] font-bold text-ink">
                        {s.n} · {s.title}
                      </h3>
                      <div dangerouslySetInnerHTML={{ __html: s.html }} />
                    </div>
                  ))}
                </div>
                <form action={signGuidelines} className="mt-4 flex flex-wrap items-end gap-3">
                  <input type="hidden" name="docType" value={d.key} />
                  <label className="min-w-[240px] flex-1">
                    <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim">
                      Type your full name to sign
                    </span>
                    <input name="name" required minLength={3}
                      className="w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[15px] text-ink outline-none focus:border-teal" />
                  </label>
                  <button className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-3 text-[14px] font-bold text-[#04211D]">
                    Sign {d.label} {d.version.split(" ")[0]}
                  </button>
                  <p className="w-full text-[11.5px] leading-relaxed text-dim">
                    Written to doc_signatures with a timestamp, the exact
                    version, and the exact consent sentence. No edit, no
                    delete.
                  </p>
                </form>
              </>
            )}
          </section>
        );
      })}
    </>
  );
}
