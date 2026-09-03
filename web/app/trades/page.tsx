import Link from "next/link";
import { TRADES } from "@/lib/taxonomy";
import { SiteNav } from "@/components/SiteNav";

/**
 * The trade-work information page.
 *
 * Repurposed 3 Sep 2026 from a client-facing "browse open jobs by trade"
 * board (moved to /jobs/trades, still linked from /jobs) into what this
 * route is actually for on the marketing side: the page a tradesperson lands
 * on to decide whether Yaadly is worth two minutes of their time, before
 * /apply asks for a passport. See DECISIONS.md.
 *
 * Every figure on this page is read from the current signed Worker
 * Guidelines (lib/legal-copy.json, WG v1.4) or from the Phase 1/2/3 copy in
 * app/apply/JoinFlow.tsx, not invented for this page. Two things worth
 * flagging back to Monique, found while writing this:
 *
 *  - JoinFlow's own send screen still says "paid within 24 hours." The
 *    signed Worker Guidelines (section 7, corrected in v1.3) say 3 working
 *    days, and say plainly that Yaadly is not holding client money yet, so a
 *    worker is paid once the client pays, through the route agreed on the
 *    job. This page follows the signed, more recent document. JoinFlow's
 *    copy looks stale against it and is outside this page's scope to fix.
 *  - There is no public figure anywhere for how many workers or jobs are on
 *    the board, so none is claimed here, per the brief.
 *
 * No application logic lives here. Every action funnels to the existing
 * /apply flow.
 */

export const metadata = { title: "Trade work with Yaadly · Yaadly" };

const BENEFITS: { h: string; p: string }[] = [
  {
    h: "Free to join, free to quote",
    p: "Nothing to join, nothing per quote, nothing per lead, win or lose. You're never charged for a job you don't get.",
  },
  {
    h: "You keep 88%",
    p: "Yaadly's fee is 12% of your agreed labour price, taken when you're paid. Remote digital work is 10%. Materials are never fee'd, at cost is at cost, and there's no subscription.",
  },
  {
    h: "You set your own price",
    p: "Yaadly doesn't price your work and never shows you a band to quote against. You quote, in writing, before you start.",
  },
  {
    h: "No tracking",
    p: "Evidence photos prove the work, not where you are. Location data is stripped before a photo is ever stored.",
  },
  {
    h: "Paid per stage",
    p: "Not one lump at the end. A stage signed off is a stage paid, once the client approves the evidence.",
  },
  {
    h: "A record you own",
    p: "Every completed, documented job builds your Yaad Score, a verified record that counts with clients and, in time, with a bank.",
  },
];

const EXPECTATIONS: string[] = [
  "Turn up when you said, or say so before the day, not on it.",
  "Every stage has a checklist. Document the site on arrival, materials with the receipt in the place the client named, and nothing gets covered before it's photographed.",
  "Extra work found on site is raised through Yaadly, in writing, with a price, before it's done. Unagreed work doesn't get paid.",
  "No side payments, ever, in either direction. It voids the protection for both of you.",
  "At the end of the job, you confirm the Completion Report matches what was actually done.",
];

export default function TradesInfo() {
  return (
    <>
      <SiteNav active="join" />
      <div className="mx-auto max-w-[1080px] px-5 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-purpleb">For tradespeople</p>
          <Link href="/jobs/new" className="text-[12.5px] font-semibold text-dim transition hover:text-purpleb">
            Looking to hire someone instead? Post a job &rarr;
          </Link>
        </div>
        <h1 className="mt-2 font-display text-[clamp(28px,4.5vw,42px)] uppercase leading-none">
          Work in Kingston &amp; Portmore, paid on proof
        </h1>
        <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-mute">
          Yaadly connects vetted tradespeople with property owners, most of them overseas, who need
          real work proven with evidence before money moves. This page is where you find out if
          that's for you. Applying is separate, and takes about two minutes.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {TRADES.map((t) => (
            <span key={t} className="rounded-full border border-purple/30 bg-purple/10 px-3 py-1.5 text-[12px] font-semibold text-purpleb">
              {t}
            </span>
          ))}
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-4">
          <Link href="/apply" className="rounded-full bg-linear-to-r from-purple to-gold px-6 py-3 text-[14px] font-bold text-white shadow-[0_0_20px_rgba(155,115,245,0.25)] transition hover:-translate-y-px hover:brightness-110">
            Apply now &rarr;
          </Link>
          <span className="text-[12.5px] text-dim">Free to join. About two minutes for the first screen.</span>
        </div>

        {/* ── benefits ─────────────────────────────────────────────── */}
        <h2 className="mt-14 font-display text-[clamp(20px,3vw,26px)] uppercase leading-none">
          What you get
        </h2>
        <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {BENEFITS.map((b) => (
            <div key={b.h} className="rounded-[18px] border border-line bg-panel p-5 transition hover:border-purple/40">
              <b className="block text-[14.5px]">{b.h}</b>
              <p className="mt-2 text-[13px] leading-relaxed text-mute">{b.p}</p>
            </div>
          ))}
        </div>

        {/* ── expectations ─────────────────────────────────────────── */}
        <h2 className="mt-14 font-display text-[clamp(20px,3vw,26px)] uppercase leading-none">
          What's expected of you
        </h2>
        <ul className="mt-5 space-y-3">
          {EXPECTATIONS.map((e) => (
            <li key={e} className="flex gap-3 rounded-xl border border-line bg-panel px-4 py-3.5 text-[13.5px] leading-relaxed text-mute">
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-purple" />
              {e}
            </li>
          ))}
        </ul>
        <p className="mt-4 max-w-[62ch] text-[13px] leading-relaxed text-dim">
          Jobs over £500, work inside an occupied home, and anything where you'd hold keys stay
          closed to you until your three references have actually been telephoned. That's most of
          the money on the board, so it's worth finishing that step early.
        </p>

        {/* ── fees & allocation ────────────────────────────────────── */}
        <h2 className="mt-14 font-display text-[clamp(20px,3vw,26px)] uppercase leading-none">
          Fees, and how work reaches you
        </h2>
        <div className="mt-5 grid grid-cols-1 gap-3.5 md:grid-cols-2">
          <div className="rounded-2xl border border-line bg-panel p-5 text-[13.5px] leading-relaxed text-mute">
            <b className="text-ink">What Yaadly charges you:</b> 12% of your agreed labour price on a
            completed job, taken at the point you're paid, so you keep 88%. Remote digital work
            carries 10% instead. Materials are never charged a fee.
            <p className="mt-2">
              <b className="text-ink">What you never pay:</b> joining, quoting, and leads, whether you
              win the job or not. There's no subscription.
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-panel p-5 text-[13.5px] leading-relaxed text-mute">
            <b className="text-ink">How a job reaches you:</b> clients post jobs against the same
            trades and parishes you pick on your profile. A job in a parish you haven't ticked never
            reaches you. You quote against the jobs you want; the client chooses who they engage.
          </div>
        </div>

        {/* ── independent work ─────────────────────────────────────── */}
        <h2 className="mt-14 font-display text-[clamp(20px,3vw,26px)] uppercase leading-none">
          Independent work, not employment
        </h2>
        <p className="mt-4 max-w-[62ch] text-[13.5px] leading-relaxed text-mute">
          You work as an independent tradesperson, not a Yaadly employee. You set your own price for
          each job in writing before you start, and your relationship with us runs on your TRN, not a
          payslip. Each job is its own agreement. There's no rota and no ongoing engagement beyond it.
        </p>

        {/* ── is work guaranteed ───────────────────────────────────── */}
        <h2 className="mt-14 font-display text-[clamp(20px,3vw,26px)] uppercase leading-none">
          Is work guaranteed?
        </h2>
        <p className="mt-4 max-w-[62ch] text-[13.5px] leading-relaxed text-mute">
          No. Yaadly is a marketplace, not an employer. Clients post real jobs by trade and parish,
          and you quote against the ones you want. You'll win some and lose others. Quoting is always
          free, so there's no cost to trying, but nothing here promises a set amount of work.
        </p>

        {/* ── what happens after ───────────────────────────────────── */}
        <h2 className="mt-14 font-display text-[clamp(20px,3vw,26px)] uppercase leading-none">
          What happens after you apply
        </h2>
        <ol className="mt-5 space-y-3">
          {[
            "Your profile is created the moment you send the first screen: your trades, your parishes, and one way to show your work — a CV, a portfolio, links, or photos of finished jobs. Any one of these is enough to start.",
            "A person at the Yaadly desk reads it, not a queue. You hear back within 24 hours.",
            "Verification comes next: government photo ID, a live photo and video taken on camera, your TRN, proof of address, and three references we call directly. We chase these over WhatsApp so you're not stuck waiting on a screen.",
            "Your profile goes public once those checks clear, not before, the same rule every worker on the board was held to.",
          ].map((s, i) => (
            <li key={s} className="flex gap-4 rounded-xl border border-line bg-panel px-4 py-4 text-[13.5px] leading-relaxed text-mute">
              <span className="grid size-6 shrink-0 place-items-center rounded-full border border-purple/35 bg-purple/10 font-mono-app text-[11px] font-bold text-purpleb">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>

        {/* ── final CTA ─────────────────────────────────────────────── */}
        <div className="relative mt-14 mb-4 overflow-hidden rounded-[18px] border border-line2 bg-linear-to-br from-purple/10 to-gold/[0.05] p-7">
          <span className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-[radial-gradient(ellipse,rgba(155,115,245,0.14)_0%,transparent_70%)]" />
          <div className="relative flex flex-wrap items-center justify-between gap-5">
            <div>
              <h3 className="font-display text-[clamp(20px,3vw,26px)] uppercase leading-none">
                Ready to get on the board?
              </h3>
              <p className="mt-2 max-w-[52ch] text-[13.5px] text-mute">
                Free to join, free to quote. The first screen takes about two minutes.
              </p>
            </div>
            <Link href="/apply" className="shrink-0 rounded-full bg-linear-to-r from-purple to-gold px-6 py-3 text-[14px] font-bold text-white shadow-[0_0_20px_rgba(155,115,245,0.25)] transition hover:-translate-y-px hover:brightness-110">
              Apply now &rarr;
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
