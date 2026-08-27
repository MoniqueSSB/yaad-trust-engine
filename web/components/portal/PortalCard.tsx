/**
 * The portal link card, from the preview's `portalCard()`.
 *
 * The reference, the link and the access code, together, so a client can find
 * their way back without hunting through an inbox. The code is the key and it
 * opens this one job: no password to remember, and nothing that works on
 * anybody else's.
 *
 * The preview shows a made-up reference. This reads the real `portal_code`,
 * and if a row has none it says so rather than printing a code that will not
 * open anything.
 */
export function PortalCard({
  reference,
  code,
  href,
  kind,
}: {
  reference: string;
  code: string | null;
  href: string;
  kind: "job" | "service";
}) {
  return (
    <section className="mt-4 rounded-2xl border border-softline bg-soft p-5">
      <h2 className="mb-3 text-[10.5px] font-bold uppercase tracking-[.2em] text-mango">
        Your portal link
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[13px]">
        <dt className="text-mute">Reference</dt>
        <dd className="text-right font-mono text-tealb">{reference}</dd>
        <dt className="text-mute">Portal link</dt>
        <dd className="truncate text-right font-mono text-tealb">{href}</dd>
        <dt className="text-mute">Access code</dt>
        <dd className="text-right font-mono">
          {code ?? <span className="text-dim">not issued yet</span>}
        </dd>
      </dl>
      <p className="mt-3 text-[13px] leading-relaxed text-mute">
        {code
          ? "Sent to you when this " +
            (kind === "service" ? "service was booked" : "job was created") +
            ", before anything started. No password to remember; the code is the key and it only opens this one " +
            kind +
            "."
          : "A code is issued when this " +
            kind +
            " is set up. Until then, reach it by signing in here."}
      </p>
    </section>
  );
}
