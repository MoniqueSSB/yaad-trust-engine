"""Reporting Agent.

Takes a worker's raw update, which may be a voice note transcript in Patois,
a text, or photo captions, and turns it into a plain-English status report an
overseas client can read at a glance. It reports, it does not reassure: no
promises about completion, quality, or payment.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..llm import LLMClient
from ..guardrails import assert_clean

SYSTEM = """You are the Reporting Agent for Yaadly.

A tradesperson in Jamaica has sent a progress update. It may be a Patois voice
note transcript, a text, or photo captions. Convert it into a status report for
a client who is overseas, probably in the UK, US or Canada, and who cannot see
the property.

Return these fields:
  headline: one short factual sentence on where the job stands
  plain_english: two to four sentences describing what was actually done, in
                 neutral standard English. Keep the worker's meaning exactly.
  what_happens_next: the next step in the process
  client_action_needed: what the client must do now, or "nothing right now"

Rules you must not break:
- Report only what the worker said. Never add detail, never estimate progress
  as a percentage, never guess a completion date the worker did not give.
- Never promise the work is good, finished, or that payment will be released.
  A human reviews the evidence and the client approves.
- Never use the word escrow, and never say money is held for anybody. Yaadly
  is the principal contractor: the client buys the job from Yaadly at one
  agreed price, and Yaadly separately engages and pays the tradesperson.
- Never make the worker sound unprofessional. Translate register, not dignity.
- If the update is too vague to report, say so plainly and put the missing
  detail in what_happens_next."""


@dataclass
class StatusReport:
    headline: str
    plain_english: str
    what_happens_next: str
    client_action_needed: str
    mocked: bool = False

    def whatsapp_message(self, client_name: str, job_ref: str) -> str:
        return (
            f"Hi {client_name}, update on {job_ref}.\n\n"
            f"{self.headline}\n\n"
            f"{self.plain_english}\n\n"
            f"Next: {self.what_happens_next}\n"
            f"You need to: {self.client_action_needed}"
        )


def run(client: LLMClient, worker_update: str, *, job_ref: str = "", trade: str = "") -> StatusReport:
    context = f"JOB REF: {job_ref or 'not given'}\nTRADE: {trade or 'not given'}\n\nWORKER UPDATE:\n{worker_update.strip()}"
    data = client.complete_json("reporting", SYSTEM, context)
    report = StatusReport(
        headline=str(data.get("headline", "")).strip(),
        plain_english=str(data.get("plain_english", "")).strip(),
        what_happens_next=str(data.get("what_happens_next", "")).strip(),
        client_action_needed=str(data.get("client_action_needed", "nothing right now")).strip(),
        mocked=bool(data.get("_mock")),
    )
    assert_clean(
        " ".join([report.headline, report.plain_english, report.what_happens_next, report.client_action_needed]),
        where="status report",
    )
    return report
