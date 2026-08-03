"""Scripted job scenarios, written against the planned December pilot in Portmore.

Synthetic identities only. No real client, worker, ID or payment data appears
anywhere in this repository.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from .agents.verification import EvidencePackage, MediaItem


@dataclass
class Scenario:
    ref: str
    title: str
    client_name: str
    client_message: str
    photo_captions: list[str] = field(default_factory=list)
    quoted_jmd: float | None = None
    worker_update: str = ""
    evidence: EvidencePackage | None = None


D = datetime  # brevity below

SCENARIOS: list[Scenario] = [
    Scenario(
        ref="JOB-001",
        title="Roof leak, diaspora client in London, complete evidence",
        client_name="Andrea",
        client_message=(
            "Good evening. Mi madda house inna Portmore, St Catherine, and di roof a leak bad since di rain "
            "last week. Water a come through di back bedroom ceiling and di zinc look like it lift up one side. "
            "She 74 and she deh deh alone so mi want it fix quick. Mi deh a London so mi cyaan come look."
        ),
        photo_captions=[
            "Wide shot of rear roof slope, zinc sheet lifted at the edge",
            "Bedroom ceiling with brown water staining, roughly 1m across",
            "Close-up of the lifted zinc fixing",
        ],
        quoted_jmd=95_000,
        worker_update=(
            "Morning boss. Mi reach di yard 7:30 and start pon di back section. Mi tek off di four sheet weh "
            "did lif up, di batten under it rotten so mi haffi change two a dem. Mi put on di new zinc and seal "
            "round di edge. Ceiling still wet so mi nah touch it today, it haffi dry first. Mi tek up di old "
            "zinc and carry it gone. Tomorrow mi come back fi check di seal after di rain."
        ),
        evidence=EvidencePackage(
            job_id="JOB-001",
            worker_id="WK-014",
            job_started_at=D(2026, 12, 11, 7, 30),
            site_match_confirmed=True,
            arrival_log=[
                MediaItem("photo", D(2026, 12, 11, 7, 32), True, "Front of property, house number visible"),
                MediaItem("photo", D(2026, 12, 11, 7, 34), True, "Rear roof slope before work, zinc lifted"),
                MediaItem("photo", D(2026, 12, 11, 7, 35), False, "Bedroom ceiling stain before work"),
            ],
            materials_receipts=[
                MediaItem("receipt", D(2026, 12, 11, 9, 5), True, "4 zinc sheets and 2 treated battens"),
            ],
            midnight_work_log=[
                MediaItem("video", D(2026, 12, 11, 16, 40), True, "Wide pan across the completed rear slope", duration_s=38),
                MediaItem("photo", D(2026, 12, 11, 16, 44), True, "Close-up anchor: new batten join at the ridge"),
                MediaItem("photo", D(2026, 12, 11, 16, 46), True, "Close-up corner detail, sealed edge"),
                MediaItem("photo", D(2026, 12, 11, 16, 48), False, "Old zinc removed from site"),
            ],
            worker_notes="Ceiling left to dry, returning to check seal after rain.",
        ),
    ),
    Scenario(
        ref="JOB-002",
        title="Painting job, no public benchmark, thin brief",
        client_name="Delroy",
        client_message="Need the house painted. How much?",
        photo_captions=[],
        quoted_jmd=None,
        worker_update="",
        evidence=None,
    ),
    Scenario(
        ref="JOB-003",
        title="Water tank install, evidence package fails the gate",
        client_name="Marcia",
        client_message=(
            "Hi, I need a new water tank installed at my property in Spanish Town, St Catherine. The old one "
            "cracked. I'm in Toronto. Photos attached. Not urgent but I'd like it sorted this month."
        ),
        photo_captions=["Cracked black tank on a concrete base", "Wide shot of the tank stand and pipework"],
        quoted_jmd=62_000,
        worker_update="Tank install done.",
        evidence=EvidencePackage(
            job_id="JOB-003",
            worker_id="WK-031",
            job_started_at=D(2026, 12, 14, 8, 0),
            site_match_confirmed=False,
            arrival_log=[
                MediaItem("photo", D(2026, 12, 14, 8, 10), False, "Tank stand"),
            ],
            materials_receipts=[],
            midnight_work_log=[
                MediaItem("photo", D(2026, 12, 14, 15, 0), False, "New tank in place"),
            ],
            worker_notes="",
        ),
    ),
]


def by_ref(ref: str) -> Scenario:
    for scenario in SCENARIOS:
        if scenario.ref == ref:
            return scenario
    raise KeyError(ref)
