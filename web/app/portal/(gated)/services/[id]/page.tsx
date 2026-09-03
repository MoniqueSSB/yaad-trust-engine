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

/* Its own title, so two job tabs are two different words in the tab strip.
   The id rather than the job's name because it is already on the page, it is
   what the client quotes when they message, and reading it costs no query. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: `${id} · Yaadly` };
}

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

  // RLS (invoices_client_read) already refuses a draft to anyone but an
  // admin, so what reaches this query is exactly what this client is
  // allowed to see: nothing here needs its own status filter to be safe,
  // only to be readable.
  const { data: invoiceRows } = await supabase
    .from("invoices")
    .select("id,status,period_label,notes,total_pence,issue_date,due_date,sent_at,paid_at")
    .eq("service_id", svc.id)
    .order("issue_date", { ascending: false });
  const invoices = (invoiceRows ?? []) as {
    id: string; status: string; period_label: string; notes: string;
    total_pence: number; issue_date: string; due_date: string;
    sent_at: string | null; paid_at: string | null;
  }[];
  const gbp = (pence: number) => "£" + (pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // The booking's Kickoff Pack. RLS only returns an approved pack to the
  // client, so its mere presence here means it is ready to read; while it
  // is being drafted or edited this stays null and the section stays off.
  const { data: pack } = await supabase
    .from("kickoff_packs")
    .select("id,rev,updated_at")
    .eq("service_id", svc.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

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

      {pack && (
        <section className="mt-7">
          <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
            Your Kickoff Pack
          </h2>
          <Link
            href={"/portal/services/" + encodeURIComponent(svc.id) + "/pack"}
            className="flex items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3.5 transition hover:border-teal"
          >
            <span className="text-[18px]">📄</span>
            <span>
              <b className="block text-[14px] text-ink">The plan for this booking</b>
              <span className="block text-[12.5px] text-mute">
                Scope, timeline, what you will see as proof, and what is needed
                from you · rev {pack.rev ?? 1}
              </span>
            </span>
            <span className="ml-auto text-tealb">&rarr;</span>
          </Link>
        </section>
      )}

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

      {/* Word for word with docs/payments.html's own "Paying for a report
          or a retainer" section. That page is the public, canonical
          statement of these terms; this is the same text where a client
          who has actually booked can read it against their own invoice,
          not just in the abstract. Keep the two in sync by hand if either
          changes - there is no shared source between the static
          marketing site and this app to drift-check them automatically,
          the same limitation legal-copy.json's own versioning exists to
          solve for signed documents, which this is not. */}
      <section className="mt-7 rounded-2xl border border-line bg-panel p-5">
        <h2 className="mb-2 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
          How you pay, and how we know it landed
        </h2>
        <div className="grid gap-3 text-[13px] leading-relaxed text-mute">
          <p>
            <b className="text-ink">By bank transfer, against an invoice we send you</b>, in
            whichever of GBP, USD or CAD suits you. We do not take card
            details over the phone or in a message, and we do not send a
            payment link.
          </p>
          <p>
            <b className="text-ink">The account details on that invoice are the only ones we
            will ever give you.</b> We will never change them by phone, email
            or WhatsApp part way through a job. If a message asks you to pay
            a different account, do not pay it. Check with us first, through
            this site&apos;s contact form or the WhatsApp number you already
            have for us, not by replying to the message that asked.
          </p>
          <p>
            <b className="text-ink">Reports under £200 are paid in full before we start.</b>{" "}
            £200 and over is half before we start and half on delivery. The
            Oversight Retainer is billed monthly, and you can cancel with 30
            days notice.
          </p>
          <p>
            <b className="text-ink">We check the account ourselves</b> and start work once the
            payment has actually arrived, not once it has been sent. That is
            usually within one working day.
          </p>
          <p>
            Cancellation and refund terms for these reports are being
            finalised with legal advice, and will be added here before they
            are needed.
          </p>
        </div>
      </section>

      {/* RLS (invoices_client_read) already refuses a draft to anyone but
          an admin, so every row that reaches this page is genuinely this
          client's own. Sits right after the terms above on purpose: read
          the rule, then see it applied to your own invoice. */}
      {invoices.length > 0 && (
        <section className="mt-7">
          <h2 className="mb-1 text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
            Your invoices
          </h2>
          <p className="mb-4 max-w-[62ch] text-[13px] leading-relaxed text-mute">
            Each one follows the payment terms above; the note on it says
            exactly which part.
          </p>
          <ul className="grid gap-2.5">
            {invoices.map((inv) => (
              <li
                key={inv.id}
                className="rounded-2xl border border-line bg-panel p-4"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <b className="font-mono text-[13px]">{inv.id}</b>
                  <span
                    className={
                      "rounded-full border px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide " +
                      (inv.status === "paid"
                        ? "border-softline bg-soft text-tealb"
                        : inv.status === "void"
                          ? "border-line text-dim"
                          : "border-mango/40 bg-mango/5 text-mango")
                    }
                  >
                    {inv.status}
                  </span>
                  {inv.period_label && (
                    <span className="text-[12px] text-dim">{inv.period_label}</span>
                  )}
                  <span className="ml-auto text-[15px] font-bold text-tealb">
                    {gbp(inv.total_pence)}
                  </span>
                </div>
                {inv.notes && (
                  <p className="mt-2 text-[13px] leading-relaxed text-mute">{inv.notes}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-3.5 text-[11.5px] text-dim">
                  <span>Issued {inv.issue_date}</span>
                  <span>Due {inv.due_date}</span>
                  {inv.paid_at && <span>Paid {inv.paid_at.slice(0, 10)}</span>}
                </div>
              </li>
            ))}
          </ul>
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
