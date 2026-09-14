/**
 * A quote's payment stages, read the way the database reads them.
 *
 * The worker types one stage per line, "Stage name: 30%: what proves it is
 * done". Since 13 Sep 2026 the accepted quote's stages ARE the job's stage
 * schedule: they decide how many stages the job has and what the worker is
 * owed as each one is approved. So a quote whose stages cannot be read is
 * refused before it is sent, not discovered after it is booked.
 *
 * This is the twin of parse_payment_stages() in Postgres
 * (20260913230001_the_accepted_quote_writes_the_stage_schedule.sql). Same
 * line shape, same limits. Change one, change the other. The difference is
 * only that this one says which line is wrong, because a person reads it.
 */

export type PaymentStage = { stage: string; proportion_percent: number; evidence_note: string };

export type ParsedStages =
  | { ok: true; stages: PaymentStage[] }
  | { ok: false; error: string };

/* A stage name may not contain a colon, because the colon is the separator.
   The proof may. Up to two decimal places on the percentage. */
const LINE = /^([^:]*[^:\s])\s*:\s*(\d{1,3}(?:\.\d{1,2})?)\s*%\s*:\s*(.*\S)\s*$/;

const SHAPE = "Stage name: 30%: what proves it is done";

export function parsePaymentStages(text: string | null | undefined): ParsedStages {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");

  if (lines.length === 0) {
    return { ok: false, error: `Add your payment stages, one per line, like: ${SHAPE}.` };
  }
  if (lines.length > 10) {
    return { ok: false, error: "Keep it to ten payment stages or fewer." };
  }

  const stages: PaymentStage[] = [];
  for (const [i, line] of lines.entries()) {
    const m = LINE.exec(line);
    if (!m) {
      const shown = line.length > 40 ? line.slice(0, 40) + "…" : line;
      return {
        ok: false,
        error: `Payment stage line ${i + 1} ("${shown}") needs the shape ${SHAPE}.`,
      };
    }
    const pct = Number(m[2]);
    if (!(pct > 0)) {
      return { ok: false, error: `Payment stage line ${i + 1} needs a percentage above 0.` };
    }
    stages.push({ stage: m[1].trim(), proportion_percent: pct, evidence_note: m[3] });
  }

  const total = Math.round(stages.reduce((sum, s) => sum + s.proportion_percent, 0) * 100) / 100;
  if (total !== 100) {
    return {
      ok: false,
      error: `Your payment stages add up to ${total}. Between them they need to add up to 100, the whole price.`,
    };
  }
  return { ok: true, stages };
}
