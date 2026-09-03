import { createClient } from "@/lib/supabase/server";
import { SiteNav } from "@/components/SiteNav";
import { askQuestion } from "@/app/ask/actions";

export const dynamic = "force-dynamic";

/**
 * Ask a Yaad, MARKETPLACE-BUILD-SPEC section 8. Free public Q&A: a visitor
 * asks, vetted workers answer publicly. Questions publish after a human
 * look, which is a deliberate moderation gate on an open text box on a
 * public website; the answering bar is the same one quoting uses.
 *
 * Two things on this site are called some version of "ask", and until now
 * neither said which it was. "Ask a Yaad" is this page: public, answered by
 * workers, visible to everyone, slow. "Ask Yaadly" is the chat tab pinned to
 * the right edge of every page: private, answered by a person at Yaadly,
 * quick. A visitor could not tell them apart from their names, so the page
 * now says the difference in a sentence rather than relying on the reader to
 * work it out. Renaming either one is the founder's call, not this file's.
 *
 * Reached from the job board's link row. It had no inbound link at all until
 * 3 Sep 2026.
 */

export const metadata = { title: "Ask a Yaad · Yaadly" };

export default async function Ask({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  const supabase = await createClient();
  const { data: qs } = await supabase
    .from("questions")
    .select("id,body,area,created_at")
    .eq("published", true)
    .order("created_at", { ascending: false })
    .limit(30);
  const ids = (qs ?? []).map((q) => q.id);
  const { data: ans } = ids.length
    ? await supabase.from("answers").select("question_id,worker_email,body,created_at").in("question_id", ids).order("created_at")
    : { data: [] };
  const byQ = new Map<string, { body: string }[]>();
  for (const a of ans ?? []) {
    const l = byQ.get(a.question_id) ?? [];
    l.push(a);
    byQ.set(a.question_id, l);
  }

  return (
    <>
      <SiteNav active="market" />
      <div className="mx-auto max-w-[1080px] px-5 py-10">
        <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Ask a Yaad &middot; public Q&amp;A</p>
        <h1 className="mt-2 font-display text-[clamp(28px,4.5vw,42px)] uppercase leading-none">Ask before you post</h1>
        <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-mute">
          Not sure it&apos;s a job at all? Ask first, vetted workers answer publicly.
        </p>
        <p className="mt-2.5 max-w-[62ch] text-[13.5px] leading-relaxed text-dim">
          This is the public board, so your question and its answers can be read
          by anyone. If it is about your own property or your own money, use
          Ask Yaadly, the chat tab on the right, and a person replies to you
          privately.
        </p>

        <form action={askQuestion} className="mt-6 rounded-2xl border border-line bg-panel p-5">
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim">Your question</label>
          <input name="body" required minLength={10} maxLength={500}
            placeholder="e.g. How much should a water tank install cost in Portmore?"
            className="w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[15px] text-ink outline-none focus:border-teal" />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input name="area" maxLength={60} placeholder="Your area (optional)"
              className="w-44 rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13px] text-ink outline-none focus:border-teal" />
            <button className="rounded-full bg-linear-to-r from-teal to-mango px-4.5 py-2.5 text-[13.5px] font-bold text-onbrand transition hover:brightness-110">
              Ask the community
            </button>
          </div>
          {sent && (
            <p className="mt-3 rounded-xl border border-softline bg-soft px-3.5 py-2.5 text-[13px] text-mute">
              Received. Questions are read by a person before they publish, so
              yours appears once it has been looked at.
            </p>
          )}
          <p className="mt-3 text-[11.5px] text-dim">
            Answered by vetted workers, publicly. Nothing you type here is a
            job or a commitment.
          </p>
        </form>

        <div className="mt-6 grid gap-3.5 sm:grid-cols-2">
          {(qs ?? []).length === 0 ? (
            <p className="rounded-2xl border border-line bg-panel p-5 text-[13.5px] leading-relaxed text-mute sm:col-span-2">
              No questions published yet. Yours can be the first.
            </p>
          ) : (
            (qs ?? []).map((q) => (
              <div key={q.id} className="rounded-2xl border border-line bg-panel p-4.5">
                <b className="text-[14.5px] leading-snug">{q.body}</b>
                {q.area && <p className="mt-1 text-[11.5px] text-dim">Asked from {q.area}</p>}
                {(byQ.get(q.id) ?? []).map((a, i) => (
                  <p key={i} className="mt-2.5 border-l-2 border-softline pl-3 text-[13px] leading-relaxed text-mute">{a.body}</p>
                ))}
                {(byQ.get(q.id) ?? []).length === 0 && (
                  <p className="mt-2.5 text-[12px] text-dim">Waiting on a worker&apos;s answer.</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
