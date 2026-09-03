import { createClient } from "@/lib/supabase/server";
import { SiteNav } from "@/components/SiteNav";
import { askQuestion } from "@/app/ask/actions";

export const dynamic = "force-dynamic";

/**
 * Ask Yaadly, MARKETPLACE-BUILD-SPEC section 8. Free public Q&A: a visitor
 * asks, vetted workers answer publicly. Questions publish after a human
 * look, which is a deliberate moderation gate on an open text box on a
 * public website; the answering bar is the same one quoting uses.
 *
 * ONE NAME, TWO DOORS. Founder decision, 3 Sep 2026. This page was "Ask a
 * Yaad" and the chat tab pinned to the right edge of every page was "Ask
 * Yaadly": two products, near identical names, opposite privacy, and nothing
 * anywhere saying which was which. The decision was not to invent a third
 * name but to collapse to one, so there is a single thing a client asks and
 * two ways to reach it.
 *
 * That puts the whole burden of the distinction on copy, which is why the
 * paragraph under the heading is not decoration and should not be trimmed:
 * this door is public, permanent and answered by workers; the chat is
 * private, immediate and answered by a person. Somebody about to type their
 * address into the wrong one has only that sentence to stop them.
 *
 * Reached from the job board's link row. It had no inbound link at all until
 * 3 Sep 2026.
 */

export const metadata = { title: "Ask Yaadly · public Q&A" };

/**
 * What came back from ask_question(), said in the reader's terms.
 *
 * "throttled" is deliberately not an apology and not an error. Somebody who
 * has asked ten questions in an hour is enthusiastic, not hostile, and the
 * page should say what happened and when they can go again.
 */
const OUTCOME: Record<string, { tone: "ok" | "warn"; text: string }> = {
  "1": {
    tone: "ok",
    text: "Received. Questions are read by a person before they publish, so yours appears once it has been looked at.",
  },
  throttled: {
    tone: "warn",
    text: "That is ten questions in an hour, which is where we stop and read. Nothing is lost, and you can ask again shortly.",
  },
  short: {
    tone: "warn",
    text: "That was too short to answer well. Ten characters or more, and say where the property is if you can.",
  },
  error: {
    tone: "warn",
    text: "That did not save, and it is our end rather than yours. Try again, or message us on WhatsApp and a person will pick it up.",
  },
};

export default async function Ask({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  const outcome = sent ? OUTCOME[sent] : undefined;
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
        <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Ask Yaadly &middot; public Q&amp;A</p>
        <h1 className="mt-2 font-display text-[clamp(28px,4.5vw,42px)] uppercase leading-none">Ask before you post</h1>
        <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-mute">
          Not sure it&apos;s a job at all? Ask first, vetted workers answer publicly.
        </p>
        <p className="mt-2.5 max-w-[62ch] text-[13.5px] leading-relaxed text-dim">
          Two ways to ask, and this is the public one: your question and its
          answers stay on this page where anyone can read them, and it is
          vetted workers who answer. For anything about your own property,
          your own money or your own address, use the chat tab on the right
          instead. That one is private and a person replies to you.
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
          {/* role="status" so a screen reader is told the outcome. Without it
              the only feedback was a paragraph appearing silently in the
              middle of the form, which is no feedback at all if you cannot
              see it. Not role="alert": none of these is an emergency, and
              alert interrupts whatever is being read. */}
          {outcome && (
            <p
              role="status"
              className={
                "mt-3 rounded-xl border px-3.5 py-2.5 text-[13px] " +
                (outcome.tone === "ok"
                  ? "border-softline bg-soft text-mute"
                  : "border-gold/40 bg-gold/10 text-goldb")
              }
            >
              {outcome.text}
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
