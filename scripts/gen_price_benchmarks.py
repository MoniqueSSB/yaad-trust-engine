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
    # Fencing is deliberately NOT mapped. The only metalwork band on file is a
    # window or door grill from a single seller in St Ann, and checking a
    # fence quote against a window grill is a wrong reference dressed as a
    # right one. An unmapped trade is simply not offered, which is the honest
    # outcome: there is no fencing benchmark.
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


WEB_TS = ROOT / "web" / "lib" / "portal" / "price-bands.ts"


def web_module() -> str:
    """The same numbers again, as a TypeScript module for the web app.

    A third consumer, and the reason the generator exists rather than three
    hand-typed tables: the engine reads them in Python, the desk in a script
    block, and from 5 September 2026 the client and the worker see them on a
    quote. Three copies edited by hand would be three different price lists
    inside a week, and the whole premise is that a client in London pays what
    a client in Portmore pays.
    """
    body = json.dumps(payload(), indent=2, ensure_ascii=False)
    return (
        "// GENERATED FILE, do not edit by hand.\n"
        "//\n"
        "// Source: yaad/benchmarks.py. Regenerate with\n"
        "//   python3 scripts/gen_price_benchmarks.py\n"
        "// tests/test_price_benchmarks.py fails if this drifts from the source.\n"
        "//\n"
        "// CLAUDE.md section 5: pricing is a LOOKUP, never a model. Nothing that\n"
        "// imports this may interpolate, average or smooth a band, and where a band\n"
        "// says no public price exists in Jamaica, that is a correct and complete\n"
        "// answer rather than a gap to fill.\n\n"
        "export type GeneratedBand = {\n"
        "  label: string;\n"
        "  low_jmd: number | null;\n"
        "  high_jmd: number | null;\n"
        "  low_gbp: number | null;\n"
        "  high_gbp: number | null;\n"
        "  confidence: string;\n"
        "  source: string;\n"
        "  note: string;\n"
        "};\n\n"
        "export type PriceBenchmarks = {\n"
        "  generated_from: string;\n"
        "  jmd_per_gbp: number;\n"
        "  market_context: string;\n"
        "  day_rates_jmd: Record<string, number[]>;\n"
        "  materials_jmd: Record<string, number[]>;\n"
        "  bands: Record<string, GeneratedBand>;\n"
        "  taxonomy_to_benchmark: Record<string, string>;\n"
        "};\n\n"
        f"export const PRICE_BENCHMARKS: PriceBenchmarks = {body} as const;\n"
    )


def main() -> None:
    changed = write_into(ROOT / "concierge" / "concierge.html")
    print(("updated  " if changed else "in step  ") + "concierge/concierge.html")

    new = web_module()
    old = WEB_TS.read_text(encoding="utf-8") if WEB_TS.exists() else None
    if old != new:
        WEB_TS.parent.mkdir(parents=True, exist_ok=True)
        WEB_TS.write_text(new, encoding="utf-8")
        print("updated  " + str(WEB_TS.relative_to(ROOT)))
    else:
        print("in step  " + str(WEB_TS.relative_to(ROOT)))


if __name__ == "__main__":
    main()
