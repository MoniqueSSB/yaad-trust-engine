import { createClient } from "@/lib/supabase/server";
import { SiteNav } from "@/components/SiteNav";
import { AskForm } from "@/app/ask/AskForm";

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
 *
 * NO RESPONSE TIME IS PROMISED HERE, and that is deliberate rather than an
 * omission. /jobs/new says one working day because the founder defined one.
 * Nothing defines a timing for a public question that waits on a stranger to
 * answer it, so this page says "there is no fixed timing, check back". If a
 * timing is ever set, it goes in the "what happens next" list in AskForm.
 *
 * THE FORM LIVES IN AskForm.tsx AND THE OUTCOME IS NO LONGER A URL FLAG. It
 * used to arrive as /ask?sent=1, ?sent=throttled and so on, which meant a
 * refused question came back to an empty box and a refresh redrew a message
 * for a question nobody had asked. Every one of those outcomes still exists,
 * with the same words; they are returned by the action and rendered in place
 * instead. See actions.ts and DECISIONS.md.
 */

export const metadata = { title: "Ask Yaadly · public Q&A" };

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
    /* worker_email is NOT selected, and that is the point rather than tidiness.
       This is a public page reading with the publishable key, so every column
       named here is a column a stranger is asking the database for. It was
       fetched and never rendered, which is the same shape of mistake
       20260903f closed on worker_profiles: a private column sitting on a row
       a visitor may read. The answering worker is deliberately anonymous on
       this page anyway, so nothing here ever wanted it. */
    ? await supabase.from("answers").select("question_id,body,created_at").in("question_id", ids).order("created_at")
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
        <h1 className="mt-2 font-display text-[clamp(28px,4.5vw,42px)] uppercase leading-none">Ask before you post a job</h1>
        <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-mute">
          Not sure if it is a job, a quick fix, or nothing to worry about? Ask
          here and vetted tradespeople answer in public, free.
        </p>
        <p className="mt-2.5 max-w-[62ch] rounded-xl border border-line bg-panel px-4 py-3 text-[13px] leading-relaxed text-mute">
          <b className="text-ink">Two ways to ask, and this is the public one.</b>{" "}
          Your question and its answers stay on this page where anyone can read
          them, and it is vetted workers who answer. No name, no email and no
          phone number is asked for, so leave those out of your question too.
          For anything about your own property, your own money or your own
          address, use the chat tab on the right instead. That one is private
          and a person replies to you.
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
