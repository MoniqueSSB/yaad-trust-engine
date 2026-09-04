"""The desk's price benchmarks are the engine's, or the build fails.

CLAUDE.md §5: pricing is a lookup against researched benchmarks, never a
model, because the founding premise is that a client in London pays what a
client in Portmore pays. A hallucinated band breaks exactly the thing this
business exists to fix, and so, more quietly, does a stale second copy of the
table. A wrong band is worse than no band: it looks like an answer.

The desk needs those numbers in the page, because it is a static file with no
server behind it. So they are GENERATED from `yaad/benchmarks.py` by
`scripts/gen_price_benchmarks.py`, and these tests fail if the file on disk
has drifted from the source. Regenerate, do not hand-edit.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.gen_price_benchmarks import BEGIN, END, TAXONOMY_TO_BENCHMARK, payload  # noqa: E402

DESK = ROOT / "concierge" / "concierge.html"


def desk_payload() -> dict:
    src = DESK.read_text(encoding="utf-8")
    m = re.search(re.escape(BEGIN) + r".*?const PRICE_BENCHMARKS = (\{.*?\});\s*" + re.escape(END), src, re.S)
    assert m, "no generated price benchmark block in concierge.html"
    return json.loads(m.group(1))


def test_the_desk_copy_matches_the_engine() -> None:
    # If this fails somebody edited a band in one place. Run
    # `python3 scripts/gen_price_benchmarks.py` rather than editing the page.
    assert desk_payload() == payload()


def test_regenerating_is_a_no_op() -> None:
    """The committed file is what the generator produces, byte for byte."""
    before = DESK.read_text(encoding="utf-8")
    subprocess.run([sys.executable, "scripts/gen_price_benchmarks.py"], cwd=ROOT, check=True, capture_output=True)
    assert DESK.read_text(encoding="utf-8") == before, "regenerate and commit the result"


def test_the_honest_gaps_survive_generation() -> None:
    """The bands with no number are the point, not an omission.

    "No public price exists in Jamaica for this work" is a correct and
    complete answer (CLAUDE.md §5). If generation ever quietly dropped the
    null bands, the desk would show a gap as though it had simply not been
    looked up, which is a different and much weaker statement.
    """
    bands = desk_payload()["bands"]
    for key in ("painting:*", "masonry:*", "plumbing:septic", "general repair:*"):
        assert key in bands, f"the honest gap {key} is missing from the desk copy"
        assert bands[key]["low_jmd"] is None
        assert bands[key]["high_jmd"] is None
        assert bands[key]["confidence"] == "none"


def test_every_mapped_taxonomy_trade_reaches_a_real_band_family() -> None:
    """A mapping that points at nothing is worse than no mapping.

    The desk speaks the 18 taxonomy trades; the benchmarks were seeded against
    the engine's shorter vocabulary. Each mapped trade must land on a family
    that actually has at least one band, otherwise the panel would claim to
    have looked and found nothing when in truth it looked in the wrong place.
    """
    families = {k.split(":", 1)[0] for k in payload()["bands"]}
    for trade, family in TAXONOMY_TO_BENCHMARK.items():
        assert family in families, f"{trade} maps to {family!r}, which has no bands"


@pytest.mark.parametrize("trade", ["Roofing", "Plumbing", "Masonry & Concrete", "Painting & Decorating"])
def test_mapped_trades_resolve_the_way_the_engine_would(trade: str) -> None:
    """The desk lookup and the engine lookup agree on the same input."""
    from yaad import benchmarks as bm

    family = TAXONOMY_TO_BENCHMARK[trade]
    engine = bm.lookup(family, "*")
    desk = desk_payload()["bands"].get(f"{family}:*")
    assert (engine is None) == (desk is None), f"{trade}: engine and desk disagree on whether a band exists"
    if engine is not None:
        assert desk["label"] == engine.label
        assert desk["low_jmd"] == engine.low_jmd
        assert desk["confidence"] == engine.confidence


def test_no_mapped_trade_can_falsely_claim_there_is_no_price() -> None:
    """A trade with real bands must never resolve to "no public price exists".

    This is the bug this test exists for, found by review before it shipped.
    Six of the ten mapped trades have real bands and NO ":*" default: plumbing
    has unclog, tank and septic and nothing generic, and so do metalwork and
    grounds. The desk originally fell back to null for those and rendered "no
    public price exists in Jamaica for this work", which is false for plumbing.

    That sentence is the one the whole product is built on. Saying it when it
    is untrue is as damaging as inventing a number, so the desk now separates
    "there is no price" from "say which kind of job". This asserts the data
    supports that distinction: a family must either have a usable default, or
    have named variants to offer, and never neither.
    """
    p = payload()
    bands = p["bands"]
    for trade, family in p["taxonomy_to_benchmark"].items():
        has_default = f"{family}:*" in bands
        variants = [k.split(":", 1)[1] for k in bands if k.split(":", 1)[0] == family and not k.endswith(":*")]
        assert has_default or variants, (
            f"{trade} maps to {family!r}, which has no default band and no variants, "
            "so the desk could only report it as 'no public price exists', which would be a guess"
        )


def test_fencing_is_not_mapped_to_the_window_grill_band() -> None:
    """Deliberately unmapped, and it should stay that way.

    The only metalwork band on file is a window or door grill from a single
    seller in St Ann, marked low confidence and "treat as indicative, not a
    benchmark". Checking a fence quote against it is a wrong reference dressed
    as a right one, which is worse than having no reference at all.
    """
    assert "Fencing" not in TAXONOMY_TO_BENCHMARK
