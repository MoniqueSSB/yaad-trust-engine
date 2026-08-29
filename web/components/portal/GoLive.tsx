import Link from "next/link";
import { goLive } from "@/app/portal/golive-actions";

/**
 * What this job still needs before a tradesperson can see it, and the link to
 * go and look at it once one can.
 *
 * Every gate below is enforced in Postgres and was, until this card existed,
 * enforced silently. A client posted a job, the job stopped at the first
 * unmet condition, and the screen showed a job room as though nothing were
 * wrong. Ten jobs sat that way. The rules were right; nothing said them out
 * loud.
 *
 * The order is the order the database applies them in, so a client working
 * top to bottom never clears a gate that a later one undoes:
 *
 *   1. client_go_live() needs auth.users.email_confirmed_at
 *   2. enforce_signed_before_open needs a doc_signatures row at the exact
 *      version in app_settings, and a client_profiles row
 *   3. enforce_store_before_open needs materials_store_nominated()
 *   4. open_jobs needs open = true, no worker, stage 0
 *
 * Deliberately not a progress bar. A client wants the name of the thing that
 * is stopping them and a way to do it, and four ticks with four links say
 * that where a percentage never could.
 */

export type Gate = {
  title: string;
  /** what this gate is for, in the client's terms, not the schema's */
  why: string;
  done: boolean;
  /** where to go and clear it; absent when the gate clears itself */
  href?: string;
  cta?: string;
};

export function GoLive({
  jobId,
  gates,
  live,
  marketplaceHref,
}: {
  jobId: string;
  gates: Gate[];
  live: boolean;
  marketplaceHref: string;
}) {
  /* Live is the good case and gets the short card. Once a job is on the board
     the checklist has nothing left to tell anybody, and leaving four ticks on
     screen forever would bury the one thing still worth a click. */
  if (live) {
    return (
      <section className="mt-5 rounded-2xl border border-softline bg-soft p-5">
        <h2 className="mb-2 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
          This job is live
        </h2>
        <p className="max-w-[62ch] text-[13.5px] leading-relaxed text-mute">
          Vetted tradespeople can see it and quote on it now. Your address and
          your phone number are not on the board, and neither is any budget.
        </p>
        <Link
          href={marketplaceHref}
          className="mt-4 inline-flex rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-[#04211D] transition hover:brightness-110"
        >
          See it live on the marketplace &rarr;
        </Link>
      </section>
    );
  }

  const outstanding = gates.filter((g) => !g.done);
  /* The next gate, not every gate. Sending somebody to confirm an email and
     nominate a store and sign a document in one breath is how a list of three
     becomes a list of none. */
  const next = outstanding[0];
  const ready = outstanding.length === 0;

  return (
    <section className="mt-5 rounded-2xl border border-mango/30 bg-mango/10 p-5">
      <h2 className="font-display text-[17px] uppercase leading-none">
        {ready
          ? "This job is ready for the marketplace"
          : "Not on the marketplace yet"}
      </h2>

      <p className="mt-3 max-w-[62ch] text-[13.5px] leading-relaxed text-mute">
        {ready
          ? "Everything it needs is done. Put it on the board and vetted tradespeople can start quoting."
          : outstanding.length === 1
            ? "One thing is missing. Until it is done no tradesperson can see this job."
            : `${outstanding.length} things are missing. Until they are all done no tradesperson can see this job.`}
      </p>

      <ul className="mt-4 grid gap-2">
        {gates.map((g) => (
          <li
            key={g.title}
            className={
              "flex items-start gap-3 rounded-xl border px-3.5 py-3 " +
              (g.done
                ? "border-softline bg-soft"
                : "border-line2 bg-bg")
            }
          >
            <span
              aria-hidden
              className={
                "mt-0.5 grid size-5 flex-none place-items-center rounded-full text-[11px] font-bold " +
                (g.done
                  ? "bg-tealb/20 text-tealb"
                  : "border border-line2 text-dim")
              }
            >
              {g.done ? "✓" : ""}
            </span>
            <span className="min-w-0 flex-1">
              <b
                className={
                  "block text-[13.5px] leading-snug " +
                  (g.done ? "text-mute" : "text-ink")
                }
              >
                {g.title}
              </b>
              <span className="mt-0.5 block text-[12px] leading-snug text-dim">
                {g.done ? "Done" : g.why}
              </span>
            </span>
            {!g.done && g.href && g.cta && (
              <Link
                href={g.href}
                className="flex-none self-center rounded-full border border-line2 px-3.5 py-1.5 text-[12px] font-bold text-ink transition hover:border-teal hover:text-tealb"
              >
                {g.cta}
              </Link>
            )}
          </li>
        ))}
      </ul>

      {ready ? (
        <form action={goLive} className="mt-4">
          <input type="hidden" name="jobId" value={jobId} />
          <button className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-[#04211D] transition hover:brightness-110">
            Put this job on the marketplace
          </button>
        </form>
      ) : (
        next?.href &&
        next.cta && (
          <Link
            href={next.href}
            className="mt-4 inline-flex rounded-full bg-linear-to-r from-teal to-mango px-5 py-2.5 text-[13px] font-bold text-[#04211D] transition hover:brightness-110"
          >
            {next.cta}
          </Link>
        )
      )}

      <p className="mt-3 text-[12px] leading-relaxed text-dim">
        Nothing is charged at any point on this list, and you are not
        committing to any quote.
      </p>
    </section>
  );
}
