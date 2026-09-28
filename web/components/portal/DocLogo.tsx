/**
 * The Yaadly mark at the top of a document the client or worker keeps
 * (Completion Report, Kickoff Pack). Founder instruction, 28 Sep 2026: every
 * document carries the logo. The same image the desk's reports carry
 * (LOGO in supabase/functions/yaad-sketch/logo.ts), served from this app so
 * the PDF made in the browser can draw it.
 */
export function DocLogo() {
  return (
    <div className="flex items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static mark, drawn into the browser-made PDF */}
      <img src="/yaadly-logo.png" alt="Yaadly" width={30} height={30} className="h-[30px] w-[30px]" />
      <span className="font-display text-[19px] leading-none text-ink">Yaad<span className="text-goldb">ly</span></span>
    </div>
  );
}
