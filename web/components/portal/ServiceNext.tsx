/**
 * What happens after a service closes, from the preview's `svcNext()`.
 *
 * Two routes, and the point of showing both is that neither is a upsell. A
 * client who buys one small honest thing and then keeps their own contractor
 * is a good outcome; the report they paid for is worth having either way.
 *
 * Shown only once the service is finished, because before that it is noise.
 */
export function ServiceNext() {
  return (
    <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-panel p-5">
          <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
            Route one
          </p>
          <h3 className="mt-2 text-[16px] font-bold">
            Take it to the marketplace
          </h3>
          <p className="mt-2 text-[13px] leading-relaxed text-mute">
            Your scope is already written and your exclusions already exist,
            they came out of the report. Post it and identity checked workers quote
            against that scope, not a vague description. The Works Agreement is
            half-drafted before anybody sees it.
          </p>
          <p className="mt-3.5">
            <a
              href="/jobs/new"
              className="inline-flex rounded-full border border-line2 px-4 py-2 text-[12.5px] font-bold transition hover:border-teal hover:text-tealb"
            >
              Post this job
            </a>
          </p>
        </div>

        <div className="rounded-2xl border border-mango/35 bg-mango/5 p-5">
          <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-mango">
            Route two
          </p>
          <h3 className="mt-2 text-[16px] font-bold">
            Keep your own contractor, add oversight
          </h3>
          <p className="mt-2 text-[13px] leading-relaxed text-mute">
            You already have someone and you want to keep them. The Oversight
            Retainer writes the stages and the evidence protocol at the first
            visit, then watches it fortnightly or weekly. Your contractor knows
            somebody is looking.
          </p>
          <p className="mt-3.5">
            <a
              href="https://yaadly.co.uk/services.html"
              className="inline-flex rounded-full border border-line2 px-4 py-2 text-[12.5px] font-bold transition hover:border-teal hover:text-tealb"
            >
              See the ladder
            </a>
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-softline bg-soft p-5">
        <p className="text-[13.5px] leading-relaxed text-mute">
          <b className="text-ink">Either one is a good outcome.</b> A service is
          where somebody who does not trust a marketplace yet can buy one small
          honest thing and find out whether it is worth listening to. Plenty of
          people will have their own contractor and never touch the board. That
          is fine. The report is worth having either way.
        </p>
      </div>
    </>
  );
}
