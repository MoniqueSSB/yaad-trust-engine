"use client";

/* ── Ask a Yaad, the form ──────────────────────────────────────────────────
 *
 * A client component for four reasons, each of which was a real fault in the
 * server-only version it replaces:
 *
 *   1. A failed submit used to lose everything typed. The action hands the
 *      text back and the panel is reseeded from it, so the box still has the
 *      question in it.
 *   2. The button could be tapped over and over with nothing to say it had
 *      been heard. The pending flag disables it and says "Sending".
 *   3. Success was a URL flag, ?sent=1, which meant a refresh or a shared
 *      link drew "Received" for a question nobody had asked. Success is now
 *      a state on this component and it dies with the page.
 *   4. Nothing was ever announced. Errors now land in a live region and the
 *      field is marked invalid.
 *
 * WHY THERE ARE TWO COMPONENTS HERE, because the obvious single one does not
 * work and the way it fails is quiet. React 19 clears an uncontrolled form
 * after an action runs, so the returned text has to be put back deliberately.
 * Copying it into local state inside an effect renders the form twice on
 * every submit; copying it during the render throws "cannot update a
 * component while rendering a different component", because the state that
 * changed belongs to the router, not to us. So the panel is keyed on the
 * moment the result was made: a new answer from the server is a new mount,
 * and useState seeds itself from that answer the ordinary way. Both of those
 * failures were seen on this file on 3 September 2026, the second in the
 * browser, so please do not fold this back into one component.
 *
 * The counter and the contact-details check run as you type, from the same
 * module the server action uses, so what stops the submit and what warns you
 * cannot disagree.
 */

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { PARISHES } from "@/lib/taxonomy";
import { askQuestion } from "@/app/ask/actions";
import { ASK_IDLE, BODY_MAX, BODY_MIN, AREA_MAX, hasContactDetails, type AskState } from "@/lib/ask";

export function AskForm() {
  /* pending is the third value from useActionState, and it is what stops the
     same question being asked three times by somebody on a slow connection
     tapping a button that looked dead. */
  const [state, formAction, pending] = useActionState<AskState, FormData>(askQuestion, ASK_IDLE);
  return <AskPanel key={state.at} state={state} formAction={formAction} pending={pending} />;
}

function AskPanel({
  state,
  formAction,
  pending,
}: {
  state: AskState;
  formAction: (formData: FormData) => void;
  pending: boolean;
}) {
  const bodyId = useId();
  const areaId = useId();
  const bodyHelpId = `${bodyId}-help`;
  const areaHelpId = `${areaId}-help`;
  const errId = `${bodyId}-err`;

  // Seeded from the result this panel was mounted for, so a refused submit
  // comes back with the question still in the box.
  const [body, setBody] = useState(state.body);
  const [area, setArea] = useState(state.area);
  // Set when somebody asks for the form back after a successful send. It
  // starts false again on the next result, because that is a new mount.
  const [again, setAgain] = useState(false);

  // Focus the field the message is about, so a keyboard or screen reader user
  // is put where the fix is rather than told about it and left at the bottom.
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const areaRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.status !== "error") return;
    (state.field === "area" ? areaRef.current : bodyRef.current)?.focus();
  }, [state.status, state.field]);

  const trimmed = body.trim();
  const left = BODY_MAX - trimmed.length;
  const tooShort = trimmed.length > 0 && trimmed.length < BODY_MIN;
  const tooLong = trimmed.length > BODY_MAX;
  const leaking = trimmed.length > 0 && hasContactDetails(trimmed);
  const blocked = trimmed.length < BODY_MIN || tooLong || leaking;
  /* One flag for "there is something to say about this field", so the
     message, the aria-describedby and the invalid mark cannot disagree. */
  const showProblem = state.status === "error" || leaking;

  if (state.status === "sent" && !again) {
    return (
      <div className="mt-6 rounded-2xl border border-softline bg-soft p-5" role="status">
        <p className="text-[15px] font-bold text-ink">Got it.</p>
        <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-mute">
          Your question is with us. A person reads it before it goes on the
          board, so it is not public yet.
        </p>
        {state.sentBody && (
          <blockquote className="mt-3 border-l-2 border-softline pl-3 text-[13.5px] leading-relaxed text-ink">
            {state.sentBody}
          </blockquote>
        )}
        <div className="mt-4 flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => setAgain(true)}
            className="rounded-full border border-line2 px-4 py-2.5 text-[13px] font-bold text-ink transition hover:border-teal"
          >
            Ask another question
          </button>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-dim">
          If you need a private answer about your own property, use Ask
          Yaadly, the chat tab on the right, and a person replies to you
          directly.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-6 rounded-2xl border border-line bg-panel p-5">
      {/* ── the question ─────────────────────────────────────────────── */}
      <label htmlFor={bodyId} className="block text-[13px] font-bold text-ink">
        What do you want to know?
      </label>
      <p id={bodyHelpId} className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-dim">
        Ask it the way you would ask a friend who knows trades. One question at
        a time gets the best answer.
      </p>
      <textarea
        id={bodyId}
        ref={bodyRef}
        name="body"
        rows={4}
        required
        maxLength={BODY_MAX}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-describedby={`${bodyHelpId}${showProblem ? ` ${errId}` : ""}`}
        aria-invalid={showProblem && state.field !== "area" ? true : undefined}
        placeholder="e.g. Is it normal for a plumber to ask for all the money before starting?"
        /* 16px, not smaller: anything under it makes an iPhone zoom the page
           on focus and the visitor has to pinch back out to find the button. */
        className="mt-2.5 w-full resize-y rounded-xl border border-line bg-bg px-3.5 py-3 text-[16px] leading-relaxed text-ink outline-none focus:border-teal"
      />
      <p className="mt-1.5 text-[11.5px] text-dim">
        {trimmed.length === 0
          ? `Between ${BODY_MIN} and ${BODY_MAX} characters.`
          : tooShort
            ? `${BODY_MIN - trimmed.length} more character${BODY_MIN - trimmed.length === 1 ? "" : "s"} to go.`
            : `${left} character${left === 1 ? "" : "s"} left.`}
      </p>

      {/* ── the area ─────────────────────────────────────────────────── */}
      <label htmlFor={areaId} className="mt-5 block text-[13px] font-bold text-ink">
        Where is the property?{" "}
        <span className="font-normal text-dim">(optional)</span>
      </label>
      <p id={areaHelpId} className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-dim">
        A parish or a town is enough. Answers and prices differ between
        Kingston and Mandeville, so this helps the right tradesperson answer.
        No street addresses, this board is public.
      </p>
      <input
        id={areaId}
        ref={areaRef}
        name="area"
        list={`${areaId}-parishes`}
        maxLength={AREA_MAX}
        value={area}
        onChange={(e) => setArea(e.target.value)}
        aria-describedby={areaHelpId}
        aria-invalid={state.status === "error" && state.field === "area" ? true : undefined}
        placeholder="e.g. Portmore"
        className="mt-2.5 w-full rounded-xl border border-line bg-bg px-3.5 py-3 text-[16px] text-ink outline-none focus:border-teal sm:w-64"
      />
      {/* Suggestions, never a restriction: the column is free text and
          somebody's answer may be a town this list has never heard of. */}
      <datalist id={`${areaId}-parishes`}>
        {PARISHES.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      {/* ── anything wrong ───────────────────────────────────────────── */}
      <div id={errId} role="alert">
        {showProblem && (
          <p className="mt-4 rounded-xl border border-coral/40 bg-coral/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
            {state.status === "error"
              ? state.message
              : "That looks like a phone number or email address. This board is public, so leave those out. For a private reply use Ask Yaadly, the chat tab on the right."}
          </p>
        )}
      </div>

      {/* ── what happens next, before the button, not after it ───────── */}
      <div className="mt-5 rounded-xl border border-line bg-bg px-4 py-3.5">
        <p className="text-[12px] font-bold uppercase tracking-[.13em] text-dim">
          What happens after you send it
        </p>
        <ol className="mt-2.5 grid gap-2 text-[13px] leading-relaxed text-mute">
          <li>
            <b className="text-ink">1.</b> A person at Yaadly reads your
            question. Nothing publishes on its own.
          </li>
          <li>
            <b className="text-ink">2.</b> If it is about property work in
            Jamaica and carries no personal details, it goes up on this board.
          </li>
          <li>
            <b className="text-ink">3.</b> Vetted tradespeople answer publicly
            and the answer appears under your question. There is no fixed
            timing for that, so check back.
          </li>
        </ol>
      </div>

      <div className="mt-4">
        <button
          type="submit"
          disabled={pending || blocked}
          className="w-full rounded-full bg-linear-to-r from-teal to-mango px-5 py-3 text-[15px] font-bold text-onbrand transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {pending ? "Sending your question…" : "Ask the tradespeople"}
        </button>
      </div>

      <p className="mt-3 text-[11.5px] leading-relaxed text-dim">
        Free, and nothing you type here is a job or a commitment.
      </p>
    </form>
  );
}
