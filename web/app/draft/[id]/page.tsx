import { ThemeToggle } from "@/components/ThemeToggle";
import { createClient } from "@/lib/supabase/server";
import { DraftEditor } from "@/components/draft/DraftEditor";
import { DocLogo } from "@/components/portal/DocLogo";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your report to the client · Yaadly",
  robots: { index: false, follow: false },
};

/* ── The report draft, editable, with no login ──────────────────────────────
 *
 * Founder, 29 Sep 2026. She tested a stage for real. The worker had written
 * "fixing beam in place" and the draft told the client the beam was secured
 * and every task completed. She asked "so then how can they edit it properly",
 * and the honest answer was that on WhatsApp they could not.
 *
 * This is a worker web page, and CLAUDE.md section 9 keeps the worker web
 * surface thin on purpose. It is the second deliberate exception, after the
 * Completion Report page of 28 Sep, chosen by the founder with that flagged
 * to her first. It is one text box and one button and it stays that way.
 *
 * The code in the WhatsApp link is the key, the same pattern as /report/[id].
 * report_draft_for_code() checks it in Postgres, counts a wrong one, and locks
 * the link after ten; every new draft gets a new code. What comes back is the
 * draft, the worker's own captions it was written from, and the job's title.
 * No address, no contact details, no money.
 */
type Payload = {
  error?: string;
  job?: { id: string; title: string | null };
  stage?: number;
  draft?: string;
  captions?: string[];
  sent_at?: string | null;
  sent_via?: string | null;
};

const shell = "mx-auto max-w-[640px] px-5 py-8";
const label = "font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-dim";

export default async function ReportDraft({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ code?: string }> }) {
  const { id } = await params;
  const { code = "" } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_draft_for_code", { p_job: id, p_code: code });
  const p = (data ?? {}) as Payload;

  if (error || p.error || !p.job || typeof p.draft !== "string") {
    return (
      <div className={shell}>
        <DocLogo />
        <h1 className="mt-5 font-display text-[26px] uppercase">Your report to the client</h1>
        <p className="mt-3 text-[14px] text-mute">{p.error || "That link is not valid, or it is out of date. Open the latest link from your WhatsApp."}</p>
      </div>
    );
  }

  const captions = (p.captions ?? []).filter(Boolean);
  return (
    <div className={shell + " grid gap-4"}>
      <div>
        {/* The Yaadly mark, on every page since 25 Oct 2026. This page has
            no header by design, so it sits where the header would, with the
            light and dark switch beside it. */}
        <div className="mb-5 flex items-center justify-between gap-3">
          <DocLogo />
          <ThemeToggle />
        </div>
        <p className={label}>Report to the client · {p.job.id} · stage {p.stage}</p>
        <h1 className="mt-1 font-display text-[clamp(22px,3.5vw,30px)] uppercase leading-tight">{p.job.title}</h1>
      </div>

      {p.sent_at ? (
        <div className="rounded-2xl border border-line bg-bg p-4 text-[13.5px] text-mute">
          This report has already been sent to the client{p.sent_via === "whatsapp" ? ", from WhatsApp" : ""}. Nothing more is needed from you.
        </div>
      ) : (
        <>
          {captions.length > 0 && (
            <section className="rounded-2xl border border-line bg-panel p-5">
              <h2 className="text-[14px] font-bold text-ink">What you sent</h2>
              <p className="mt-1 text-[12.5px] text-dim">The draft below was written from these. Check it says no more than you did.</p>
              <ul className="mt-3 grid gap-1.5 text-[13.5px] text-mute">
                {captions.map((c, i) => <li key={i}>&ldquo;{c}&rdquo;</li>)}
              </ul>
            </section>
          )}
          <DraftEditor jobId={p.job.id} code={code} draft={p.draft} />
          <p className="text-[12.5px] text-dim">
            Nothing goes to the client until you press Send. The client reads it, looks at your photographs, and decides.
          </p>
        </>
      )}
    </div>
  );
}
