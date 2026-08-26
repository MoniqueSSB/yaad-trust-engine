import { SiteNav } from "@/components/SiteNav";
import { submitApplication } from "./actions";

export const dynamic = "force-dynamic";

/** Worker application: free to join, reviewed personally, nobody reaches a
 * client's gate unverified. Writes to the same applications table the desk
 * reads. */

const TRADES = ["Plumbing","Roofing","Electrical","Tiling","Masonry & Concrete","Painting & Decorating","Grille & Gate Welding","Air Conditioning","Landscaping","General Handyman","Solar Install","Water Tank & Pump","Locks & Security Doors","Windows & Glazing","Carpentry & Joinery","Drainage & Septic","Fencing","CCTV & Alarms"];
const PARISHES = ["Kingston","St Andrew","St Catherine","Clarendon","Manchester","St Elizabeth","Westmoreland","Hanover","St James","Trelawny","St Ann","St Mary","Portland","St Thomas"];

export const metadata = { title: "Join as a worker · Yaadly" };

export default async function Apply({
  searchParams,
}: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;
  const F = "w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[14px] text-ink outline-none focus:border-teal";
  const LBL = "mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-dim";
  return (
    <>
      <SiteNav active="market" />
      <div className="mx-auto max-w-[760px] px-5 py-10">
        <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-mango">For tradespeople</p>
        <h1 className="mt-2 font-display text-[clamp(28px,4.5vw,42px)] uppercase leading-none">Apply to join Yaadly</h1>
        <p className="mt-3 text-[14.5px] leading-relaxed text-mute">
          Joining is free. Quoting is free. No lead fees, ever. Yaadly takes
          12% of your labour price on completed work, so you keep 88%. Every
          application is reviewed personally: ID on a video call, references
          called, and a trial job before a first client.
        </p>
        {sent ? (
          <div className="mt-6 rounded-2xl border border-softline bg-soft p-5 text-[14px] leading-relaxed text-mute">
            <b className="text-tealb">Application received.</b> You will hear
            back on WhatsApp. Next comes the ID video call, then your
            references, then a trial job with an independent reviewer on
            site, at Yaadly&apos;s cost.
          </div>
        ) : (
          <form action={submitApplication} className="mt-6 grid gap-4 rounded-2xl border border-line bg-panel p-5 sm:grid-cols-2">
            <label><span className={LBL}>Full name</span><input name="name" required className={F} /></label>
            <label><span className={LBL}>WhatsApp number</span><input name="phone" required placeholder="876..." className={F} /></label>
            <label><span className={LBL}>Email</span><input name="email" type="email" required className={F} /></label>
            <label><span className={LBL}>Parish</span>
              <select name="parish" className={F}>{PARISHES.map((p) => <option key={p}>{p}</option>)}</select></label>
            <label><span className={LBL}>Your trade</span>
              <select name="trade" className={F}>{TRADES.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label><span className={LBL}>Years at it</span><input name="years" className={F} /></label>
            <label className="sm:col-span-2"><span className={LBL}>Your work: links or a line about past jobs</span>
              <textarea name="work" rows={3} className={F} /></label>
            <label><span className={LBL}>Reference 1, name and phone</span><input name="ref1" className={F} /></label>
            <label><span className={LBL}>Reference 2, name and phone</span><input name="ref2" className={F} /></label>
            <p className="text-[12px] leading-relaxed text-dim sm:col-span-2">
              Tell your references we will call. A name that was never asked
              is not a reference. A JCF police record check is mandatory for
              any job over £500, work inside an occupied home, or holding
              keys.
            </p>
            <label className="flex items-start gap-2.5 text-[13px] leading-relaxed text-mute sm:col-span-2">
              <input type="checkbox" name="consent" required className="mt-0.5 size-4 accent-teal" />
              I consent to Yaadly verifying my identity, my references and my
              past work.
            </label>
            <button className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-3 text-[14px] font-bold text-[#04211D] sm:col-span-2">
              Send my application
            </button>
          </form>
        )}
      </div>
    </>
  );
}
