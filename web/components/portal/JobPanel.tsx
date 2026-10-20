import Link from "next/link";
import { TABS, TAB_HUE, type TabKey } from "@/components/portal/TabBar";

/**
 * The detail behind a dashboard box (founder, 20 Oct 2026). Any tab other
 * than the front page opens here, over the dashboard, from the right: from a
 * box, from the tab strip, or from an old ?tab= link in a WhatsApp message,
 * an email or the desk, which all keep working because the address is the
 * same one they always used.
 *
 * The children are the tab's content exactly as it was before the dashboard,
 * forms and all. On the front page (open is false) they render in place, as
 * they always did. Server component: Close is a plain link back to the
 * dashboard, so there is no client state to lose and the back button works.
 */
export function JobPanel({
  open,
  tab,
  base,
  children,
}: {
  open: boolean;
  tab: TabKey;
  base: string;
  children: React.ReactNode;
}) {
  if (!open) return <>{children}</>;
  const label = TABS.find((t) => t.key === tab)?.label ?? "Details";
  return (
    <>
      <Link href={base} className="jpanel-back" aria-label="Close and go back to the job" tabIndex={-1} />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={"jpanel hue-" + TAB_HUE[tab]}
      >
        <div className="jpanel-head">
          <span className="jd-tag">{label}</span>
          <Link href={base} className="jpanel-close">Close</Link>
        </div>
        {children}
      </section>
    </>
  );
}
