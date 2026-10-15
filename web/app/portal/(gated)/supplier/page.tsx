import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { SupplierOrders } from "@/components/portal/SupplierOrders";
import { statement, waitingOnSupplier, type SupplierOrder } from "@/lib/portal/supplier";
import { jmd } from "@/lib/money";

// Never cached. A portal showing a stale order is worse than a slow one.
export const dynamic = "force-dynamic";

/**
 * The supplier portal.
 *
 * A third portal behind the same door as the client's and the worker's,
 * for a hardware merchant Yaadly buys materials from on account
 * (20261015120000). It answers one question: what has Yaadly ordered from
 * me, what do I do next, and what have I been paid.
 *
 * Nothing on this page is filtered by this file. my_supplier_orders() is
 * scoped by auth.uid() in Postgres and returns no client column at all, so a
 * mistake here is an empty list rather than somebody else's address.
 *
 * Money on this page is read-only. Releasing, matching the goods to the
 * site evidence and marking an invoice paid are a named person's clicks on
 * the desk; the supplier moves goods, never money.
 */
export const metadata = { title: "Supplier portal · Yaadly" };

export default async function SupplierPortal() {
  const user = await getUser();
  if (!user) redirect("/portal/sign-in");

  const supabase = await createClient();

  // Attaches this sign-in to the supplier row that carries its email, once.
  // A no-op for everybody else, same shape as bind_my_portal_claims().
  const { data: supplierId } = await supabase.rpc("bind_my_supplier");
  if (!supplierId) redirect("/portal");

  const [{ data: sup }, { data: rows, error }] = await Promise.all([
    supabase.from("suppliers").select("name,parish,account_ref").eq("id", supplierId).maybeSingle(),
    supabase.rpc("my_supplier_orders"),
  ]);
  const orders = (rows ?? []) as SupplierOrder[];
  const waiting = orders.filter(waitingOnSupplier);
  const st = statement(orders);

  return (
    <>
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Supplier portal</p>
      <h1 className="mt-2 font-display text-[clamp(26px,4vw,38px)] uppercase leading-none">{sup?.name ?? "Your orders"}</h1>
      <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-mute">
        Each order is one Yaadly job and one stage. You confirm it, hand the goods to the named collector who gives you the
        code, and attach your invoice number. Yaadly pays by bank transfer once the goods have been evidenced on site.
        {sup?.account_ref ? ` Your account reference is ${sup.account_ref}.` : ""}
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-coral">Could not read your orders: {error.message}</p>
      ) : null}

      <div className="mt-7 grid gap-5 lg:grid-cols-[1fr_300px]">
        <div>
          <SupplierOrders orders={orders} open={waiting[0]?.id} />
        </div>
        <aside className="grid content-start gap-3">
          <div className="grid grid-cols-2 gap-2.5">
            <Tile n={String(waiting.length)} label="waiting on you" tone={waiting.length ? "gold" : ""} />
            <Tile n={String(orders.filter((o) => o.collected_at && !o.sent_at).length)} label="collected, not yet paid" />
            <Tile n={jmd(st.owed)} label="owed to you" small />
            <Tile n={jmd(st.paid)} label="paid to you" small tone="green" />
          </div>
          <div className="rounded-2xl border border-line bg-panel p-4">
            <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Your account</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-mute">
              Yaadly pays by bank transfer within 7 days of the goods being evidenced on site, against the invoice number you
              attach to the order. Your bank details are taken by telephone and confirmed back to you. They are never typed
              here and never sent on WhatsApp. If anybody asks for them in a message, say no and tell Yaadly.
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-panel p-4">
            <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Questions</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-mute">
              Price and availability before an order, a change on an order, anything about your account: message Yaadly on
              WhatsApp and quote the job reference. A quote in a message places no order; a person at Yaadly does that here.
            </p>
            <a
              href="https://wa.me/447878877567"
              target="_blank"
              rel="noopener"
              className="mt-3 inline-block rounded-full border border-line2 px-4 py-2 text-[12.5px] font-bold text-mute transition hover:border-purple hover:text-purpleb"
            >
              Message Yaadly
            </a>
          </div>
        </aside>
      </div>

      <section className="mt-8">
        <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Statement</p>
        <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-mute">
          Your invoices against Yaadly&apos;s orders, and what has been paid, so the two sets of books reconcile without a
          phone call.
        </p>
        <Statement orders={orders} />
      </section>
    </>
  );
}

function Tile({ n, label, tone = "", small = false }: { n: string; label: string; tone?: string; small?: boolean }) {
  const box = tone === "gold" ? "border-gold/30 bg-gold/[0.06]" : tone === "green" ? "border-green/25 bg-green/[0.05]" : "border-line bg-bg/40";
  return (
    <div className={"rounded-xl border p-3 " + box}>
      <b className={"block font-display font-normal leading-none " + (small ? "text-[17px] pt-1" : "text-[26px]")}>{n}</b>
      <span className="mt-1.5 block text-[11.5px] text-mute">{label}</span>
    </div>
  );
}

function Statement({ orders }: { orders: SupplierOrder[] }) {
  type Row = { at: string; what: string; ref: string; inv: number; paid: number; by: string };
  const rows: Row[] = [];
  for (const o of orders) {
    const where = `${o.job_id}${o.stage ? ` · stage ${o.stage}` : ""}`;
    if (o.receipt_ref && o.collected_at) rows.push({ at: o.receipt_at ?? o.collected_at, what: `Your invoice ${o.receipt_ref} against the order on ${where}`, ref: o.receipt_ref, inv: Number(o.amount_jmd) || 0, paid: 0, by: "you" });
    if (o.sent_at) rows.push({ at: o.sent_at, what: `Paid to you by bank transfer${o.sent_ref ? `, ref ${o.sent_ref}` : ""}, ${where}`, ref: o.receipt_ref ?? "", inv: 0, paid: Number(o.amount_jmd) || 0, by: "Yaadly" });
  }
  rows.sort((a, b) => a.at.localeCompare(b.at));
  if (!rows.length) return <p className="mt-3 text-[13px] text-dim">No entries yet. An entry appears when you attach an invoice to a collected order, and when Yaadly pays it.</p>;
  const day = (ts: string) => {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };
  return (
    <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-panel">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-[.08em] text-dim">
            <th className="border-b border-line2 px-3 py-2 font-semibold">Date</th>
            <th className="border-b border-line2 px-3 py-2 font-semibold">Entry</th>
            <th className="border-b border-line2 px-3 py-2 text-right font-semibold">Invoiced</th>
            <th className="border-b border-line2 px-3 py-2 text-right font-semibold">Paid</th>
            <th className="border-b border-line2 px-3 py-2 font-semibold">Recorded by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="border-b border-line px-3 py-2 font-mono-app text-[12px] text-dim">{day(r.at)}</td>
              <td className="border-b border-line px-3 py-2">{r.what}</td>
              <td className="border-b border-line px-3 py-2 text-right font-mono-app text-[12.5px]">{r.inv ? jmd(r.inv) : ""}</td>
              <td className="border-b border-line px-3 py-2 text-right font-mono-app text-[12.5px]">{r.paid ? jmd(r.paid) : ""}</td>
              <td className="border-b border-line px-3 py-2 text-[12px] text-dim">{r.by}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
