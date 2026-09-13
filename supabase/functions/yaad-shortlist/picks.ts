// The shortlist agent's pure parts: what it is told, and what it is allowed
// to answer. Kept out of index.ts so picks_test.ts can prove the rules with
// no network and no database.
//
// The rules, in one place:
//   1. The model may only pick from the candidates it was given. A name it
//      invents, or an email it was not shown, is dropped.
//   2. It may pick fewer than asked. It may never pick more.
//   3. Every reason is screened by the same banned-language scan as every
//      other outbound sentence. A dirty reason is replaced by the database's
//      own plain match reason, not repaired.
//   4. If the answer is unusable, the database ranking stands in, and the
//      rows say so (source = 'rank'), so nobody reads a ranking as a
//      judgement.

export type Candidate = {
  worker_email: string;
  name: string;
  trade: string | null;
  parish: string | null;
  areas: string | null;
  lane: string | null;
  years: number | null;
  jobs_completed: number | null;
  about: string | null;
  slug: string | null;
  match_reason: string;
  rank_score: number;
};

export type Pick = {
  worker_email: string;
  worker_name: string;
  rank: number;
  reason: string;
  source: "model" | "rank";
};

export type JobForPrompt = {
  id: string;
  title: string | null;
  trade: string | null;
  job_type: string | null;
  parish: string | null;
  urgency: string | null;
  access_type: string | null;
  size_band: string | null;
  descr: string | null;   // already scrubbed by board_descr(): what the board shows
};

export const SYSTEM = `You help a property services company in Jamaica decide which of its vetted tradespeople to ASK TO QUOTE on a job. You are choosing who gets invited to price the work. You are not choosing who does the work, you are not setting a price, and you never mention money, cost, rates or how long the job will take.

You will be given the job as the client described it, and a numbered list of candidate tradespeople with their published profile. Every candidate has already passed identity checks and signed the company's working guidelines, so do not comment on trust or vetting.

Pick the candidates whose trade, stated areas, experience and profile text fit THIS job best. Prefer a close trade match over a near one, and a tradesperson who names the job's parish or a neighbouring area over one who does not. Experience counts, but a newer tradesperson with the right trade beats an experienced one in the wrong trade.

Answer in JSON only, exactly this shape and nothing else:
{"picks":[{"n": 1, "reason": "one plain sentence, under 25 words, saying why this person fits this job"}]}

Rules:
- "n" is the candidate's number from the list. Use only numbers from the list.
- Pick at most the number you are asked for. Pick fewer if fewer genuinely fit.
- Reasons are for the company's own desk, written plainly, no praise words, no promises, nothing about price or timing.
- Never use the words escrow, guarantee, guaranteed, 100%, or fully covered.
- English only.`;

export function buildPrompt(job: JobForPrompt, candidates: Candidate[], limit: number): string {
  const line = (label: string, v: unknown) => {
    const s = String(v ?? "").trim();
    return s ? `${label}: ${s}` : "";
  };
  const head = [
    line("Job reference", job.id),
    line("Title", job.title),
    line("Trade", job.trade),
    line("Job type", job.job_type),
    line("Parish", job.parish),
    line("Size", job.size_band),
    line("Urgency", job.urgency),
    line("Access", job.access_type),
    line("As the client described it", String(job.descr ?? "").slice(0, 2500)),
  ].filter(Boolean).join("\n");

  const list = candidates.map((c, i) => {
    const bits = [
      `${i + 1}. ${c.name}`,
      line("trade", c.trade),
      line("parish", c.parish),
      line("areas", c.areas),
      line("years", c.years),
      line("jobs completed on Yaadly", c.jobs_completed ?? 0),
      line("lane", c.lane),
      line("profile", String(c.about ?? "").replace(/\s+/g, " ").slice(0, 400)),
    ].filter(Boolean);
    return bits.join("\n   ");
  }).join("\n\n");

  return `${head}\n\nPick up to ${limit} of these ${candidates.length} candidates to ask for a quote.\n\n${list}`;
}

function stripNoise(s: string): string {
  return String(s).replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "").trim();
}

/** The first balanced JSON object in a model answer, or null. */
export function extractJson(s: string): Record<string, unknown> | null {
  const text = stripNoise(s);
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, escNext = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escNext) { escNext = false; continue; }
    if (c === "\\") { if (inStr) escNext = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); }
        catch (_) { return null; }
      }
    }
  }
  return null;
}

/**
 * Turn a model answer into picks the desk may see.
 *
 * `isClean` is passed in rather than imported so the test can prove the
 * substitution rule without depending on the exact banned list, which has its
 * own suite. The real caller passes guardrails.isClean.
 *
 * Returns null when nothing usable came back, and the caller falls back to
 * the ranking. Returns an empty array only when the model answered with a
 * well-formed empty list, which is a real answer ("none of these fit") and is
 * shown as such.
 */
export function validatePicks(
  raw: string,
  candidates: Candidate[],
  limit: number,
  isClean: (s: string) => boolean,
): Pick[] | null {
  const j = extractJson(raw);
  if (!j || !Array.isArray(j.picks)) return null;

  const out: Pick[] = [];
  const seen = new Set<number>();
  for (const p of j.picks as unknown[]) {
    if (!p || typeof p !== "object") continue;
    const n = Number((p as Record<string, unknown>).n);
    if (!Number.isInteger(n) || n < 1 || n > candidates.length || seen.has(n)) continue;
    seen.add(n);
    const c = candidates[n - 1];
    let reason = String((p as Record<string, unknown>).reason ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
    // A reason that names money is not a reason this agent was allowed to
    // give. Same for the banned list. Substituted, never sent through.
    if (!reason || !isClean(reason) || /J\$|\$|£|US\$|\b\d{3,}\b/.test(reason)) reason = c.match_reason;
    out.push({ worker_email: c.worker_email, worker_name: c.name, rank: out.length + 1, reason, source: "model" });
    if (out.length >= limit) break;
  }
  return out;
}

/** The database ranking as picks, when the model is not used or not usable. */
export function rankedPicks(candidates: Candidate[], limit: number): Pick[] {
  return candidates.slice(0, limit).map((c, i) => ({
    worker_email: c.worker_email,
    worker_name: c.name,
    rank: i + 1,
    reason: c.match_reason,
    source: "rank",
  }));
}
