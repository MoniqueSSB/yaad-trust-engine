/**
 * Reading the intake agent's job card back out of the text column it was
 * flattened into.
 *
 * Separate from the component that renders it because this is the part that
 * can be wrong. It is a parser over a format two Edge Functions happen to
 * write, so it is worth being able to run it over real rows on its own,
 * without a browser and without React.
 *
 * The prefixes are exactly the ones yaad-inbound and yaad-whatsapp-webhook
 * write. If either changes what it joins together, this is the file that has
 * to change with it.
 */

type Section = { key: string; body: string };

// Written by yaad-inbound and yaad-whatsapp-webhook respectively. Order
// matters only in that the longest match has to win, so they are tested as
// whole-line prefixes rather than by substring.
const LABELS: { prefix: string; key: string }[] = [
  { prefix: "Access:", key: "access" },
  { prefix: "Worth confirming before quoting:", key: "questions" },
  { prefix: "In their own words:", key: "verbatim" },
  { prefix: "Raw message:", key: "verbatim" },
  { prefix: "Arrived by", key: "arrival" },
  { prefix: "Source:", key: "source" },
  { prefix: "Urgency:", key: "urgency" },
  { prefix: "Wanted by:", key: "wanted" },
  { prefix: "Trade:", key: "trade" },
];

const DESK_NOTE = /^\s*\[.*\]\s*$/;

export function parseBrief(descr: string): { scope: string; sections: Record<string, string> } {
  const lines = descr.split("\n");
  const found: Section[] = [];
  const scope: string[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    const hit = LABELS.find((l) => line.trimStart().startsWith(l.prefix));
    if (hit) {
      current = { key: hit.key, body: line.trimStart().slice(hit.prefix.length).trim() };
      found.push(current);
      continue;
    }
    if (current) {
      current.body += (current.body ? "\n" : "") + line;
    } else {
      scope.push(line);
    }
  }

  const sections: Record<string, string> = {};
  for (const s of found) {
    // The verbatim message is the one place a bracketed line is the client's
    // own content ("[they attached 1 photo]") rather than a note to the desk,
    // so it is left whole. Everywhere else they are stripped.
    const body =
      s.key === "verbatim"
        ? s.body
        : s.body
            .split("\n")
            .filter((l) => !DESK_NOTE.test(l))
            .join("\n");
    if (!sections[s.key] && body.trim()) sections[s.key] = body.trim();
  }

  return {
    scope: scope.filter((l) => !DESK_NOTE.test(l)).join("\n").trim(),
    sections,
  };
}

