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
ESCROW_GUIDANCE = (
    "Yaadly is principal: the client buys the job from Yaadly at one agreed price. Say that, never 'escrow' and never that money is held for anybody."
)
HELD_GUIDANCE = (
    "Yaadly holds nobody's money. The client buys the job from Yaadly and Yaadly engages and pays the tradesperson under its own agreement."
)

BANNED_TERMS: dict[str, str] = {
    r"\bescrow(ed|s)?\b": ESCROW_GUIDANCE,
    r"\b100\s?%": "No absolute claims. Give the real figure or drop the claim.",
    r"\bzero (fraud|risk|conflicts?)\b": "No absolute claims.",
    r"\bremoves? all fraud\b": "No absolute claims.",
    r"\bguarantee[sd]? (?:no|zero) \w+": "No absolute claims.",
    r"\bfully covered\b": "Say 'protected up to the guarantee limit', not 'fully covered'.",
    r"\bwe hold (?:your |the )?(?:money|funds)\b": "Yaadly orchestrates the flow, it does not hold funds itself.",
    # Added 4 September 2026. The line above catches the active voice and only
    # the active voice, and the passive is the form a model actually reaches
    # for: "money is held and released stage by stage". That exact sentence was
    # sitting in the WhatsApp assistant's own list of approved facts, so the one
    # phrase the screen exists to stop was the phrase the instructions supplied.
    #
    # Deliberately narrow. It bans the claim that THE CLIENT'S money is sitting
    # with Yaadly awaiting release, which is the escrow reading and is wrong
    # under the principal structure settled on 3 September: the client buys the
    # job from Yaadly outright. It does not touch "held safely with a licensed
    # payment provider", which CLAUDE.md section 8 prescribes by name and which
    # is not this session's to retire.
    r"\b(?:your|the client'?s?|their)\s+(?:money|funds?)\s+(?:is|are|was|were|will be)\s+(?:being\s+)?held\b":
        "Yaadly is principal: the client buys the job from Yaadly. Never describe the client's money as held.",
    r"\bwe(?:'re|\s+are)\s+holding\s+(?:your|the|their)\s+(?:money|funds?)\b":
        "Yaadly is principal: the client buys the job from Yaadly. Never say Yaadly is holding money.",
    # Added 5 September 2026, on the founder's instruction to settle the
    # question the 4 September note left open.
    #
    # "Held safely with a licensed payment provider" was the prescribed
    # replacement for "escrow" and it is now the wrong advice, because it
    # describes the arrangement the principal structure exists to avoid. It
    # was also the one banned idea the screen could not see: no word in it is
    # banned, so it walked straight through, and yaad/agents/reporting.py was
    # instructing the model to write it. docs/COPY-GUIDELINES.md had already
    # banned the phrase; CLAUDE.md section 8 still prescribed it, and the two
    # disagreed for two days.
    #
    # Narrow on purpose. It catches the money claim and leaves ordinary
    # safe-keeping language alone, because "your documents are held safely" is
    # true and unobjectionable.
    r"\bheld safely with a licensed\b": HELD_GUIDANCE,
    r"\b(?:money|funds?|payments?|deposits?)\s+(?:is|are|was|were|will be)\s+held safely\b": HELD_GUIDANCE,
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
