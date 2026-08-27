import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { STAGES_SVC, svcStage } from "@/lib/portal/journey";
import { PortalCard } from "@/components/portal/PortalCard";
import { ServiceNext } from "@/components/portal/ServiceNext";
import { StageRail } from "@/components/portal/StageRail";
import { CalBand } from "@/components/portal/CalBand";

export const dynamic = "force-dynamic";

/**
 * A service booking: no marketplace, no worker, Monique is the one doing the
 * work. Same portal, different kind of job inside it. RLS on the services
 * table scopes rows to the client's email, so this page carries no filter.
 */

// The stages a professional service moves through. `stage` on the row is an
// index into this list, matching how the old portal used it.
const TRACK = [
  ["Booked and paid", "Portal link and code sent the moment payment cleared"],
  ["Intake", "What is needed from you before the clock starts"],
  ["Documents received", "The 72 hour turnaround starts here, not at payment"],
  ["Desk work", "Checked against real material costs and day rates"],
  ["Draft with you", "You read it first. A wrong fact gets fixed before it is final"],
  ["Delivered", "PDF, signed, yours to keep"],
] as const;

export default async function ServiceRoom({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ s?: string; cal?: string; d?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");

  const { id } = await params;
  const { s: sParam, cal, d } = await searchParams;
  const supabase = await createClient();

  const { data: providerEmail } = await supabase.rpc("provider_email");

  const { data: svc } = await supabase
    .from("services")
    .select("id,type,parish,price,provider,stage,notes,updated_at,portal_code")
    .eq("id", id)
    .maybeSingle();

  if (!svc) notFound();

  const stage = Math.max(0, Math.min(svc.stage ?? 0, TRACK.length - 1));
  const current = svcStage(svc.stage);
  const viewing = (() => {
    const n = Number(sParam);
    return Number.isInteger(n) && n >= 0 && n < STAGES_SVC.length ? n : current;
  })();

  return (
    <>
      <Link
        href="/portal"
        className="text-[13px] text-tealb underline-offset-2 hover:underline"
      >
        &larr; All your jobs
      </Link>

      {typeof providerEmail === "string" && providerEmail && (
        <CalBand
          side="service"
          owner={providerEmail.toLowerCase()}
          jobId={svc.id}
          kind="service"
          base={"/portal/services/" + encodeURIComponent(svc.id)}
          cal={cal}
          sel={d}
          viewerEmail={(user.email ?? "").toLowerCase()}
        />
      )}

      <div className="mt-4 flex flex-wrap items-start gap-3">
        <h1 className="min-w-[240px] flex-1 font-display text-[clamp(24px,3.6vw,34px)] uppercase leading-none">
          {svc.type ?? "Professional service"}
        </h1>
        <span className="rounded-full border border-softline bg-soft px-3 py-1.5 text-[11.5px] font-bold text-tealb">
          {TRACK[stage][0]}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-3.5 text-[12.5px] text-dim">
        <span>{svc.id}</span>
        {svc.parish && <span>{svc.parish}</span>}
        {svc.price && <span>{svc.price}</span>}
        {svc.provider && <span>Carried out by {svc.provider}</span>}
      </div>

      <StageRail
        stages={STAGES_SVC}
        current={current}
        viewing={viewing}
        base={"/portal/services/" + encodeURIComponent(svc.id)}
      />

      <section className="mt-7">
        <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
          Where your service is up to
        </h2>
        <p className="mb-4 max-w-[62ch] text-[13px] leading-relaxed text-mute">
          The clock is visible so neither of us has to guess.
        </p>
        <ol className="grid gap-2.5">
          {TRACK.map(([name, detail], i) => {
            const state = i < stage ? "done" : i === stage ? "now" : "todo";
            return (
              <li
                key={name}
                className={
                  "rounded-2xl border px-4 py-3.5 " +
                  (state === "done"
                    ? "border-softline bg-soft"
                    : state === "now"
                      ? "border-mango/40 bg-mango/5"
                      : "border-line bg-panel opacity-60")
                }
              >
                <div className="flex flex-wrap items-center gap-3">
                  <b className="text-[14px]">{name}</b>
                  <span
                    className={
                      "ml-auto rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide " +
                      (state === "done"
                        ? "bg-tealb/15 text-tealb"
                        : state === "now"
                          ? "bg-mango/15 text-mango"
                          : "bg-panel2 text-dim")
                    }
                  >
                    {state === "done" ? "Done" : state === "now" ? "Now" : "To come"}
                  </span>
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-mute">
                  {detail}
                </p>
              </li>
            );
          })}
        </ol>
      </section>

      <PortalCard
        reference={svc.id}
        code={svc.portal_code ?? null}
        href={"app.yaadly.co.uk/portal/services/" + encodeURIComponent(svc.id)}
        kind="service"
      />

      {/* Only once it is finished. Before that, "what next" is noise on a
          page whose job is to show the clock. */}
      {current >= STAGES_SVC.length - 2 && (
        <section className="mt-7">
          <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-mango">
            Where this goes next
          </h2>
          <ServiceNext />
        </section>
      )}

      {svc.notes && (
        <section className="mt-7 rounded-2xl border border-line bg-panel p-5">
          <h2 className="mb-2 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
            Notes on your file
          </h2>
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-mute">
            {svc.notes}
          </p>
        </section>
      )}
    </>
  );
}
