/* ── deadline.ts ──────────────────────────────────────────────────────────
 *
 * One clock for the whole request, because the reply has somewhere to be.
 *
 * THE NUMBER THAT MATTERS. Twilio waits about 15 seconds for a response to an
 * inbound message webhook. Past that it gives up, logs error 11200, and the
 * person who messaged gets nothing at all. From their side that is
 * indistinguishable from the message vanishing, which is the failure this
 * endpoint has already been bitten by twice for other reasons.
 *
 * WHAT WAS ACTUALLY IN THE FILE. Every slow step carried its own fixed
 * timeout, set in isolation, and they were nowhere near each other:
 * transcription 90 seconds, the model call 25, a media fetch 45, and three
 * notification pushes at 4 apiece, several of them awaited on the critical
 * path. Any one of the first three on its own is past Twilio's limit. A voice
 * note, which the file's own comment calls "how most of these actually
 * arrive", could not reliably be answered at all.
 *
 * Nothing was wrong with any individual number. They were each sensible for
 * the step they guarded. What was missing is that nobody owned the total.
 *
 * HOW THIS WORKS. One budget is taken at the top of the request. Every slow
 * step asks for a slice of what is left rather than naming its own timeout,
 * and says how much it wants to leave behind for the steps after it. A step
 * that would run past the budget is not started; the caller is told, and takes
 * the honest path instead of the good one.
 *
 * The point is not that things get faster. It is that when they are slow, the
 * function knows, and chooses what to drop. Dropping the polish and keeping
 * the reply is a decision. Running out of clock in the middle of a model call
 * and sending nothing is not.
 */

/** How long the whole request may take before Twilio stops listening.
 *
 *  Twilio's own limit is about 15 seconds. Twelve is the budget, leaving three
 *  for the response itself, the database writes after the model, and the
 *  ordinary variance of a cold edge function. Deliberately not 14: a budget
 *  that only just fits is a budget that does not. */
export const REQUEST_BUDGET_MS = 12_000;

export class Deadline {
  readonly startedAt: number;
  budgetMs: number;
  private readonly now: () => number;

  /** `now` is injectable so the tests can run a clock forward without
   *  sleeping. Nothing in production passes it. */
  constructor(budgetMs: number = REQUEST_BUDGET_MS, now: () => number = Date.now) {
    this.now = now;
    this.budgetMs = budgetMs;
    this.startedAt = now();
  }

  /** Milliseconds left in the budget. Never negative. */
  remaining(): number {
    return Math.max(0, this.budgetMs - (this.now() - this.startedAt));
  }

  /** How long a step may actually have.
   *
   *  `want` is what the step would like. `reserve` is what it must leave for
   *  everything after it. Returns 0 when there is not enough left to be worth
   *  starting, which the caller reads as "do not start this".
   *
   *  `floor` is the least amount of time that makes the step worth attempting
   *  at all: a model call given 400ms will fail, having spent 400ms failing,
   *  which is worse than not calling. */
  slice(want: number, reserve = 0, floor = 1_000): number {
    const usable = this.remaining() - reserve;
    if (usable < floor) return 0;
    return Math.min(want, usable);
  }

  /** True when there is no useful time left at all. */
  blown(): boolean {
    return this.remaining() <= 0;
  }

  /** An AbortSignal for a step, or null when the step should be skipped.
   *  Returning null rather than an already-aborted signal is deliberate: the
   *  caller has to look at it, and a null cannot be passed to fetch by
   *  accident and then behave like no timeout at all. */
  signal(want: number, reserve = 0, floor = 1_000): AbortSignal | null {
    const ms = this.slice(want, reserve, floor);
    return ms > 0 ? AbortSignal.timeout(ms) : null;
  }

  /** Give the request more room, once it is known that nobody is holding a
   *  fifteen second line open.
   *
   *  The budget exists because of Twilio, and only Twilio: an inbound message
   *  webhook is abandoned at about fifteen seconds and the sender gets
   *  nothing. A forwarded email has no such caller. Applying Twilio's limit to
   *  the email channel would drop a transcription or skip a model call to meet
   *  a deadline that does not exist, which is a worse job for no reason.
   *
   *  Only ever raises. A step that has already been told how long it has must
   *  not have it taken away underneath it. */
  raiseTo(ms: number): void {
    if (ms > this.budgetMs) (this as { budgetMs: number }).budgetMs = ms;
  }

  /** For the trace. How much of the budget a request actually used. */
  spentMs(): number {
    return this.now() - this.startedAt;
  }
}
