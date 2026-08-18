"""Hard guardrails, enforced in code rather than trusted to a prompt.

These come straight from the YaadlyHub project guardrails. The point of
putting them here is that a model cannot talk its way past them: any text
that leaves an agent is screened, and any attempt to have the AI take a
money or reputation decision raises.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .telemetry import record_guardrail_event

# 1. Never market payment holding as escrow.
BANNED_TERMS: dict[str, str] = {
    r"\bescrow(ed|s)?\b": "Use 'held safely with a licensed payment provider', never 'escrow'.",
    r"\b100\s?%": "No absolute claims. Give the real figure or drop the claim.",
    r"\bzero (fraud|risk|conflicts?)\b": "No absolute claims.",
    r"\bremoves? all fraud\b": "No absolute claims.",
    r"\bguarantee[sd]? (?:no|zero) \w+": "No absolute claims.",
    r"\bfully covered\b": "Say 'protected up to the guarantee limit', not 'fully covered'.",
    r"\bwe hold (?:your |the )?(?:money|funds)\b": "Yaadly orchestrates the flow, it does not hold funds itself.",
}

# 3. AI assists and drafts. Humans decide anything involving money or trust.
HUMAN_ONLY_DECISIONS = frozenset(
    {
        "release_funds",
        "withhold_funds",
        "refund_client",
        "rule_on_dispute",
        "adjust_yaad_score",
        "suspend_worker",
        "approve_job",
    }
)


class GuardrailViolation(Exception):
    pass


@dataclass(frozen=True)
class Finding:
    term: str
    guidance: str
    excerpt: str


def scan(text: str) -> list[Finding]:
    """Return every banned-language hit in a block of outbound text."""
    findings: list[Finding] = []
    for pattern, guidance in BANNED_TERMS.items():
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            start = max(0, match.start() - 40)
            end = min(len(text), match.end() + 40)
            findings.append(
                Finding(term=match.group(0), guidance=guidance, excerpt="..." + text[start:end].strip() + "...")
            )
    return findings


def assert_clean(text: str, *, where: str = "output") -> str:
    findings = scan(text)
    if findings:
        detail = "; ".join(f"{f.term!r}: {f.guidance}" for f in findings)
        # The guidance strings are a fixed, closed set (the BANNED_TERMS
        # values), unlike the matched excerpt, which can carry fragments of
        # whatever text was being screened. Only the bounded set goes to
        # telemetry.
        record_guardrail_event(
            "guardrail.banned_language",
            {"where": where, "terms": ",".join(sorted({f.guidance for f in findings}))},
        )
        raise GuardrailViolation(f"Banned language in {where}: {detail}")
    return text


def assert_human_decision(action: str, decided_by: str) -> None:
    """Any consequential action must carry a named human decider."""
    if action in HUMAN_ONLY_DECISIONS and decided_by.strip().lower() in {"", "ai", "agent", "system", "auto"}:
        record_guardrail_event("guardrail.blocked_ai_decision", {"action": action})
        raise GuardrailViolation(
            f"Action {action!r} requires a named human decider. AI coordinates, verifies and drafts. "
            "It never releases money, rules on a dispute, or alters a reputation."
        )
