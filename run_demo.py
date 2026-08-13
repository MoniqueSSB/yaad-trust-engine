#!/usr/bin/env python3
"""Run the Yaad Trust Engine loop end to end over the scripted scenarios.

    python run_demo.py              # all scenarios
    python run_demo.py JOB-001      # one scenario

With no YAAD_API_KEY set it runs in MOCK mode and says so on every line that
came from a mock. With a key set it calls the Impala gateway (or any other
OpenAI-compatible endpoint you point it at).
"""

from __future__ import annotations

import sys

from yaad import benchmarks as bm
from yaad.agents import intake, pricing, reporting, verification
from yaad.config import load_config
from yaad.guardrails import GuardrailViolation
from yaad.llm import LLMClient
from yaad.scenarios import SCENARIOS, by_ref

RULE = "=" * 78
THIN = "-" * 78


def banner(config) -> None:
    print(RULE)
    print("YAAD TRUST ENGINE  |  verified job loop, Jamaica corridor")
    print(f"Inference: {config.provider_label}")
    if not config.live:
        print("Mock mode is deterministic and rule based. Nothing here is a live model result.")
    print("Governing rule: AI coordinates, verifies and drafts. Humans decide money and trust.")
    print(RULE)


def run_scenario(client: LLMClient, scenario) -> None:
    print(f"\n{RULE}\n{scenario.ref}  {scenario.title}\n{RULE}")

    # 1. Intake
    print("\n[1] INTAKE AGENT")
    print(THIN)
    print(f"Client ({scenario.client_name}) said:\n  \"{scenario.client_message.strip()[:400]}\"")
    card = intake.run(client, scenario.client_message, photo_captions=scenario.photo_captions)
    tag = "  (mock)" if card.mocked else ""
    print(f"\nJob Card{tag}:")
    print(f"  trade      : {card.trade} / {card.variant}")
    print(f"  scope      : {card.scope_summary}")
    print(f"  urgency    : {card.urgency}")
    print(f"  parish     : {card.parish}")
    print(f"  access     : {card.access_notes}")
    print(f"  confidence : {card.confidence}")
    if card.clarifying_questions:
        print("  asks back  :")
        for q in card.clarifying_questions:
            print(f"    - {q}")
    print(f"  ready to quote: {card.ready_to_quote}")

    # 2. Pricing
    print("\n[2] PRICING AGENT  (lookup, not a model. No invented numbers.)")
    print(THIN)
    opinion = pricing.run(card)
    print(f"  {opinion.summary_line()}")
    for note in opinion.notes:
        print(f"  note: {note}")

    if scenario.quoted_jmd:
        print("\n  Deposit Protection Check, shape review of the worker's quote:")
        review = pricing.review_quote(card, scenario.quoted_jmd)
        print(f"    quoted : J${review['quoted_jmd']:,.0f} (about GBP {review['quoted_gbp']:,})")
        print(f"    verdict: {review['verdict']}")
        for flag in review["flags"]:
            print(f"    flag   : {flag}")
        print("    scope  : deal structure and quote shape only. Price estimation is QS work, not ours.")

        labour = scenario.quoted_jmd * 0.6 / bm.JMD_PER_GBP
        materials = scenario.quoted_jmd * 0.4 / bm.JMD_PER_GBP
        fees = bm.fee_breakdown(labour, materials)
        print("\n  Money shape (fees on labour only, illustrative 60/40 split):")
        print(f"    client pays     GBP {fees['client_pays_gbp']:,.2f}")
        print(f"    worker receives GBP {fees['worker_receives_gbp']:,.2f}")
        print(f"    Yaadly net      GBP {fees['yaadly_net_gbp']:,.2f}")

    # 3. Verification
    if scenario.evidence:
        print("\n[3] VERIFICATION AGENT  (flags gaps, rules on nothing)")
        print(THIN)
        result = verification.run(scenario.evidence)
        print(result.human_decision_pack())
        print("\n  Attempting an automatic payout to prove the guardrail holds:")
        try:
            verification.release_funds(scenario.ref, 400.0, decided_by="ai")
            print("    ERROR: the guardrail did not fire. This is a bug.")
        except GuardrailViolation as exc:
            # Only the guardrail's own exception counts as "blocked as designed".
            # Anything else (TypeError from a signature change, a bug inside
            # release_funds) must surface as a real failure, matching what
            # tests/test_engine.py pins with pytest.raises(GuardrailViolation).
            print(f"    blocked as designed: {exc}")
        approved = verification.release_funds(scenario.ref, 400.0, decided_by="Monique Sewell-Bennett")
        print(f"    with a named human: {approved['status']}")

    # 4. Reporting
    if scenario.worker_update:
        print("\n[4] REPORTING AGENT")
        print(THIN)
        print(f"Worker sent:\n  \"{scenario.worker_update.strip()[:400]}\"")
        report = reporting.run(client, scenario.worker_update, job_ref=scenario.ref, trade=card.trade)
        tag = "  (mock)" if report.mocked else ""
        print(f"\nClient-facing message{tag}:")
        for line in report.whatsapp_message(scenario.client_name, scenario.ref).splitlines():
            print(f"  {line}")


def main(argv: list[str]) -> int:
    config = load_config()
    client = LLMClient(config=config)
    banner(config)

    targets = [by_ref(argv[1])] if len(argv) > 1 else SCENARIOS
    for scenario in targets:
        run_scenario(client, scenario)

    print(f"\n{RULE}")
    counts = client.call_counts
    print(
        f"Model calls: {counts.get('live', 0)} live, {counts.get('mock', 0)} mock, "
        f"{counts.get('error', 0)} failed, across {len(targets)} scenario(s)."
    )
    print(RULE)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
