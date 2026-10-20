// What fills "your job {{1}}" in every template here. A job's title is
// built as "<trade> job, <area>", so dropping it in whole reads "your job
// Carpentry & Joinery job, Kingston". The word "job" comes off the title,
// once, so the line reads "your job Carpentry & Joinery, Kingston". With no
// title the job's code stands alone, never "your job your job". 20 Oct 2026.
export function jobLabel(j: { id: string; title: string | null }, withId = true): string {
  const t = (j.title ?? "").replace(/\s+job(?=\s*(,|$))/i, "").trim();
  if (!t) return j.id;
  return withId ? `${t} (${j.id})` : t;
}
