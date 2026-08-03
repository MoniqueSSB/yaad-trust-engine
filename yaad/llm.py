"""Thin OpenAI-compatible client with a deterministic offline fallback.

Two reasons this exists rather than calling the SDK directly:

1. The buildathon team key was not assigned at the time this was written, so
   the whole pipeline has to be demonstrable with no key at all. Mock mode is
   rule based and deterministic, and every mock response is labelled as such
   so nothing mocked can ever be passed off as a live result.
2. Every call is logged with its agent name, which is what the Verification
   and Dispute layers need later: an auditable trail of what the AI was asked
   and what it said.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from .config import Config, load_config


@dataclass
class CallRecord:
    agent: str
    mode: str
    prompt_chars: int
    response_chars: int


@dataclass
class LLMClient:
    config: Config = field(default_factory=load_config)
    calls: list[CallRecord] = field(default_factory=list)
    _client: Any = None

    def __post_init__(self) -> None:
        if self.config.live:
            from openai import OpenAI

            self._client = OpenAI(
                api_key=self.config.api_key,
                base_url=self.config.base_url,
                timeout=self.config.request_timeout,
            )

    # ------------------------------------------------------------------ #

    def complete(self, agent: str, system: str, user: str) -> str:
        if self.config.live:
            text = self._complete_live(system, user)
            mode = "live"
        else:
            text = mock_response(agent, user)
            mode = "mock"
        self.calls.append(
            CallRecord(agent=agent, mode=mode, prompt_chars=len(system) + len(user), response_chars=len(text))
        )
        return text

    def complete_json(self, agent: str, system: str, user: str) -> dict:
        raw = self.complete(agent, system + "\n\nReturn ONLY valid JSON. No prose, no code fences.", user)
        return _extract_json(raw)

    def _complete_live(self, system: str, user: str) -> str:
        response = self._client.chat.completions.create(
            model=self.config.model,
            temperature=self.config.temperature,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        return response.choices[0].message.content or ""


# ---------------------------------------------------------------------- #
# JSON extraction: small models fence their output more often than not.
# ---------------------------------------------------------------------- #

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


def _extract_json(raw: str) -> dict:
    candidate = raw.strip()
    fenced = _FENCE.search(candidate)
    if fenced:
        candidate = fenced.group(1).strip()
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass
    start, end = candidate.find("{"), candidate.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(candidate[start : end + 1])
        except json.JSONDecodeError:
            pass
    raise ValueError(f"Model did not return parseable JSON. First 300 chars: {raw[:300]!r}")


# ---------------------------------------------------------------------- #
# Mock mode
# ---------------------------------------------------------------------- #

_TRADE_HINTS = {
    "roof": "roofing",
    "zinc": "roofing",
    "leak": "roofing",
    "shingle": "roofing",
    "paint": "painting",
    "pipe": "plumbing",
    "plumb": "plumbing",
    "tank": "plumbing",
    "toilet": "plumbing",
    "water": "plumbing",
    "wire": "electrical",
    "light": "electrical",
    "socket": "electrical",
    "breaker": "electrical",
    "block": "masonry",
    "wall": "masonry",
    "cement": "masonry",
    "grill": "metalwork",
    "gate": "metalwork",
    "bush": "grounds",
    "yard": "grounds",
    "garden": "grounds",
}

_URGENCY_HINTS = {
    "emergency": "emergency",
    "urgent": "urgent",
    "right away": "urgent",
    "rain": "urgent",
    "leaking": "urgent",
    "soon": "standard",
}

_PARISHES = [
    "Kingston", "St Andrew", "St Thomas", "Portland", "St Mary", "St Ann",
    "Trelawny", "St James", "Hanover", "Westmoreland", "St Elizabeth",
    "Manchester", "Clarendon", "St Catherine", "Portmore", "Spanish Town",
]


def mock_response(agent: str, user: str) -> str:
    """Deterministic, rule based stand-ins. Never presented as live output."""
    low = user.lower()

    if agent == "intake":
        body = _section(user, "CLIENT MESSAGE:")
        trade = next((v for k, v in _TRADE_HINTS.items() if k in low), "general repair")
        urgency = next((v for k, v in _URGENCY_HINTS.items() if k in low), "standard")
        parish = next((p for p in _PARISHES if p.lower() in low), "unknown")
        variant = _guess_variant(trade, low)
        questions: list[str] = []
        if parish == "unknown":
            questions.append("Which parish or town is the property in?")
        if not re.search(r"\b(photo|picture|video|image|attached)\b", low):
            questions.append("Can you send two or three photos of the area, including one wide shot?")
        if not re.search(r"\d", low):
            questions.append("Roughly what size is the area affected, in feet or rooms?")
        payload = {
            "trade": trade,
            "variant": variant,
            "scope_summary": _first_sentence(body),
            "urgency": urgency,
            "parish": parish,
            "access_notes": "not stated",
            "materials_mentioned": sorted({k for k in ("cement", "zinc", "block", "paint", "lumber") if k in low}),
            "clarifying_questions": questions[:3],
            "confidence": "medium",
            "_mock": True,
        }
        return json.dumps(payload)

    if agent == "reporting":
        update = _section(user, "WORKER UPDATE:")
        return json.dumps(
            {
                "headline": "Work is under way and evidence has been received.",
                "plain_english": " ".join(update.split())[:400],
                "what_happens_next": "Yaadly reviews the evidence pack, then you approve or raise a question.",
                "client_action_needed": "Review the evidence pack when it arrives.",
                "_mock": True,
            }
        )

    if agent == "verification":
        return json.dumps({"plausibility_note": "Mock mode: no model judgement applied.", "_mock": True})

    return json.dumps({"_mock": True, "note": f"No mock handler for agent {agent!r}."})


_VARIANT_HINTS: dict[str, list[tuple[str, str]]] = {
    "roofing": [("reconstruct", "severe"), ("collapse", "severe"), ("whole roof", "major"),
                ("major", "major"), ("leak", "minor"), ("lift", "minor"), ("sheet", "minor")],
    "plumbing": [("tank", "tank"), ("unclog", "unclog"), ("block", "unclog"), ("septic", "septic")],
    "metalwork": [("grill", "grill"), ("gate", "grill")],
    "grounds": [("month", "monthly"), ("regular", "monthly")],
}


def _guess_variant(trade: str, low: str) -> str:
    for needle, variant in _VARIANT_HINTS.get(trade, []):
        if needle in low:
            return variant
    return "*"


def _section(text: str, label: str) -> str:
    """Pull the block that follows a labelled heading in the assembled prompt."""
    if label not in text:
        return text
    tail = text.split(label, 1)[1]
    for stop in ("\nPHOTOS ATTACHED", "\nJOB REF:", "\nTRADE:"):
        if stop in tail:
            tail = tail.split(stop, 1)[0]
    return tail.strip()


def _first_sentence(text: str) -> str:
    cleaned = " ".join(text.split())
    for marker in (". ", "? ", "! "):
        if marker in cleaned:
            return cleaned.split(marker)[0].strip() + marker.strip()
    return cleaned[:220]
