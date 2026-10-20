import Link from "next/link";
import { TAB_HUE, type TabKey } from "@/components/portal/TabBar";

/**
 * The job room's front page (founder, 20 Oct 2026): one view of coloured
 * boxes, a figure or a small chart in each, few words, and a tap opens the
 * detail. Each box links to the tab it summarises, so the detail a person
 * opens is exactly the tab content that was there before. Nothing on any tab
 * was removed to make this; it only summarises.
 *
 * Server component, no state. Every figure arrives already worked out by the
 * page from rows it had loaded anyway, so this file adds no query and no
 * rule: it never decides a price, an approval or what anybody is owed. Money
 * figures are only ever read off invoices, in the currency each was raised in,
 * and two currencies are never added together.
 */

export type StageBar = { stage: number; label: string; value: number; paid: boolean };

export type DashboardData = {
  base: string;
  role: "client" | "worker";
  /** What is waiting on this person, top item first (the Outstanding list's own first entry). */
  waiting: { count: number; title: string | null };
  check: { label: string; detail: string; recorded: boolean } | null;
  total: string | null;
  totalLabel: string;
  bills: { paid: number; all: number; label: string };
  unpaid: number;
  stage: { now: number; of: number };
  evidence: { total: number; byDay: { day: string; n: number }[]; latest: string | null };
  messages: { count: number; last: string | null };
  quotes: number;
  materials: { store: string | null };
  extra: { waiting: number; total: number };
  docs: number;
  details: { trade: string | null; parish: string | null };
  help: { open: boolean };
  /** Stage bills in ONE currency, or empty when there is no such set to chart. */
  stageBars: StageBar[];
};

function href(base: string, tab: TabKey) {
  return base + "?tab=" + tab;
}

function Ring({ pct, label }: { pct: number; label: string }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const a = (c * Math.max(0, Math.min(100, pct))) / 100;
  return (
    <svg width="76" height="76" viewBox="0 0 96 96" aria-hidden="true" className="flex-none">
      <circle cx="48" cy="48" r={r} fill="none" stroke="var(--color-bg)" strokeWidth="11" />
      <circle
        cx="48" cy="48" r={r} fill="none" stroke="var(--hue)" strokeWidth="11" strokeLinecap="round"
        strokeDasharray={`${a.toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 48 48)"
      />
      <text x="48" y="54" textAnchor="middle" style={{ font: "600 18px var(--font-body)", fill: "var(--color-ink)" }}>{label}</text>
    </svg>
  );
}

function Box({
  base, tab, w, tall, className, children, label,
}: {
  base: string; tab: TabKey; w: string; tall?: boolean; className?: string; label: string; children: React.ReactNode;
}) {
  return (
    <Link
      href={href(base, tab)}
      aria-label={label}
      className={`jd-box ${w} ${tall ? "t2" : ""} hue-${TAB_HUE[tab]} ${className ?? ""}`}
    >
      {children}
    </Link>
  );
}

function Tag({ children, n }: { children: React.ReactNode; n?: number }) {
  return (
    <div className="jd-top">
      <span className="jd-tag">{children}</span>
      {n != null && n > 0 && <span className="jd-n">{n}</span>}
    </div>
  );
}

export function JobDashboard({ d }: { d: DashboardData }) {
  const paidPct = d.bills.all ? Math.round((d.bills.paid / d.bills.all) * 100) : 0;
  const stagePct = d.stage.of ? Math.round((Math.min(d.stage.now, d.stage.of) / d.stage.of) * 100) : 0;
  const maxDay = Math.max(1, ...d.evidence.byDay.map((x) => x.n));
  const maxBar = Math.max(1, ...d.stageBars.map((x) => x.value));

  return (
    <div className="jd">
      {d.waiting.count > 0 && (
        <Box base={d.base} tab="approvals" w="w8" className="jd-act" label="Open what is waiting on you">
          <span className="jd-tag">Waiting on you</span>
          <span className="min-w-0 flex-1">
            <b>{d.waiting.title ?? "Something needs you"}</b>
            {d.waiting.count > 1 && <span className="jd-sub">and {d.waiting.count - 1} more</span>}
          </span>
          <span className="jd-go">Open</span>
        </Box>
      )}

      {d.check && (
        <Box base={d.base} tab="approvals" w="w4" label="Open the Visual Check" className="hue-dusk">
          <Tag>{d.check.label}</Tag>
          <div className="jd-mid">{d.check.recorded ? "Findings in" : "Booked"}</div>
          <div className="jd-sub">{d.check.detail}</div>
        </Box>
      )}

      <Box base={d.base} tab="scope" w="w3" label="Open scope and quote">
        <Tag>{d.totalLabel}</Tag>
        <div className="jd-big">{d.total ?? "Not agreed"}</div>
        <div className="jd-sub">{d.quotes === 1 ? "1 quote" : d.quotes + " quotes"}</div>
      </Box>

      <Box base={d.base} tab="money" w="w3" label="Open money">
        <div className="jd-row">
          <div>
            <Tag n={d.unpaid}>{d.bills.label}</Tag>
            <div className="jd-big">{d.bills.paid} of {d.bills.all}</div>
            <div className="jd-sub">{d.unpaid ? d.unpaid + " to pay" : "nothing owed now"}</div>
          </div>
          {d.bills.all > 0 && <Ring pct={paidPct} label={paidPct + "%"} />}
        </div>
      </Box>

      <Box base={d.base} tab="evidence" w="w3" label="Open progress evidence">
        <div className="jd-row">
          <div>
            <Tag>Stage</Tag>
            <div className="jd-big">{d.stage.of ? `${Math.min(d.stage.now, d.stage.of)} of ${d.stage.of}` : "Not started"}</div>
            <div className="jd-sub">of the agreed stages</div>
          </div>
          {d.stage.of > 0 && <Ring pct={stagePct} label={stagePct + "%"} />}
        </div>
      </Box>

      <Box base={d.base} tab="messages" w="w3" label="Open messages">
        <Tag n={d.messages.count}>Messages</Tag>
        <div className="jd-sub line-clamp-3">{d.messages.last ?? "No messages yet."}</div>
      </Box>

      {d.stageBars.length > 0 && (
        <Box base={d.base} tab="money" w="w7" label="Open money by stage">
          <Tag>Money by stage</Tag>
          <svg className="jd-chart" viewBox={`0 0 ${d.stageBars.length * 96} 190`} role="img"
            aria-label={d.stageBars.map((b) => `${b.label} ${b.paid ? "paid" : "to come"}`).join(", ")}>
            <line x1="0" x2={d.stageBars.length * 96} y1="150" y2="150" stroke="var(--color-line)" />
            {d.stageBars.map((b, i) => {
              const h = Math.max(6, (b.value / maxBar) * 110);
              const x = 14 + i * 96;
              return (
                <g key={b.stage}>
                  <rect x={x} y={150 - h} width="68" height={h} rx="8"
                    fill={b.paid ? "var(--hue)" : "var(--color-bg)"} fillOpacity={b.paid ? 0.8 : 1}
                    stroke="var(--hue)" strokeWidth="1.5" strokeDasharray={b.paid ? undefined : "5 4"} />
                  <text x={x + 34} y={142 - h} textAnchor="middle" className="ink">{b.label}</text>
                  <text x={x + 34} y="176" textAnchor="middle">{b.paid ? "Paid" : "To come"} · {b.stage}</text>
                </g>
              );
            })}
          </svg>
        </Box>
      )}

      <Box base={d.base} tab="evidence" w="w5" tall={d.stageBars.length > 0} label="Open progress evidence">
        <Tag n={d.evidence.total}>Progress evidence</Tag>
        {d.evidence.byDay.length > 0 ? (
          <>
            <div className="jd-sub">Items sent each day</div>
            <svg className="jd-chart" viewBox={`0 0 ${d.evidence.byDay.length * 60} 150`} role="img"
              aria-label={d.evidence.byDay.map((x) => `${x.day}: ${x.n}`).join(", ")}>
              {d.evidence.byDay.map((x, i) => {
                const h = Math.max(4, (x.n / maxDay) * 92);
                return (
                  <g key={x.day}>
                    <rect x={12 + i * 60} y={118 - h} width="36" height={h} rx="6" fill="var(--hue)"
                      fillOpacity={i === d.evidence.byDay.length - 1 ? 1 : 0.55} />
                    <text x={30 + i * 60} y={110 - h} textAnchor="middle" className="ink">{x.n}</text>
                    <text x={30 + i * 60} y="140" textAnchor="middle">{x.day}</text>
                  </g>
                );
              })}
            </svg>
          </>
        ) : (
          <div className="jd-sub">Photos and videos from the work appear here.</div>
        )}
        {d.evidence.latest && <div className="jd-sub">Latest: {d.evidence.latest}</div>}
      </Box>

      <Box base={d.base} tab="materials" w="w4" label="Open materials">
        <Tag>Materials</Tag>
        <div className="jd-mid">{d.materials.store ?? "Store not set"}</div>
        <div className="jd-sub">receipts and money for materials</div>
      </Box>

      <Box base={d.base} tab="extra" w="w3" label="Open extra work">
        <Tag n={d.extra.waiting}>Extra work</Tag>
        <div className="jd-big">{d.extra.total}</div>
        <div className="jd-sub">{d.extra.waiting ? d.extra.waiting + " to agree" : "nothing to agree"}</div>
      </Box>

      <Box base={d.base} tab="overview" w="w4" label="Open documents">
        <Tag n={d.docs}>Documents</Tag>
        <div className="jd-sub">Quote, Kickoff Pack, invoices and the Completion Report, below.</div>
      </Box>

      <Box base={d.base} tab="details" w="w4" label="Open job details">
        <Tag>Job details</Tag>
        <div className="jd-mid">{d.details.trade ?? "Job"}</div>
        <div className="jd-sub">{d.details.parish ?? ""}</div>
      </Box>

      <Box base={d.base} tab="help" w="w4" label="Open help">
        <Tag n={d.help.open ? 1 : 0}>Help</Tag>
        <div className="jd-sub">{d.help.open ? "Your dispute is open." : "Something wrong? A person replies."}</div>
      </Box>
    </div>
  );
}
