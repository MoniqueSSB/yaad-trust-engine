"""Verification Agent.

Checks an evidence package for completeness and plausibility across the whole
chain: Arrival Log, materials receipts, Midnight Work-Log. It flags gaps and
scores nothing. It never adjudicates, never releases money, never touches a
Yaad Score. Output is a pack for a human to rule on.

The site-match gate exists to protect the worker as much as the client: if the
site does not match what the client described, the worker should not be held
to a job they were mis-sold. That is the Mirror Rule in code.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from ..guardrails import assert_human_decision
from ..telemetry import record_guardrail_event


@dataclass
class MediaItem:
    kind: str  # photo | video | receipt
    captured_at: datetime | None = None
    has_geotag: bool = False
    caption: str = ""
    duration_s: float | None = None


@dataclass
class EvidencePackage:
    job_id: str
    worker_id: str
    arrival_log: list[MediaItem] = field(default_factory=list)
    materials_receipts: list[MediaItem] = field(default_factory=list)
    midnight_work_log: list[MediaItem] = field(default_factory=list)
    site_match_confirmed: bool = False
    worker_notes: str = ""
    job_started_at: datetime | None = None


@dataclass
class Check:
    name: str
    passed: bool
    detail: str
    severity: str  # blocking | question | note

    def line(self) -> str:
        mark = "PASS" if self.passed else ("BLOCK" if self.severity == "blocking" else "GAP ")
        return f"[{mark}] {self.name}: {self.detail}"


@dataclass
class VerificationResult:
    job_id: str
    checks: list[Check]

    @property
    def blocking(self) -> list[Check]:
        return [c for c in self.checks if not c.passed and c.severity == "blocking"]

    @property
    def gaps(self) -> list[Check]:
        return [c for c in self.checks if not c.passed and c.severity != "blocking"]

    @property
    def complete(self) -> bool:
        return not self.blocking

    def human_decision_pack(self) -> str:
        lines = [
            f"EVIDENCE REVIEW PACK, job {self.job_id}",
            "Prepared by the Verification Agent. This is not a ruling.",
            "",
        ]
        lines += [c.line() for c in self.checks]
        lines += [
            "",
            f"Blocking items: {len(self.blocking)}. Open questions: {len(self.gaps)}.",
            "A named human reviews this pack and decides. The engine does not release funds.",
        ]
        return "\n".join(lines)


def run(package: EvidencePackage) -> VerificationResult:
    checks: list[Check] = []

    # --- Arrival Log -------------------------------------------------- #
    arrival_photos = [m for m in package.arrival_log if m.kind == "photo"]
    checks.append(
        Check(
            "Arrival Log present",
            len(arrival_photos) >= 3,
            f"{len(arrival_photos)} arrival photos on file, 3 is the minimum.",
            "blocking",
        )
    )
    checks.append(
        Check(
            "Arrival Log geotagged",
            any(m.has_geotag for m in arrival_photos),
            "At least one arrival photo carries a location pin."
            if any(m.has_geotag for m in arrival_photos)
            else "No arrival photo carries a location pin.",
            "question",
        )
    )
    checks.append(
        Check(
            "Site match confirmed",
            package.site_match_confirmed,
            "Worker confirmed the site matches the job description."
            if package.site_match_confirmed
            else "Site match not confirmed. Protects the worker from a mis-described job. Hold and ask.",
            "blocking",
        )
    )

    # --- Sequencing: arrival must precede the work log ------------------ #
    arrival_times = [m.captured_at for m in package.arrival_log if m.captured_at]
    work_times = [m.captured_at for m in package.midnight_work_log if m.captured_at]
    if arrival_times and work_times:
        ordered = max(arrival_times) <= min(work_times)
        checks.append(
            Check(
                "Evidence sequence",
                ordered,
                "Arrival evidence predates the work log."
                if ordered
                else "Work-log media is timestamped before the arrival evidence. Sequence does not hold.",
                "blocking",
            )
        )
    else:
        checks.append(
            Check("Evidence sequence", False, "Timestamps missing, sequence cannot be verified.", "question")
        )

    # --- Midnight Work-Log --------------------------------------------- #
    videos = [m for m in package.midnight_work_log if m.kind == "video"]
    wide_pan = [v for v in videos if "wide" in v.caption.lower() or "pan" in v.caption.lower()]
    anchors = [
        m
        for m in package.midnight_work_log
        if any(word in m.caption.lower() for word in ("anchor", "close", "corner", "join", "beam", "detail"))
    ]
    checks.append(Check("Wide pan video", bool(wide_pan), f"{len(wide_pan)} wide pan clip(s).", "blocking"))
    checks.append(
        Check(
            "Close-up structural anchors",
            len(anchors) >= 2,
            f"{len(anchors)} close-up anchor shot(s), 2 is the minimum.",
            "blocking",
        )
    )
    long_enough = [v for v in videos if (v.duration_s or 0) >= 15]
    checks.append(
        Check(
            "Video usable length",
            bool(long_enough),
            f"{len(long_enough)} clip(s) of 15 seconds or more.",
            "question",
        )
    )
    checks.append(
        Check(
            "Live pin on work log",
            any(m.has_geotag for m in package.midnight_work_log),
            "Work-log media carries a location pin."
            if any(m.has_geotag for m in package.midnight_work_log)
            else "No location pin on the work log.",
            "question",
        )
    )

    # --- Same-day submission ------------------------------------------- #
    if package.job_started_at and work_times:
        within = max(work_times) - package.job_started_at <= timedelta(hours=18)
        checks.append(
            Check(
                "Submitted by midnight",
                within,
                "Work log submitted the same working day."
                if within
                else "Work log submitted more than 18 hours after start. Ask why, do not penalise automatically.",
                "note",
            )
        )

    # --- Materials receipts -------------------------------------------- #
    if package.materials_receipts:
        checks.append(
            Check(
                "Receipts geolocated",
                any(m.has_geotag for m in package.materials_receipts),
                f"{len(package.materials_receipts)} receipt(s) on file.",
                "question",
            )
        )

    return VerificationResult(job_id=package.job_id, checks=checks)


def release_funds(job_id: str, amount_gbp: float, decided_by: str) -> dict:
    """Deliberately guarded. The engine cannot release money on its own."""
    assert_human_decision("release_funds", decided_by)
    # decided_by is a free-text name and never goes to telemetry. Reaching
    # this line already proves, via the guardrail above, that a human made
    # the call, so the bounded role is always "human" here by construction.
    record_guardrail_event(
        "guardrail.money.released",
        {"job.id": job_id, "amount_gbp": amount_gbp, "decider.role": "human"},
    )
    return {
        "job_id": job_id,
        "amount_gbp": amount_gbp,
        "decided_by": decided_by,
        "status": "queued for payout, human approved",
    }
