"""Seeded fair-price reference data.

Source: Yaadly_Cost_Benchmarks.md v1.1, researched 1 Aug 2026.
FX used throughout: GBP 1 ~ J$210, US$1 ~ J$158.

Confidence is carried through to the client, because the honest answer for
several trades is "no public price exists in Jamaica for this". That gap is
the reason the product exists, so the Pricing Agent says so out loud rather
than inventing a number.
"""

from __future__ import annotations

from dataclasses import dataclass

JMD_PER_GBP = 210.0


@dataclass(frozen=True)
class PriceBand:
    label: str
    low_jmd: float | None
    high_jmd: float | None
    confidence: str
    source: str
    note: str = ""

    @property
    def has_band(self) -> bool:
        return self.low_jmd is not None and self.high_jmd is not None

    def gbp(self) -> tuple[float, float] | None:
        if not self.has_band:
            return None
        return round(self.low_jmd / JMD_PER_GBP), round(self.high_jmd / JMD_PER_GBP)


# Day rates, used to sanity check the labour half of any quote.
DAY_RATES_JMD: dict[str, tuple[float, float]] = {
    "general labourer": (3000, 3500),
    "skilled mason": (7000, 12000),
    "roofing": (7000, 12000),
    "plumbing": (7000, 12000),
    "electrical": (7000, 12000),
    "masonry": (7000, 12000),
    "painting": (7000, 12000),
    "metalwork": (7000, 12000),
}

MATERIALS_JMD: dict[str, tuple[float, float]] = {
    "cement (42.5kg bag)": (1400, 2000),
    "6in concrete block": (140, 280),
    "plywood sheet": (3450, 7190),
    "zinc roof sheet": (5000, 5000),
    "emulsion paint (gallon)": (5000, 6500),
    "treated lumber 2x4 (per ft)": (120, 120),
}

JOB_BANDS: dict[str, PriceBand] = {
    "roofing:minor": PriceBand(
        "Minor roof repair", 75_000, 75_000, "high", "Government ROOFS grant tier"
    ),
    "roofing:major": PriceBand(
        "Major roof damage repair", 200_000, 200_000, "high", "Government ROOFS grant tier"
    ),
    "roofing:severe": PriceBand(
        "Severe roof or structural reconstruction", 200_000, 500_000, "high", "Government ROOFS grant tier"
    ),
    "roofing:*": PriceBand(
        "Roof repair, tier unconfirmed", 75_000, 200_000, "high", "Government ROOFS grant tiers",
        note="Spans the minor to major tiers. Confirm the tier before quoting.",
    ),
    "metalwork:grill": PriceBand(
        "Window or door grill, custom", 25_000, 30_000, "low", "Single seller, St Ann",
        note="One vendor only. Treat as indicative, not a benchmark.",
    ),
    "plumbing:unclog": PriceBand(
        "Unclog drain", 1_664, 3_750, "medium", "UWI card 2019-20, inflated 30 to 50 percent",
        note="Base figures are dated. Inflation applied.",
    ),
    "plumbing:tank": PriceBand(
        "Water tank install", 18_850, 21_750, "medium", "UWI card 2019-20, inflated 30 to 50 percent"
    ),
    "grounds:monthly": PriceBand(
        "Gardener, monthly", 10_000, 25_000, "high", "Three corroborating sources"
    ),
    # The honest gaps. Do not fill these with guesses.
    "painting:*": PriceBand("Painting", None, None, "none", "No public price exists in Jamaica",
                            note="Price from materials plus day rate, and log the quote."),
    "masonry:*": PriceBand("Block wall", None, None, "none", "No public price exists in Jamaica",
                           note="Price from materials plus day rate, and log the quote."),
    "plumbing:septic": PriceBand("Septic", None, None, "none", "No public price exists in Jamaica"),
    "general repair:*": PriceBand("General repair", None, None, "none", "No public price exists in Jamaica"),
}

# Fees, from the locked decisions. Labour only, never materials.
CLIENT_FEE = 0.15
WORKER_FEE = 0.12
CARD_RATE = 0.025
PAYOUT_FEE_GBP = 3.0

MARKET_CONTEXT = (
    "Prices trend up through 2026 and 2027: Hurricane Melissa (Oct 2025) spiked demand for zinc, ply and "
    "lumber, mining output fell 37.5 percent per STATIN pushing materials up, and a Feb 2025 collective "
    "labour agreement adds 19 percent to construction wages over two years."
)


def lookup(trade: str, variant: str = "*") -> PriceBand | None:
    return JOB_BANDS.get(f"{trade}:{variant}") or JOB_BANDS.get(f"{trade}:*")


def day_rate(trade: str) -> tuple[float, float]:
    return DAY_RATES_JMD.get(trade, DAY_RATES_JMD["skilled mason"])


def fee_breakdown(labour_gbp: float, materials_gbp: float = 0.0) -> dict[str, float]:
    """Fees apply to labour only. Materials pass through untouched."""
    client_fee = round(labour_gbp * CLIENT_FEE, 2)
    worker_fee = round(labour_gbp * WORKER_FEE, 2)
    client_pays = round(labour_gbp + materials_gbp + client_fee, 2)
    worker_receives = round(labour_gbp - worker_fee, 2)
    card_cost = round(client_pays * CARD_RATE, 2)
    net = round(client_fee + worker_fee - card_cost - PAYOUT_FEE_GBP, 2)
    return {
        "labour_gbp": round(labour_gbp, 2),
        "materials_gbp": round(materials_gbp, 2),
        "client_fee_gbp": client_fee,
        "worker_fee_gbp": worker_fee,
        "client_pays_gbp": client_pays,
        "worker_receives_gbp": worker_receives,
        "card_cost_gbp": card_cost,
        "yaadly_net_gbp": net,
    }
