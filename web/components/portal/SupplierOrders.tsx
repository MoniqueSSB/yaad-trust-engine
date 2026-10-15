"use client";

import { useState } from "react";
import { attachInvoice, confirmOrder, markCollected, markReady } from "@/app/portal/supplier-actions";
import { STEPS, orderLabel, orderTotal, stepOf, type SupplierOrder } from "@/lib/portal/supplier";
import { jmd } from "@/lib/money";

/**
 * The supplier's orders, one row each, opening into the order room.
 *
 * Everything a supplier is told here is about goods: what to set aside,
 * who collects, which code to expect, which invoice number to attach. The
 * money lines are read-only and come from the desk's stamps (sent_at,
 * sent_ref). The one piece of client information on the screen is the
 * parish, and the one piece of worker information is a first name.
 */
const input =
  "w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[13.5px] text-ink outline-none focus:border-teal";
const btn =
  "rounded-full bg-linear-to-r from-teal to-mango px-4.5 py-2.5 text-[13px] font-bold text-onbrand transition hover:brightness-110 disabled:opacity-50";
const quiet = "rounded-full border border-line2 px-4 py-2 text-[13px] font-bold text-mute transition hover:border-purple hover:text-purpleb";

const STORE: Record<string, string> = {
  lockable: "a lockable store on the property",
  indoors: "indoors at the property",
  none_available: "nowhere securable: the order is sized to this stage and surplus is taken away nightly",
};

function day(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function SupplierOrders({ orders, open }: { orders: SupplierOrder[]; open?: string }) {
  const [openId, setOpenId] = useState<string | null>(open ?? null);
  if (!orders.length) {
    return (
      <div className="rounded-2xl border border-line bg-panel p-6">
        <b className="text-[15px]">No orders yet</b>
        <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-mute">
          When Yaadly orders materials from you for a job it appears here, with the lines, the collector and what to do next.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-line bg-panel px-5">
      {orders.map((o) => {
        const l = orderLabel(o);
        const isOpen = openId === o.id;
        return (
          <div key={o.id} className="border-t border-line py-4 first:border-t-0">
            <button type="button" onClick={() => setOpenId(isOpen ? null : o.id)} className="flex w-full items-start gap-4 text-left">
              <div className="min-w-0 flex-1">
                <span className={"block font-mono-app text-[9.5px] font-semibold uppercase tracking-[.16em] " + (l.tone === "waiting" ? "text-goldb" : l.tone === "done" ? "text-green" : "text-dim")}>
                  {l.tone === "waiting" ? "Needs you first · " : ""}{l.text}
                </span>
                <b className="mt-1 block text-[15px] text-ink">{o.job_title || o.job_id}</b>
                <span className="mt-0.5 block text-[12.5px] text-mute">
                  <span className="font-mono-app text-purpleb">{o.job_id}</span>
                  {o.stage ? ` · stage ${o.stage}${o.stages ? ` of ${o.stages}` : ""}` : ""}
                  {o.parish ? ` · ${o.parish}` : ""}
                  {o.collector ? ` · collector ${o.collector}` : ""}
                </span>
              </div>
              <div className="shrink-0 text-right">
                <b className="block font-mono-app text-[14px] font-medium">{jmd(orderTotal(o))}</b>
                <span className="text-[11.5px] text-dim">{o.receipt_ref ? `your invoice ${o.receipt_ref}` : "no invoice attached"}</span>
              </div>
            </button>
            {isOpen ? <OrderRoom o={o} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function Steps({ o }: { o: SupplierOrder }) {
  const n = stepOf(o);
  return (
    <div className="mt-3 flex flex-wrap gap-1">
      {STEPS.map((st, i) => {
        const done = Boolean(o[st.key]);
        const now = !done && i === n;
        return (
          <span
            key={st.key}
            className={
              "rounded-md border px-2 py-0.5 text-[11px] " +
              (st.whose === "yaadly" ? "border-dashed " : "") +
              (done ? "border-green/30 bg-green/[0.06] text-green" : now ? "border-gold/40 bg-gold/[0.08] text-goldb" : "border-line text-dim")
            }
            title={st.whose === "yaadly" ? "A named person at Yaadly takes this step" : "Your step"}
          >
            {st.label}{done ? ` · ${day(o[st.key])}` : ""}
          </span>
        );
      })}
    </div>
  );
}

function OrderRoom({ o }: { o: SupplierOrder }) {
  const n = stepOf(o);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const who = o.collector || "the collector";
  const run = async (fn: (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>, fd: FormData) => {
    setBusy(true);
    setErr(null);
    fd.set("release", o.id);
    const out = await fn(fd);
    setBusy(false);
    if (!out.ok) setErr(out.error);
  };
  const lines = o.lines ?? [];

  return (
    <div className="mt-2">
      <Steps o={o} />
      <p className="mt-2 text-[12px] leading-relaxed text-dim">Dashed steps are taken by a named person at Yaadly. Solid steps are yours.</p>

      {lines.length ? (
        <table className="mt-4 w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-[.08em] text-dim">
              <th className="border-b border-line2 px-2 py-1.5 font-semibold">Line</th>
              <th className="border-b border-line2 px-2 py-1.5 text-right font-semibold">Qty</th>
              <th className="border-b border-line2 px-2 py-1.5 text-right font-semibold">Unit</th>
              <th className="border-b border-line2 px-2 py-1.5 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="border-b border-line px-2 py-1.5">{l.item}</td>
                <td className="border-b border-line px-2 py-1.5 text-right font-mono-app text-[12.5px]">{l.qty}</td>
                <td className="border-b border-line px-2 py-1.5 text-right font-mono-app text-[12.5px]">{jmd(Number(l.unit_jmd) || 0)}</td>
                <td className="border-b border-line px-2 py-1.5 text-right font-mono-app text-[12.5px]">{jmd((Number(l.qty) || 0) * (Number(l.unit_jmd) || 0))}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} className="px-2 py-1.5 text-right text-mute">Order total, your price, no mark-up to the client</td>
              <td className="px-2 py-1.5 text-right font-mono-app text-[12.5px] font-semibold">{jmd(orderTotal(o))}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="mt-3 text-[13px] text-mute">Order value {jmd(orderTotal(o))}. The lines were agreed with Yaadly by message.</p>
      )}

      <dl className="mt-4 grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-dim">Fulfilment</dt>
        <dd>{o.fulfilment === "delivery" ? "Deliver to site. The address is on the delivery note Yaadly sends you, not here." : "Collection at your counter."}</dd>
        <dt className="text-dim">Collector</dt>
        <dd>{who}, a Yaadly tradesperson. First name only.</dd>
        <dt className="text-dim">Collection code</dt>
        <dd>{o.fulfilment === "delivery" ? "Not used on a delivery. The site contact signs the note." : `Held by ${who}. They give it to you at the counter; it is not shown here.`}</dd>
        <dt className="text-dim">Goods go to</dt>
        <dd>{STORE[o.store_type ?? ""] ?? "the client's nominated store"}. {who} films them there, and that is what Yaadly matches before paying.</dd>
        <dt className="text-dim">Released by</dt>
        <dd>Yaadly, {day(o.released_at)}. A named person on the desk.</dd>
      </dl>

      <div className={"mt-4 rounded-xl border p-4 " + (n >= 1 && n <= 3 ? "border-gold/40 bg-gold/[0.05]" : "border-line bg-bg/40")}>
        {n <= 1 && (
          <>
            <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-goldb">Needs you first</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink">Confirm the price and stock on these lines. A confirmed order is what the client is told they are getting, at your price with nothing added. If something has changed, message Yaadly before confirming.</p>
            <form className="mt-3" action={(fd) => run(confirmOrder, fd)}>
              <button type="submit" disabled={busy} className={btn}>Confirm price and stock</button>
            </form>
          </>
        )}
        {n === 2 && (
          <>
            <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-goldb">Needs you first</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink">
              {o.fulfilment === "delivery" ? "Mark it out for delivery when it leaves. The site contact is told." : `Mark it ready when the goods are set aside. ${who} is then told to come with the code.`}
            </p>
            <form className="mt-3" action={(fd) => run(markReady, fd)}>
              <button type="submit" disabled={busy} className={btn}>{o.fulfilment === "delivery" ? "Mark out for delivery" : "Mark ready for collection"}</button>
            </form>
          </>
        )}
        {n === 3 && (
          <>
            <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-goldb">{o.fulfilment === "delivery" ? "On delivery" : "At the counter"}</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink">
              {o.fulfilment === "delivery"
                ? "Mark it delivered once the site contact has signed the note."
                : `Release the goods only to ${who}, and only against the code they give you. No code, no goods. Yaadly would rather you refused than guessed.`}
            </p>
            <form className="mt-3 flex flex-wrap items-end gap-3" action={(fd) => run(markCollected, fd)}>
              {o.fulfilment === "collection" ? (
                <label className="grid gap-1 text-[12.5px] font-bold text-mute">
                  Code given by {who}
                  <input name="code" className={input + " w-[140px] font-mono-app uppercase"} placeholder="YC-0000" autoComplete="off" required />
                </label>
              ) : null}
              <button type="submit" disabled={busy} className={btn}>{o.fulfilment === "delivery" ? "Mark delivered" : "Release goods"}</button>
            </form>
          </>
        )}
        {n === 4 && (
          <>
            <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-dim">Collected</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink">Yaadly is waiting for {who} to file the site evidence. {o.receipt_ref ? `Your invoice ${o.receipt_ref} is on the order.` : "Attach your invoice number now so it is on the statement when payment is recorded."}</p>
          </>
        )}
        {n === 5 && (
          <>
            <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-dim">Evidenced on site</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink">The goods have been evidenced in the client&apos;s store. Payment is the next step and it is Yaadly&apos;s, by bank transfer{o.receipt_ref ? `, against your invoice ${o.receipt_ref}.` : ". Attach your invoice number or payment waits."}</p>
          </>
        )}
        {n >= 6 && (
          <>
            <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-green">Paid</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink">Bank transfer {day(o.sent_at)}{o.sent_ref ? `, ref ${o.sent_ref}` : ""}{o.receipt_ref ? `, against your invoice ${o.receipt_ref}` : ""}.</p>
          </>
        )}
        {n >= 4 && !o.receipt_ref && (
          <form className="mt-3 flex flex-wrap items-end gap-3" action={(fd) => run(attachInvoice, fd)}>
            <label className="grid gap-1 text-[12.5px] font-bold text-mute">
              Your invoice number
              <input name="ref" className={input + " w-[180px]"} placeholder="e.g. INV-11899" maxLength={60} required />
            </label>
            <button type="submit" disabled={busy} className={quiet}>Attach</button>
          </form>
        )}
        {err ? <p role="alert" className="mt-3 text-[13px] leading-relaxed text-coral">{err}</p> : null}
      </div>
    </div>
  );
}
