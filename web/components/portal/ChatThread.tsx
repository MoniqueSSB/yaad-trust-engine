"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendMessage } from "@/app/portal/job-actions";

/**
 * In-portal chat, PORTAL-SPEC 5.4. The scrub already ran on everything
 * rendered here (server side, on render) and runs again on send. A blocked
 * detail is named, never silently dropped.
 */
export function ChatThread({
  jobId,
  messages,
  self,
}: {
  jobId: string;
  messages: { id: string; mine: boolean; body: string; at: string }[];
  self: string;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [warn, setWarn] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  return (
    <section className="mt-8 rounded-2xl border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-panel2 px-4 py-3">
        <b className="text-[13.5px]">Job chat · {jobId}</b>
        <span className="rounded-full border border-line bg-panel px-2.5 py-1 text-[10.5px] font-bold text-mute">On Yaadly only</span>
        <span className="ml-auto text-[11px] text-dim">No numbers, no emails, no handles</span>
      </div>
      <div className="flex max-h-[320px] flex-col gap-2 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-[12.5px] text-dim">No messages yet. Ask anything; it stays on the record.</p>
        )}
        {messages.map((m) => (
          <div key={m.id}
            className={"max-w-[82%] rounded-[13px] border px-3 py-2 text-[13px] leading-relaxed " +
              (m.mine ? "self-end rounded-br-[5px] border-softline bg-soft" : "self-start rounded-bl-[5px] border-line bg-panel2")}>
            {m.body}
            <span className="mt-1 block text-[10px] text-dim">{m.at}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-line px-4 py-3">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim() || busy) return;
            setBusy(true);
            try {
              const { hits } = await sendMessage(jobId, text);
              setWarn(hits);
              setText("");
              router.refresh();
            } catch { setWarn(["send failed, try again"]); }
            setBusy(false);
          }}
          className="flex gap-2"
        >
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1500}
            placeholder={"Message as " + self}
            className="flex-1 rounded-xl border border-line2 bg-bg px-3 py-2.5 text-[13.5px] text-ink outline-none focus:border-teal" />
          <button disabled={busy} className="rounded-full bg-linear-to-r from-teal to-mango px-4 py-2 text-[13px] font-bold text-onbrand disabled:opacity-40">Send</button>
        </form>
        {warn.length > 0 && (
          <p role="status" className="mt-2.5 rounded-xl border border-coral/30 bg-coral/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-mute">
            <b className="text-coral">Held back: {warn.join(", ")}.</b>{" "}
            That never reached them. Keeping it on Yaadly is what makes the
            held money, the evidence trail and the dispute route work; off the
            platform none of that exists, for either of you.
          </p>
        )}
        <p className="mt-2.5 text-[11px] leading-relaxed text-dim">
          Everything stays here until the job is done. Not to hold you
          hostage: if it happens off Yaadly there is no held money, no
          evidence trail and nothing to fall back on when it goes wrong.
        </p>
      </div>
    </section>
  );
}
