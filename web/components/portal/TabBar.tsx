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
 * Seven areas now, one per question a client actually asks (founder's brief,
 * 3 Sep 2026): Overview, Scope and quote, Progress evidence, Materials,
 * Messages, Approvals, Help. Nothing was deleted to get there; documents and
 * the portal link moved into Overview, and money/invoices moved into
 * Approvals, next to the button that actually unlocks them.
 *
 * A search param rather than client state, so every tab is a real address
 * that survives a reload and can be linked to, and so the page stays a server
 * component with no hydration for what is ultimately navigation.
 */

export type TabKey =
  | "overview"
  | "details"
  | "scope"
  | "evidence"
  | "materials"
  | "messages"
  | "approvals"
  | "money"
  | "extra"
  | "help";

export const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  /* Founder, 28 Sep 2026: the portal link, the job's facts, where it is and
     the job as agreed live in their own section, not the overview. */
  { key: "details", label: "Job details" },
  { key: "scope", label: "Scope and quote" },
  { key: "evidence", label: "Progress evidence" },
  { key: "materials", label: "Materials" },
  { key: "messages", label: "Messages" },
  { key: "approvals", label: "Approvals" },
  /* Founder, 28 Sep 2026: the money on its own tab, for both sides: the
     whole breakdown, where it is, and who has been paid. Approvals keeps
     only what is waiting on a signature. */
  { key: "money", label: "Money" },
  { key: "extra", label: "Extra work" },
  { key: "help", label: "Help" },
];

/* Each tab's colour, by the question it answers (founder, 20 Oct 2026):
   sage is the job itself, ochre the proof, terracotta what is waiting on
   you, slate the money, lagoon talking to people. The colours are the
   tab-* variables in globals.css, "Portal tab colours". */
export type TabHue = "sage" | "ochre" | "terracotta" | "slate" | "lagoon";

export const TAB_HUE: Record<TabKey, TabHue> = {
  overview: "sage",
  details: "sage",
  scope: "sage",
  extra: "sage",
  evidence: "ochre",
  materials: "ochre",
  approvals: "terracotta",
  money: "slate",
  messages: "lagoon",
  help: "lagoon",
};

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
    /* The rule under the row takes the current tab's colour, so the tab and
       the section below it read as one piece. */
    <nav
      aria-label="Job sections"
      className={"jtabs mt-6 hue-" + TAB_HUE[active]}
    >
      {TABS.map((t) => {
        const on = t.key === active;
        const n = counts?.[t.key];
        return (
          <Link
            key={t.key}
            href={base + (t.key === "overview" ? "" : "?tab=" + t.key)}
            aria-current={on ? "page" : undefined}
            /* Every tab carries a dot in its colour; the section you are on is
               filled in that colour, bold, with a bar along its foot. Founder,
               14 Sep 2026: with every tab bold and only a thin underline on
               the current one, "it is not clear what section I am on". */
            className={"jtab hue-" + TAB_HUE[t.key]}
          >
            {t.label}
            {n != null && n > 0 && <span className="jtab-count">{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
