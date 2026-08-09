# Yaad Trust Engine

The agentic layer inside **Yaadly**, a trust-first managed marketplace connecting the Jamaican diaspora and local clients with vetted tradespeople.

Track 02, Finance, Payments & MSME Capital. Future Caribbean Global Open-Source Agentic AI Buildathon.

**Governing rule, enforced in code and not in a prompt:** AI coordinates, verifies and drafts. It never releases money, rules on a dispute, or alters a reputation. A named human confirms every consequential step. See `yaad/guardrails.py` and the tests that prove it.

---

## The problem, in one paragraph

Jamaica received US$3.49bn in remittances in 2025, a large share of it maintaining family property. That money moves blind: the diaspora client cannot see the site, has no proof of work, and no recourse. The worker does the job, gets stiffed, and has no record that would ever satisfy a bank. On top of that, property work in Jamaica is priced privately in WhatsApp DMs. There is no public price for painting, bathrooms, septic or block walls anywhere in the country, which is exactly what lets an overseas owner be quoted more than the neighbour for identical work.

## What this repository is

A runnable implementation of the verified job loop, built for WhatsApp-shaped, low-bandwidth conditions.

| Agent | File | What it does | What it must never do |
|---|---|---|---|
| Intake | `yaad/agents/intake.py` | Turns typed text, photo captions, or a Patois voice-note transcript into a structured Job Card. Asks at most three clarifying questions. | Quote a price. Promise a timeline. Ask the client to rephrase. |
| Pricing | `yaad/agents/pricing.py` | Returns a fair-price band from seeded benchmark data, with confidence and source. Reviews the *shape* of a worker's quote. | Invent a number. Where no public price exists it says so. |
| Verification | `yaad/agents/verification.py` | Checks the evidence chain (Arrival Log, materials receipts, Midnight Work-Log) for completeness, sequencing and plausibility. Produces a pack for a human. | Adjudicate. Release funds. Touch a Yaad Score. |
| Reporting | `yaad/agents/reporting.py` | Converts a worker's update into a plain-English status report for an overseas client. | Add detail the worker did not give. Promise the work is good or that payment will move. |

Two design choices worth defending:

**Pricing is deliberately not an LLM.** The founding premise is that a client in London pays what a client in Portmore pays. A hallucinated price band would break exactly the thing the product exists to fix, so pricing is a lookup against researched benchmarks (`yaad/benchmarks.py`, sourced from government ROOFS grant tiers, vendor material prices and collected day rates) and it returns "no public price exists in Jamaica for this work" rather than a guess.

**The site-match gate protects the worker, not just the client.** If the site does not match what the client described, the worker should not be held to a job they were mis-sold. That is the Mirror Rule in code: every protection has a named counterpart on the other side.

## Run it

```bash
pip install -r requirements.txt
python run_demo.py            # all three scenarios
python run_demo.py JOB-001    # one scenario
python -m pytest -q           # 31 tests
```

With no API key it runs in **mock mode**: deterministic, rule based, and every mocked line is labelled `(mock)` in the output. Nothing mocked can be mistaken for a live model result.

## Point it at a model

The engine is provider agnostic by design. It speaks the OpenAI chat completions API, so any
OpenAI-compatible endpoint works by setting two environment variables. This was a deliberate day-one
decision: the buildathon gateway key had not been issued when the build started, and the engine was
written so that a missing key was a configuration state rather than a blocker.

Running against MiniMax, one of the buildathon partner platforms:

```bash
export YAAD_API_KEY="your-minimax-api-key"
export YAAD_BASE_URL="https://api.minimax.io/v1"
export YAAD_MODEL="MiniMax-M2"
python run_demo.py
```

Other endpoints verified as drop-in compatible: Nebius Token Factory
(`https://api.tokenfactory.nebius.com/v1/`) and the Impala gateway
(`https://ht.getimpala.ai/v1`, model `qwen3.6-27b`), which is the built-in default.

| Variable | Default | Notes |
|---|---|---|
| `YAAD_API_KEY` | unset | Unset means mock mode. |
| `YAAD_BASE_URL` | `https://ht.getimpala.ai/v1` | Any OpenAI-compatible endpoint. |
| `YAAD_MODEL` | `qwen3.6-27b` | |
| `YAAD_TEMPERATURE` | `0.2` | Low on purpose. This is extraction, not creative writing. |
| `YAAD_TIMEOUT` | `60` | Seconds. |

## Scenarios

Three scripted jobs written against the planned December pilot in Portmore. Synthetic identities only. No real client, worker, ID or payment data appears anywhere in this repository.

- **JOB-001** Roof leak, diaspora client in London, Patois voice note, complete evidence package. Passes every gate.
- **JOB-002** "Need the house painted. How much?" No parish, no photos, no public benchmark. The engine asks back rather than guessing.
- **JOB-003** Water tank install, Toronto client. Evidence package fails four gates including site match. Held for a human.

## What is deliberately not here

- No payment integration. Money is held with a licensed payment provider and Yaadly orchestrates the flow rather than holding funds. That structure is under legal review and no code should imply it is settled.
- No dispute ruling. The Evidence & Dispute Agent assembles a pack; the ruling is a human decision on a published timeline.
- No Yaad Score mutation. Reputation is consequential, so it is human gated.
- No real data of any kind.

## Roadmap

1. WhatsApp Business API transport in front of the Intake and Reporting agents.
2. Evidence ingestion from real device capture, with EXIF and location extraction replacing the `MediaItem` stubs.
3. The quote log as a persistent store, so every reviewed quote compounds into the fair-price database.
4. Yaad Score computation, read-only, from completed and human-approved jobs.

## Licence

MIT. See [`LICENSE`](LICENSE). The code in this repository is open source and free to use, modify and distribute.

Two things the MIT licence does not cover, stated plainly so nobody has to guess:

- **Brand.** "Yaadly", "YaadlyHub", "Yaad Score" and the associated marks belong to Yaadly Ltd (England & Wales, no. 17358077). The licence grants no trademark rights.
- **Operating playbook and proprietary data.** The benchmark values in `yaad/benchmarks.py` are a small seeded set derived from public sources (government grant tiers, published vendor prices, collected day rates) and are included so the pipeline runs. The wider cost research, the fee structure, the evidence and release rules and the compounding quote log are the company's operating playbook and are not part of this repository.
