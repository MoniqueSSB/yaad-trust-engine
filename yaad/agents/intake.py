"""Intake Agent.

Turns whatever the client sent (typed text, photo captions, or a Patois voice
note transcript) into a structured Job Card. Voice is one option, never a
requirement. The agent asks at most three clarifying questions and never more.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict

from ..llm import LLMClient
from ..guardrails import assert_clean

SYSTEM = """You are the Intake Agent for Yaadly, a trust-first property services
marketplace for Jamaica and the Jamaican diaspora.

A client has described a job. They may have typed it, sent photo captions, or
left a voice note in Jamaican Patois that has been transcribed. Understand
Patois and Jamaican English naturally. Never correct the client's language and
never ask them to rephrase.

Produce a Job Card with these fields:
  trade: one of roofing, plumbing, electrical, masonry, painting, metalwork,
         grounds, general repair
  variant: a short slug for the sub-type where one is obvious, for example
           minor, major, severe, unclog, tank, grill, monthly. Use "*" if unclear.
  scope_summary: one or two plain sentences a tradesperson could act on
  urgency: emergency, urgent, standard, or flexible
  parish: the Jamaican parish or town, or "unknown"
  access_notes: gate codes, who holds keys, dogs, occupancy, or "not stated"
  materials_mentioned: list of materials the client named, may be empty
  clarifying_questions: at most 3, only the ones that genuinely block quoting.
                        Ask nothing you could reasonably infer.
  confidence: high, medium or low

Rules you must not break:
- Never quote a price. Pricing is a separate agent.
- Never promise an outcome, a timeline, or that a worker is available.
- Never use the word escrow.
- If the description is too thin to act on, say so in scope_summary and put
  the blocking questions in clarifying_questions."""


@dataclass
class JobCard:
    trade: str
    variant: str = "*"
    scope_summary: str = ""
    urgency: str = "standard"
    parish: str = "unknown"
    access_notes: str = "not stated"
    materials_mentioned: list[str] = field(default_factory=list)
    clarifying_questions: list[str] = field(default_factory=list)
    confidence: str = "low"
    mocked: bool = False

    def as_dict(self) -> dict:
        return asdict(self)

    @property
    def ready_to_quote(self) -> bool:
        return self.parish != "unknown" and not self.clarifying_questions


def run(client: LLMClient, message: str, *, photo_captions: list[str] | None = None) -> JobCard:
    parts = [f"CLIENT MESSAGE:\n{message.strip()}"]
    if photo_captions:
        joined = "\n".join(f"- {c}" for c in photo_captions)
        parts.append(f"\nPHOTOS ATTACHED ({len(photo_captions)}):\n{joined}")
    else:
        parts.append("\nPHOTOS ATTACHED: none")

    data = client.complete_json("intake", SYSTEM, "\n".join(parts))

    card = JobCard(
        trade=str(data.get("trade", "general repair")).lower().strip(),
        variant=str(data.get("variant", "*")).lower().strip() or "*",
        scope_summary=str(data.get("scope_summary", "")).strip(),
        urgency=str(data.get("urgency", "standard")).lower().strip(),
        parish=str(data.get("parish", "unknown")).strip(),
        access_notes=str(data.get("access_notes", "not stated")).strip(),
        materials_mentioned=[str(m) for m in data.get("materials_mentioned", []) or []],
        clarifying_questions=[str(q) for q in (data.get("clarifying_questions") or [])][:3],
        confidence=str(data.get("confidence", "low")).lower().strip(),
        mocked=bool(data.get("_mock")),
    )
    assert_clean(card.scope_summary + " " + " ".join(card.clarifying_questions), where="Job Card")
    return card
