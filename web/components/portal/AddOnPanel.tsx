"use client";

/* Extra work on a booked job, the "Extra work" tab of the job room.
 *
 * Founder decisions, 28 Sep 2026 (20260928235000): the client writes the
 * extra work, the amount and how it is paid; the tradesperson accepts it,
 * changes it or turns it down; a change goes back to the client; nothing is
 * booked until both have agreed the same version. Once agreed it is billed
 * as its own invoice on the job and the job cannot finish until it is done
 * and approved by the client on its photos (or, as a fallback, signed off at
 * the desk).
 *
 * Every rule lives in Postgres. This only shows where each add-on stands and
 * offers the one move that belongs to the person reading it. */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { jmd } from "@/lib/money";
import {
  TERMS_LABEL, addonClientBill, addonStateLine, addonWorkerPay, waitingOn,
  type AddonStatus, type AddonTerms, type Side,
} from "@/lib/jobs/addon";
import { agreeAddon, approveAddon, declineAddon, editAddon, proposeAddon, uploadAddonEvidence } from "@/app/portal/addon-actions";

export type AddonRow = {
  id: string;
  rev: number;
  scope: string;
  amount_jmd: number;
  terms: AddonTerms;
  status: AddonStatus;
  last_edit_side: Side;
  history: { rev: number; scope: string; amount_jmd: number; terms: AddonTerms; by: Side; at: string }[] | null;
  closed_reason: string | null;
  signed_off_at: string | null;
  created_at: string;
};

/** A photograph filed on an add-on, with a short-lived signed URL. */
export type AddonPhoto = { id: string; label: string | null; img: string | null; created_at: string };

export type AddonInvoice = { id: string; addon_id: string; status: string; total_pence: number | null; payable_to: string | null; period_label: string | null };

const CHIP: Record<AddonStatus, string> = {
  with_worker: "border-mango/40 bg-mango/10 text-mango",
  with_client: "border-mango/40 bg-mango/10 text-mango",
  agreed: "border-teal bg-soft text-tealb",
  signed_off: "border-teal bg-soft text-tealb",
  declined: "border-line bg-panel2 text-dim",
  withdrawn: "border-line bg-panel2 text-dim",
  cancelled: "border-line bg-panel2 text-dim",
};

const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

function AddonForm({
  me, initial, submitLabel, onSubmit, onCancel, otherName,
}: {
  me: Side;
  initial: { scope: string; amount: string; terms: AddonTerms };
  submitLabel: string;
  onSubmit: (v: { scope: string; amount: string; terms: AddonTerms }) => Promise<string | null>;
  onCancel: () => void;
  otherName: string;
}) {
  const [scope, setScope] = useState(initial.scope);
  const [amount, setAmount] = useState(initial.amount);
  const [terms, setTerms] = useState<AddonTerms>(initial.terms);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const n = Math.round(Number(amount.replace(/[^0-9.]/g, "")) || 0);
  const bill = addonClientBill(n, terms);

  async function go() {
    setBusy(true); setError("");
    const err = await onSubmit({ scope, amount, terms });
    if (err) { setError(err); setBusy(false); }
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-panel2 p-4">
      <label className="block">
        <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[.14em] text-dim">What is the extra work?</span>
        <textarea
          value={scope} onChange={(e) => setScope(e.target.value)} maxLength={1500} rows={4}
          placeholder="For example: paint the hallway ceiling as well, two coats, same colour as the walls."
          className="w-full rounded-lg border border-line2 bg-bg px-3 py-2 text-[13px] leading-relaxed text-ink"
        />
      </label>
      <label className="mt-3 block">
        <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[.14em] text-dim">
          {me === "client" ? "Amount you are offering for the work (J$)" : "Your amount for the work (J$)"}
        </span>
        <input
          value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="25000"
          className="w-48 rounded-lg border border-line2 bg-bg px-3 py-2 text-[13px] text-ink"
        />
      </label>
      <fieldset className="mt-3">
        <legend className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[.14em] text-dim">How it is paid</legend>
        {(Object.keys(TERMS_LABEL) as AddonTerms[]).map((t) => (
          <label key={t} className="mb-1 flex items-center gap-2 text-[13px] text-ink">
            <input type="radio" name="terms" checked={terms === t} onChange={() => setTerms(t)} />
            {TERMS_LABEL[t]}{t === "in_full" ? " (default)" : ""}
          </label>
        ))}
      </fieldset>
      {n > 0 && (
        <p className="mt-2 max-w-[60ch] text-[12.5px] leading-snug text-mute">
          {me === "client"
            ? <>You would pay <b className="text-ink">{jmd(bill.total)}</b>: {jmd(n)} for the work and {jmd(bill.fee)} Guarantee &amp; Support (15%) on top.</>
            : <>You would be paid <b className="text-ink">{jmd(addonWorkerPay(n))}</b>: {jmd(n)} less Yaadly&apos;s 5%.</>}
        </p>
      )}
      <p className="mt-2 max-w-[60ch] text-[11.5px] leading-snug text-dim">
        This goes to {otherName}. Nothing is booked until you have both agreed the same version. Phone numbers and emails are taken out, because contact stays on Yaadly.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={go} disabled={busy || !scope.trim() || n <= 0}
          className="rounded-full border border-teal bg-soft px-4 py-1.5 text-[12.5px] font-bold text-tealb transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? "Sending…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="text-[12px] font-bold text-mute underline underline-offset-2">Cancel</button>
      </div>
      {error && <p className="mt-2 text-[12.5px] text-coral">{error}</p>}
    </div>
  );
}

/** The client's sign-off on finished extra work (20260929050000). A tick
 *  first, the same as a stage: approving is a signature. Used on the Extra
 *  work tab and on Approvals. */
export function AddonApprove({ jobId, addonId, amountLabel, otherName }: { jobId: string; addonId: string; amountLabel: string; otherName: string }) {
  const router = useRouter();
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="mt-3 rounded-xl border border-mango/40 bg-mango/[.07] p-3.5">
      <p className="text-[13px] font-bold text-ink">Is the extra work done as agreed?</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-mute">
        Approving is your signature on it. It pays {otherName} {amountLabel} for this work through Yaadly. If something is not right, do not approve: message Yaadly from the Help tab instead.
      </p>
      <label className="mt-2 flex items-start gap-2 text-[12.5px] text-mute">
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-0.5" />
        I have looked at the photos and the extra work is done as agreed.
      </label>
      {error && <p role="alert" className="mt-2 text-[12.5px] text-coral">{error}</p>}
      <button
        type="button"
        disabled={!sure || busy}
        onClick={async () => {
          setBusy(true); setError("");
          const r = await approveAddon(jobId, addonId);
          setBusy(false);
          if (!r.ok) { setError(r.error); return; }
          router.refresh();
        }}
        className="mt-2.5 rounded-full bg-linear-to-r from-teal to-mango px-4.5 py-2 text-[13px] font-bold text-onbrand disabled:opacity-40"
      >
        {busy ? "Approving…" : "Approve this extra work"}
      </button>
    </div>
  );
}

function AddonCard({
  a, me, otherName, jobId, invoices, evidenceCount, photos,
}: {
  a: AddonRow; me: Side; otherName: string; jobId: string; invoices: AddonInvoice[]; evidenceCount: number; photos: AddonPhoto[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit" | "decline">("view");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [label, setLabel] = useState("");

  const turn = waitingOn(a.status);
  const mine = turn === me;
  const open = turn !== null;
  const bill = addonClientBill(a.amount_jmd, a.terms);
  const clientInv = invoices.filter((i) => i.payable_to !== "worker");
  const paid = clientInv.some((i) => i.status === "paid");

  async function run(p: Promise<{ ok: boolean; error?: string }>) {
    setBusy(true); setError("");
    const r = await p;
    if (!r.ok) { setError(r.error ?? "That did not go through."); setBusy(false); return; }
    setMode("view"); setBusy(false); router.refresh();
  }

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("jobId", jobId); fd.set("addonId", a.id); fd.set("label", label);
    await run(uploadAddonEvidence(fd));
    setLabel("");
    (e.target as HTMLFormElement).reset();
  }

  return (
    <article className="mt-3 rounded-2xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={"rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[.08em] " + CHIP[a.status]}>
          {addonStateLine(a.status, me, otherName)}
        </span>
        <span className="text-[11.5px] text-dim">Version {a.rev} · written {day(a.created_at)}</span>
      </div>

      <p className="mt-3 max-w-[62ch] whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{a.scope}</p>

      <dl className="mt-3 grid max-w-[560px] grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px]">
        <dt className="text-dim">Agreed amount for the work</dt><dd className="text-ink">{jmd(a.amount_jmd)}</dd>
        {me === "client" ? (
          <><dt className="text-dim">You pay, with 15% on top</dt><dd className="font-bold text-ink">{jmd(bill.total)}</dd></>
        ) : (
          <><dt className="text-dim">You are paid, less 5%</dt><dd className="font-bold text-ink">{jmd(addonWorkerPay(a.amount_jmd))}</dd></>
        )}
        <dt className="text-dim">How it is paid</dt><dd className="text-ink">{TERMS_LABEL[a.terms]}</dd>
      </dl>

      {open && a.rev > 1 && a.last_edit_side !== me && (
        <p className="mt-2 text-[12px] text-mango">{otherName} changed this. Check it before you accept.</p>
      )}

      {/* The one move that belongs to the reader. */}
      {open && mine && mode === "view" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={() => run(agreeAddon(jobId, a.id, a.rev))}
            className="rounded-full border border-teal bg-soft px-4 py-1.5 text-[12.5px] font-bold text-tealb transition hover:brightness-110 disabled:opacity-50">
            {busy ? "Saving…" : "Accept this version"}
          </button>
          <button type="button" disabled={busy} onClick={() => setMode("edit")} className="rounded-full border border-line2 px-4 py-1.5 text-[12.5px] font-bold text-ink">Change it</button>
          <button type="button" disabled={busy} onClick={() => setMode("decline")} className="text-[12px] font-bold text-mute underline underline-offset-2">Turn it down</button>
        </div>
      )}
      {open && !mine && mode === "view" && (
        <div className="mt-3">
          <button type="button" disabled={busy} onClick={() => setMode("decline")} className="text-[12px] font-bold text-mute underline underline-offset-2">Withdraw it</button>
        </div>
      )}
      {mode === "edit" && (
        <AddonForm me={me} otherName={otherName} submitLabel={"Send the change to " + otherName}
          initial={{ scope: a.scope, amount: String(a.amount_jmd), terms: a.terms }}
          onCancel={() => setMode("view")}
          onSubmit={async (v) => {
            const r = await editAddon(jobId, a.id, a.rev, v.scope, v.amount, v.terms);
            if (!r.ok) return r.error;
            setMode("view"); router.refresh(); return null;
          }} />
      )}
      {mode === "decline" && (
        <div className="mt-3 rounded-xl border border-line bg-panel2 p-3.5">
          <label className="block">
            <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[.14em] text-dim">Why (optional)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
              className="w-full rounded-lg border border-line2 bg-bg px-3 py-2 text-[13px] text-ink" />
          </label>
          <div className="mt-2.5 flex gap-2">
            <button type="button" disabled={busy} onClick={() => run(declineAddon(jobId, a.id, reason))}
              className="rounded-full border border-coral/50 px-4 py-1.5 text-[12.5px] font-bold text-coral disabled:opacity-50">
              {mine ? "Turn it down" : "Withdraw it"}
            </button>
            <button type="button" onClick={() => setMode("view")} className="text-[12px] font-bold text-mute underline underline-offset-2">Cancel</button>
          </div>
        </div>
      )}

      {a.status === "agreed" && (
        <div className="mt-3 rounded-xl border border-line bg-panel2 p-3.5 text-[12.5px] leading-relaxed text-mute">
          {clientInv.length === 0 && <p>Yaadly is preparing the invoice for this add-on.</p>}
          {clientInv.length > 0 && !paid && (
            me === "client"
              ? <p>Its invoice is on the <a href="?tab=money" className="font-bold text-tealb underline-offset-2 hover:underline">Money</a> tab once Yaadly sends it. The extra work starts once it is paid.</p>
              : <p>The extra work starts once the client has paid its invoice. You will see it here.</p>
          )}
          {paid && (
            <>
              {me === "worker" ? (
                <p><b className="text-ink">Paid. The extra work can start.</b> File photos of it here. The client approves it on these photos, then Yaadly pays you.</p>
              ) : (
                <p><b className="text-ink">Paid. The extra work can start.</b> The tradesperson files photos of it here, and you approve it on them.</p>
              )}
              <p className="mt-1">{evidenceCount} photo{evidenceCount === 1 ? "" : "s"} filed on this add-on.</p>
              {/* The client was shown a count and never the photos until
                  28 Sep 2026, so there was nothing to approve on. */}
              {photos.length > 0 && (
                <ul className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {photos.map((ph) => (
                    <li key={ph.id} className="overflow-hidden rounded-lg border border-line bg-panel">
                      {ph.img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={ph.img} alt={ph.label ?? "Photo of the extra work"} className="h-28 w-full object-cover" />
                      ) : (
                        <div className="grid h-28 place-items-center text-[11px] text-dim">No image</div>
                      )}
                      <p className="px-2 py-1 text-[11px] leading-snug text-mute">{ph.label ?? "Photo"} · {day(ph.created_at)}</p>
                    </li>
                  ))}
                </ul>
              )}
              {me === "client" && evidenceCount > 0 && (
                <AddonApprove jobId={jobId} addonId={a.id} amountLabel={jmd(a.amount_jmd)} otherName={otherName} />
              )}
              {me === "worker" && (
              <form onSubmit={upload} className="mt-2.5 flex flex-wrap items-center gap-2">
                <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required className="text-[12px] text-ink" />
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="What this shows" maxLength={300}
                  className="w-56 rounded-lg border border-line2 bg-bg px-3 py-1.5 text-[12.5px] text-ink" />
                <button type="submit" disabled={busy} className="rounded-full border border-teal bg-soft px-4 py-1.5 text-[12.5px] font-bold text-tealb disabled:opacity-50">
                  {busy ? "Filing…" : "File photo"}
                </button>
              </form>
              )}
            </>
          )}
        </div>
      )}
      {a.status === "signed_off" && <p className="mt-3 text-[12.5px] text-mute">Approved on {day(a.signed_off_at)}.</p>}
      {(a.status === "declined" || a.status === "withdrawn" || a.status === "cancelled") && a.closed_reason && (
        <p className="mt-3 text-[12.5px] text-mute">Reason given: {a.closed_reason}</p>
      )}

      {(a.history ?? []).length > 0 && (
        <details className="mt-3 text-[12px] text-dim">
          <summary className="cursor-pointer font-bold">Earlier versions ({(a.history ?? []).length})</summary>
          {(a.history ?? []).slice().reverse().map((h) => (
            <div key={h.rev} className="mt-2 border-l-2 border-line pl-3">
              <div>Version {h.rev}, from {h.by === me ? "you" : h.by === "client" ? "the client" : "the tradesperson"}: {jmd(h.amount_jmd)}, {TERMS_LABEL[h.terms].toLowerCase()}</div>
              <div className="whitespace-pre-wrap text-mute">{h.scope}</div>
            </div>
          ))}
        </details>
      )}
      {error && <p className="mt-2 text-[12.5px] text-coral">{error}</p>}
    </article>
  );
}

export function AddOnPanel({
  jobId, me, otherName, canPropose, closedReason, addons, invoices, evidenceCounts, photos = {},
}: {
  photos?: Record<string, AddonPhoto[]>;
  jobId: string;
  me: Side;
  otherName: string;
  /** client only, and only while the job is under way (propose_addon_as_me) */
  canPropose: boolean;
  /** why nothing can be added, when that is the case */
  closedReason: string | null;
  addons: AddonRow[];
  invoices: AddonInvoice[];
  evidenceCounts: Record<string, number>;
}) {
  const router = useRouter();
  const [writing, setWriting] = useState(false);
  const open = addons.filter((a) => a.status === "with_worker" || a.status === "with_client" || a.status === "agreed");
  const agreedTotal = addons.filter((a) => a.status === "agreed" || a.status === "signed_off")
    .reduce((t, a) => t + (me === "client" ? addonClientBill(a.amount_jmd, a.terms).total : addonWorkerPay(a.amount_jmd)), 0);

  return (
    <section className="mt-6">
      <h2 className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">Extra work</h2>
      <p className="mt-2 max-w-[64ch] text-[13px] leading-relaxed text-mute">
        Work that is not in the agreed scope is added here as an add-on. The client writes it with the amount they are offering;
        the tradesperson accepts it, changes it or turns it down; a change goes back to the client. Nothing is booked until you
        have both agreed the same version. The agreed scope and stages of the job do not change.
      </p>
      {open.length > 0 && (
        <p className="mt-2 max-w-[64ch] text-[12.5px] font-bold text-mango">
          The job cannot finish until {open.length === 1 ? "this add-on is" : "these add-ons are"} settled, and any agreed work is done and signed off.
        </p>
      )}
      {agreedTotal > 0 && (
        <p className="mt-2 text-[12.5px] text-mute">
          Agreed add-ons so far: <b className="text-ink">{jmd(agreedTotal)}</b> {me === "client" ? "including Yaadly's 15%" : "to you, after Yaadly's 5%"}, on top of the main job.
        </p>
      )}

      {me === "client" && canPropose && !writing && (
        <button type="button" onClick={() => setWriting(true)}
          className="mt-3 rounded-full border border-teal bg-soft px-4 py-1.5 text-[12.5px] font-bold text-tealb transition hover:brightness-110">
          + Add extra work
        </button>
      )}
      {me === "client" && !canPropose && closedReason && <p className="mt-3 text-[12.5px] text-dim">{closedReason}</p>}
      {writing && (
        <AddonForm me="client" otherName={otherName} submitLabel={"Send to " + otherName}
          initial={{ scope: "", amount: "", terms: "in_full" }}
          onCancel={() => setWriting(false)}
          onSubmit={async (v) => {
            const r = await proposeAddon(jobId, v.scope, v.amount, v.terms);
            if (!r.ok) return r.error;
            setWriting(false); router.refresh(); return null;
          }} />
      )}

      {addons.length === 0 && !writing && (
        <p className="mt-4 text-[13px] text-dim">
          {me === "client" ? "No extra work on this job." : "No extra work on this job. If you find something outside the scope, stop, and tell Yaadly with photos so the client can add it on."}
        </p>
      )}
      {addons.map((a) => (
        <AddonCard key={a.id} a={a} me={me} otherName={otherName} jobId={jobId}
          invoices={invoices.filter((i) => i.addon_id === a.id)} evidenceCount={evidenceCounts[a.id] ?? 0} photos={photos[a.id] ?? []} />
      ))}
    </section>
  );
}
