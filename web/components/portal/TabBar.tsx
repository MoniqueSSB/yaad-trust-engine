import Link from "next/link";

/**
 * The job room's tabs.
 *
 * The room was one long scroll: the money tiles, the brief, the materials
 * question, every stage of the evidence ledger, the quotes, the documents and
 * the chat, in that order, on one page. Four different questions ("what is
 * happening", "what is the proof", "where is my paperwork", "what is my
 * link") were answered by scrolling past the other three.
 *
 * A search param rather than client state, so every tab is a real address
 * that survives a reload and can be linked to, and so the page stays a server
 * component with no hydration for what is ultimately navigation.
 */

export type TabKey = "job" | "evidence" | "documents" | "info";

export const TABS: { key: TabKey; label: string }[] = [
  { key: "job", label: "The job" },
  { key: "evidence", label: "Evidence" },
  { key: "documents", label: "Documents" },
  { key: "info", label: "Link & settings" },
];

export function TabBar({
  base,
  active,
  counts,
}: {
  base: string;
  active: TabKey;
  /** shown against a tab when there is something to count, never when zero */
  counts?: Partial<Record<TabKey, number>>;
}) {
  return (
    <nav
      aria-label="Job sections"
      className="mt-6 flex flex-wrap gap-1.5 border-b border-line pb-px"
    >
      {TABS.map((t) => {
        const on = t.key === active;
        const n = counts?.[t.key];
        return (
          <Link
            key={t.key}
            href={base + (t.key === "job" ? "" : "?tab=" + t.key)}
            aria-current={on ? "page" : undefined}
            className={
              "-mb-px rounded-t-xl border-b-2 px-3.5 py-2.5 text-[13px] font-bold transition " +
              (on
                ? "border-teal text-tealb"
                : "border-transparent text-mute hover:text-tealb")
            }
          >
            {t.label}
            {n != null && n > 0 && (
              <span className="ml-1.5 rounded-full bg-panel2 px-1.5 py-0.5 text-[10.5px] font-bold text-dim">
                {n}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
