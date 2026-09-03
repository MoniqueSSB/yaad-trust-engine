import { createClient } from "@/lib/supabase/server";
import { SiteNav } from "@/components/SiteNav";
import { AskForm } from "@/app/ask/AskForm";

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
 *
 * NO RESPONSE TIME IS PROMISED HERE, and that is deliberate rather than an
 * omission. /jobs/new says one working day because the founder defined one.
 * Nothing defines a timing for a public question that waits on a stranger to
 * answer it, so this page says "there is no fixed timing, check back". If a
 * timing is ever set, it goes in the "what happens next" list in AskForm.
 *
 * The form moved into AskForm.tsx on 3 Sep 2026, the same day the reason it
 * had never saved a single row was found. See actions.ts and DECISIONS.md.
 */

export const metadata = { title: "Ask a Yaad · Yaadly" };

export default async function Ask() {
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
        <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Ask a Yaad &middot; free public answers</p>
        <h1 className="mt-2 font-display text-[clamp(28px,4.5vw,42px)] uppercase leading-none">Ask before you post a job</h1>
        <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-mute">
          Not sure if it is a job, a quick fix, or nothing to worry about? Ask
          here and vetted tradespeople answer in public, free.
        </p>
        <p className="mt-2.5 max-w-[62ch] rounded-xl border border-line bg-panel px-4 py-3 text-[13px] leading-relaxed text-mute">
          <b className="text-ink">Everything on this board is public.</b> No
          name, no email and no phone number is asked for, so leave those out
          of your question too. If it is about your own property or your own
          money, use Ask Yaadly, the chat tab on the right, and a person
          replies to you privately.
        </p>

        <AskForm />

        <div className="mt-8 grid gap-3.5 sm:grid-cols-2">
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
                  <p className="mt-2.5 text-[12px] text-dim">No answer yet.</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
