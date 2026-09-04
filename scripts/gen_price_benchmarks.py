#!/usr/bin/env python3
"""Generate the desk's copy of the price benchmarks from yaad/benchmarks.py.

CLAUDE.md §5 is the reason this script exists rather than a second hand-typed
table. Pricing is a LOOKUP, never a model, and the founding premise is that a
client in London pays what a client in Portmore pays. A second copy of the
numbers is a second set of numbers the moment somebody edits one of them, and
a wrong band is worse than no band because it looks like an answer.

So: `yaad/benchmarks.py` stays the source, this writes the desk's copy, and
`tests/test_price_benchmarks.py` re-runs it and fails if the file on disk has
drifted. Same shape as the trades list, same reason.

Run it after changing a band:

    python3 scripts/gen_price_benchmarks.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from yaad import benchmarks as bm  # noqa: E402

# The desk speaks the 18 taxonomy trades. The benchmarks were seeded against
# the engine's own shorter vocabulary, so one has to be mapped onto the other
# and it may as well be here, in the open, rather than guessed at by a regex
# in a page. A taxonomy trade with no benchmark family is simply absent, which
# the panel reports as "no public price exists" rather than inventing a family
# for it.
TAXONOMY_TO_BENCHMARK = {
    "Roofing": "roofing",
    "Plumbing": "plumbing",
    "Drainage & Septic": "plumbing",
    "Water Tank & Pump": "plumbing",
    "Masonry & Concrete": "masonry",
    "Painting & Decorating": "painting",
    "Grille & Gate Welding": "metalwork",
    "Fencing": "metalwork",
    "Landscaping": "grounds",
    "General Handyman": "general repair",
}


def payload() -> dict:
    bands = {}
    for key, b in bm.JOB_BANDS.items():
        gbp = b.gbp()
        bands[key] = {
            "label": b.label,
            "low_jmd": b.low_jmd,
            "high_jmd": b.high_jmd,
            "low_gbp": gbp[0] if gbp else None,
            "high_gbp": gbp[1] if gbp else None,
            "confidence": b.confidence,
            "source": b.source,
            "note": b.note,
        }
    return {
        "generated_from": "yaad/benchmarks.py",
        "jmd_per_gbp": bm.JMD_PER_GBP,
        "market_context": bm.MARKET_CONTEXT,
        "day_rates_jmd": {k: list(v) for k, v in bm.DAY_RATES_JMD.items()},
        "materials_jmd": {k: list(v) for k, v in bm.MATERIALS_JMD.items()},
        "bands": bands,
        "taxonomy_to_benchmark": TAXONOMY_TO_BENCHMARK,
    }


BEGIN = "/* BEGIN GENERATED PRICE BENCHMARKS, do not edit by hand */"
END = "/* END GENERATED PRICE BENCHMARKS */"


def block() -> str:
    body = json.dumps(payload(), indent=2, ensure_ascii=False)
    return (
        f"{BEGIN}\n"
        f"// Source: yaad/benchmarks.py. Regenerate with\n"
        f"//   python3 scripts/gen_price_benchmarks.py\n"
        f"// tests/test_price_benchmarks.py fails if this drifts from the source.\n"
        f"const PRICE_BENCHMARKS = {body};\n"
        f"{END}"
    )


def write_into(path: Path) -> bool:
    src = path.read_text(encoding="utf-8")
    new = block()
    pattern = re.compile(re.escape(BEGIN) + r".*?" + re.escape(END), re.S)
    if not pattern.search(src):
        raise SystemExit(
            f"{path} has no generated block. Add these two lines where the data should go:\n"
            f"{BEGIN}\n{END}"
        )
    out = pattern.sub(lambda _: new, src)
    if out == src:
        return False
    path.write_text(out, encoding="utf-8")
    return True


def main() -> None:
    targets = [ROOT / "concierge" / "concierge.html"]
    for t in targets:
        changed = write_into(t)
        print(("updated  " if changed else "in step  ") + str(t.relative_to(ROOT)))


if __name__ == "__main__":
    main()
