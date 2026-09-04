"""Tests that assert the things that must never break.

Run with:  python -m pytest -q
"""

from __future__ import annotations

from datetime import datetime

import sys

import pytest

from yaad import benchmarks as bm
from yaad import guardrails as yaad_guardrails
from yaad import telemetry
from yaad.agents import intake, pricing, reporting, verification
from yaad.agents.verification import EvidencePackage, MediaItem
from yaad.config import Config
from yaad.guardrails import GuardrailViolation, assert_clean, assert_human_decision, scan
from yaad.llm import LLMClient, _extract_json
from yaad.scenarios import by_ref


@pytest.fixture
def client() -> LLMClient:
    return LLMClient(config=Config(api_key=None, base_url="", model="", temperature=0.0, request_timeout=5))


# --------------------------------------------------------------------- #
# Guardrails
# --------------------------------------------------------------------- #

@pytest.mark.parametrize(
    "text",
    [
        "Your money sits in escrow until the job is done.",
        "We remove all fraud from the process.",
        "You are 100% protected.",
        "Every job is fully covered.",
        "We hold your money safely.",
        # The passive. Added 4 Sep 2026, because the active-voice pattern was
        # the only one there and this is the form the model actually writes.
        "Your money is held and released stage by stage.",
        "We are holding your money until the work is proven.",
    ],
)
def test_banned_language_is_caught(text: str) -> None:
    assert scan(text), f"guardrail missed: {text!r}"
    with pytest.raises(GuardrailViolation):
        assert_clean(text)


def test_approved_language_passes() -> None:
    assert_clean(
        "Payment is held safely with a licensed payment provider and released to the worker "
        "within 24 hours of your approval. Work is protected up to the guarantee limit."
    )


def test_the_principal_wording_the_assistant_now_uses_passes() -> None:
    # The replacement for the retired "money is held" fact. If a future edit
    # widens the passive pattern far enough to catch this, the screen would
    # block the very sentence it is meant to leave standing.
    assert_clean(
        "You pay Yaadly, not the tradesperson. Yaadly sells you the job at one agreed price, "
        "engages a vetted tradesperson and pays them directly. Payment terms are agreed in "
        "writing for each job, and a named person approves every release."
    )


@pytest.mark.parametrize("decider", ["", "ai", "AGENT", "system", "auto"])
def test_ai_cannot_take_money_decisions(decider: str) -> None:
    with pytest.raises(GuardrailViolation):
        assert_human_decision("release_funds", decider)


def test_named_human_can_take_money_decisions() -> None:
    assert_human_decision("release_funds", "Monique Sewell-Bennett")
    out = verification.release_funds("JOB-001", 400.0, decided_by="Monique Sewell-Bennett")
    assert out["status"].endswith("human approved")


def test_ai_cannot_alter_a_yaad_score() -> None:
    with pytest.raises(GuardrailViolation):
        assert_human_decision("adjust_yaad_score", "ai")


# --------------------------------------------------------------------- #
# Pricing: never invent a number
# --------------------------------------------------------------------- #

def test_no_public_price_is_reported_as_such() -> None:
    card = intake.JobCard(trade="painting", variant="*", parish="Kingston")
    opinion = pricing.run(card)
    assert not opinion.is_benchmarked
    assert "no public price exists" in opinion.summary_line().lower()


def test_known_benchmark_returns_a_band() -> None:
    card = intake.JobCard(trade="roofing", variant="minor", parish="St Catherine")
    opinion = pricing.run(card)
    assert opinion.is_benchmarked and opinion.confidence == "high"


def test_wild_quote_is_flagged_red() -> None:
    card = intake.JobCard(trade="roofing", variant="minor", parish="St Catherine")
    assert pricing.review_quote(card, 600_000)["verdict"] == "red flag"


def test_sane_quote_is_not_flagged_red() -> None:
    card = intake.JobCard(trade="roofing", variant="minor", parish="St Catherine")
    assert pricing.review_quote(card, 80_000)["verdict"] == "within the expected range"


def test_fees_never_touch_materials() -> None:
    fees = bm.fee_breakdown(labour_gbp=100.0, materials_gbp=500.0)
    assert fees["client_fee_gbp"] == 15.0
    assert fees["worker_fee_gbp"] == 12.0
    assert fees["client_pays_gbp"] == 615.0
    assert fees["worker_receives_gbp"] == 88.0


# --------------------------------------------------------------------- #
# Verification
# --------------------------------------------------------------------- #

def test_complete_package_passes() -> None:
    result = verification.run(by_ref("JOB-001").evidence)
    assert result.complete and not result.blocking


def test_thin_package_blocks() -> None:
    result = verification.run(by_ref("JOB-003").evidence)
    assert not result.complete
    assert any("Site match" in c.name for c in result.blocking)


def test_out_of_sequence_evidence_blocks() -> None:
    pkg = EvidencePackage(
        job_id="X",
        worker_id="W",
        site_match_confirmed=True,
        arrival_log=[MediaItem("photo", datetime(2026, 12, 11, 18, 0), True, f"arrival {i}") for i in range(3)],
        midnight_work_log=[
            MediaItem("video", datetime(2026, 12, 11, 9, 0), True, "wide pan", duration_s=30),
            MediaItem("photo", datetime(2026, 12, 11, 9, 1), True, "close anchor"),
            MediaItem("photo", datetime(2026, 12, 11, 9, 2), True, "corner detail"),
        ],
    )
    result = verification.run(pkg)
    assert any(c.name == "Evidence sequence" for c in result.blocking)


def test_verification_never_returns_a_ruling() -> None:
    pack = verification.run(by_ref("JOB-001").evidence).human_decision_pack()
    assert "This is not a ruling" in pack
    assert "does not release funds" in pack


# --------------------------------------------------------------------- #
# Agents end to end, mock mode
# --------------------------------------------------------------------- #

def test_intake_reads_patois_and_finds_the_parish(client: LLMClient) -> None:
    scenario = by_ref("JOB-001")
    card = intake.run(client, scenario.client_message, photo_captions=scenario.photo_captions)
    assert card.trade == "roofing"
    assert card.parish != "unknown"
    assert card.urgency in {"urgent", "emergency"}


def test_thin_brief_asks_back_and_is_not_quotable(client: LLMClient) -> None:
    card = intake.run(client, by_ref("JOB-002").client_message)
    assert card.clarifying_questions
    assert not card.ready_to_quote


def test_intake_never_asks_more_than_three_questions(client: LLMClient) -> None:
    card = intake.run(client, "fix it")
    assert len(card.clarifying_questions) <= 3


def test_reporting_output_is_guardrail_clean(client: LLMClient) -> None:
    scenario = by_ref("JOB-001")
    report = reporting.run(client, scenario.worker_update, job_ref=scenario.ref, trade="roofing")
    message = report.whatsapp_message(scenario.client_name, scenario.ref)
    assert not scan(message)
    assert "escrow" not in message.lower()


def test_mock_output_is_always_labelled(client: LLMClient) -> None:
    card = intake.run(client, by_ref("JOB-002").client_message)
    assert card.mocked is True
    assert all(c.mode == "mock" for c in client.calls)


# --------------------------------------------------------------------- #
# Plumbing
# --------------------------------------------------------------------- #

@pytest.mark.parametrize(
    "raw",
    ['{"a": 1}', '```json\n{"a": 1}\n```', 'Sure! Here you go:\n{"a": 1}\nHope that helps.'],
)
def test_json_extraction_survives_chatty_models(raw: str) -> None:
    assert _extract_json(raw) == {"a": 1}


# --------------------------------------------------------------------- #
# Telemetry: every money and guardrail decision must emit a bounded event,
# and never a free-text one, alongside whatever it already did.
# --------------------------------------------------------------------- #

def test_sdk_is_available_in_this_environment() -> None:
    # opentelemetry-sdk is a first-class dependency now (requirements.txt),
    # not an optional extra, so it must always be importable here. The rest
    # of the module still no-ops gracefully if it is ever absent elsewhere.
    #
    # THE ASSERTION IS UNCHANGED. Only the message is new, added 4 September
    # 2026 after this failed on the founder's laptop and said nothing except
    # "assert False is True", which sent a session chasing pip before anyone
    # looked at the Python version. The dependency is pinned at a release whose
    # metadata says Requires-Python >=3.10; macOS ships 3.9 as
    # /usr/bin/python3, so on a fresh Mac the install fails and then this test
    # fails, and neither of them explains the other. A test that knows why it
    # failed should say so.
    assert telemetry.enabled() is True, (
        "opentelemetry-sdk is not importable, so telemetry is disabled.\n"
        f"This interpreter is Python {sys.version.split()[0]} at {sys.executable}.\n"
        "requirements.txt needs Python 3.10 or newer (CI runs 3.11 and 3.12), and\n"
        "macOS ships 3.9 as /usr/bin/python3. If `pip install -r requirements.txt`\n"
        "said 'No matching distribution found', that is the same problem, not a\n"
        "separate one. See the README run instructions for the venv line."
    )


def test_banned_language_violation_emits_a_bounded_event(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[tuple[str, dict]] = []
    monkeypatch.setattr(yaad_guardrails, "record_guardrail_event", lambda name, attrs: events.append((name, attrs)))
    with pytest.raises(GuardrailViolation):
        assert_clean("Your money sits in escrow until the job is done.", where="Client Update")
    assert len(events) == 1
    name, attrs = events[0]
    assert name == "guardrail.banned_language"
    assert attrs["where"] == "Client Update"
    # The event carries the fixed, closed-set guidance string from
    # BANNED_TERMS, never the sentence that was actually being screened.
    assert attrs["terms"] == "Use 'held safely with a licensed payment provider', never 'escrow'."
    assert "sits in escrow until the job is done" not in attrs["terms"]


def test_blocked_ai_decision_emits_a_bounded_event(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[tuple[str, dict]] = []
    monkeypatch.setattr(yaad_guardrails, "record_guardrail_event", lambda name, attrs: events.append((name, attrs)))
    with pytest.raises(GuardrailViolation):
        assert_human_decision("release_funds", "ai")
    assert events == [("guardrail.blocked_ai_decision", {"action": "release_funds"})]


def test_release_funds_emits_a_bounded_event_and_never_the_decider_name(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[tuple[str, dict]] = []
    monkeypatch.setattr(verification, "record_guardrail_event", lambda name, attrs: events.append((name, attrs)))
    verification.release_funds("JOB-001", 400.0, decided_by="Monique Sewell-Bennett")
    assert len(events) == 1
    name, attrs = events[0]
    assert name == "guardrail.money.released"
    assert attrs == {"job.id": "JOB-001", "amount_gbp": 400.0, "decider.role": "human"}
    assert "Monique" not in str(attrs)


def test_telemetry_init_is_silent_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    telemetry.init()  # must not raise, and must not require a collector


def test_telemetry_init_does_not_raise_when_pointed_at_a_collector(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
    telemetry.init()  # activating the instrumentor must not itself require a live collector


def test_json_extraction_raises_on_garbage() -> None:
    with pytest.raises(ValueError):
        _extract_json("no json here at all")
