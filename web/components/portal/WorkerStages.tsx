"use client";

import { useState } from "react";
import { submitMyTrn } from "@/app/portal/trn-actions";

/**
 * What a worker still has to do, in the order it matters to them. Founder,
 * 25 Oct 2026: a profile stage that puts them live on the job board, an ID
 * stage before they can quote, and the TRN just before their first payment.
 * Every line comes from my_worker_stages(), their own row only, and nothing
 * here can pass a stage: a person at Yaadly does that on the desk.
 */
export type Stages = {
  live: boolean; id_checked: boolean; has_email: boolean; id_ok: boolean; signed: boolean;
  refs_or_video: boolean; trn_status: string; application_id: string; upload_token: string; app_ref: string;
};

function Row({ done, what, why }: { done: boolean; what: string; why: string }) {
  return (
    <li className="flex items-start justify-between gap-3 border-b border-line py-3 last:border-b-0">
      <span>
        <b className="block text-[14px] font-semibold text-ink">{what}</b>
        <span className="text-[12.5px] leading-relaxed text-dim">{why}</span>
      </span>
      <span className={"shrink-0 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold " + (done ? "bg-green/15 text-green" : "bg-purple/15 text-purpleb")}>
        {done ? "Done" : "Needed"}
      </span>
    </li>
  );
}

export function WorkerStages({ s }: { s: Stages }) {
  const [trnBusy, setTrnBusy] = useState(false);
  const [trnErr, setTrnErr] = useState<string | null>(null);
  const [trnSent, setTrnSent] = useState(false);

  const link = `/apply?app=${encodeURIComponent(s.application_id)}&token=${encodeURIComponent(s.upload_token)}&ref=${encodeURIComponent(s.app_ref)}`;
  const idStageReady = s.has_email && s.id_ok && s.signed && s.refs_or_video;

  return (
    <div className="mt-6 grid gap-4">
      {!s.id_checked && (
        <section className="rounded-2xl border border-line bg-panel p-5" aria-labelledby="ws-quote">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="ws-quote" className="font-display text-[20px] font-medium">Before you can quote</h2>
            {s.live && <span className="rounded-full bg-green/15 px-2.5 py-0.5 text-[11.5px] font-semibold text-green">Profile live on the job board</span>}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-mute">
            {idStageReady
              ? "Everything is in. A person at Yaadly is checking it, usually within a day, and you will hear the moment you can quote."
              : "Every item marked Needed has to be done. A person at Yaadly checks them, usually within a day."}
          </p>
          <ul className="mt-2">
            <Row done={s.has_email} what="Your email" why="You sign in with it to quote. We send you a code, there is no password." />
            <Row done={s.id_ok} what="ID check" why="Your photo ID and a selfie, through Persona." />
            <Row done={s.signed} what="Sign the Guidelines" why="How Yaadly jobs work, and how you get paid." />
            <Row done={s.refs_or_video} what="Referees or a skills video" why="Three people who will vouch for you, or a short video of you talking through your work. One of the two." />
          </ul>
          {!idStageReady && (
            <a href={link} className="mt-4 inline-block rounded-full bg-linear-to-r from-teal to-mango px-5 py-3 text-[14px] font-bold text-onbrand transition hover:brightness-110">
              Do my ID stage
            </a>
          )}
        </section>
      )}

      {s.id_checked && s.trn_status !== "approved" && (
        <section className="rounded-2xl border border-line bg-panel p-5" aria-labelledby="ws-trn">
          <h2 id="ws-trn" className="font-display text-[20px] font-medium">Before your first payment</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-mute">
            You are paid by bank transfer within 7 days of sign off. Before the first one we need your TRN: your invoice to Yaadly is raised against it.
          </p>
          {s.trn_status === "pending" || trnSent ? (
            <p role="status" className="mt-3 text-[13.5px] text-ink">Your TRN is with Yaadly. A person checks it against the name on your ID.</p>
          ) : (
            <form
              className="mt-3 grid gap-3 sm:max-w-[360px]"
              autoComplete="off"
              action={async (fd) => {
                setTrnBusy(true);
                setTrnErr(null);
                const out = await submitMyTrn(fd);
                setTrnBusy(false);
                if (!out.ok) return setTrnErr(out.error);
                setTrnSent(true);
              }}
            >
              <label className="grid gap-1.5 text-[13px] font-semibold text-ink">
                Your TRN, nine digits from your TRN card
                {s.trn_status === "rejected" && <span className="text-[12.5px] font-normal text-coral">The last one did not match your ID. Check it and send it again.</span>}
                <input name="trn" inputMode="numeric" required placeholder="123456789" className="jin" />
              </label>
              <button type="submit" disabled={trnBusy} className="rounded-full bg-linear-to-r from-teal to-mango px-5 py-3 text-[14px] font-bold text-onbrand transition hover:brightness-110 disabled:opacity-50">
                {trnBusy ? "Sending" : "Send my TRN"}
              </button>
              {trnErr && <p role="alert" className="text-[12.5px] text-coral">{trnErr}</p>}
            </form>
          )}
        </section>
      )}
    </div>
  );
}
