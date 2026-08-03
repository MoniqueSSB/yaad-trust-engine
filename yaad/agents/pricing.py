"""Pricing Agent.

Deliberately not an LLM. It is a lookup against seeded benchmark data, because
the whole founding premise is that a client in London pays what a client in
Portmore pays. A hallucinated band would be worse than no band, so where no
public price exists in Jamaica the agent says exactly that and falls back to
materials plus day rate.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .. import benchmarks as bm
from .intake import JobCard


@dataclass
class PriceOpinion:
    trade: str
    label: str
    band_jmd: tuple[float, float] | None
    band_gbp: tuple[float, float] | None
    confidence: str
    source: str
    day_rate_jmd: tuple[float, float] = (0.0, 0.0)
    notes: list[str] = field(default_factory=list)

    @property
    def is_benchmarked(self) -> bool:
        return self.band_jmd is not None

    def summary_line(self) -> str:
        if not self.is_benchmarked:
            return (
                f"{self.label}: no public price exists in Jamaica for this work. "
                f"Priced from materials plus a skilled day rate of "
                f"J${self.day_rate_jmd[0]:,.0f} to J${self.day_rate_jmd[1]:,.0f}."
            )
        low_j, high_j = self.band_jmd
        low_g, high_g = self.band_gbp
        span_j = f"J${low_j:,.0f}" if low_j == high_j else f"J${low_j:,.0f} to J${high_j:,.0f}"
        span_g = f"about GBP {low_g:,.0f}" if low_g == high_g else f"about GBP {low_g:,.0f} to {high_g:,.0f}"
        return f"{self.label}: {span_j} ({span_g}). Confidence {self.confidence}, source: {self.source}."


def run(card: JobCard) -> PriceOpinion:
    band = bm.lookup(card.trade, card.variant)
    rate = bm.day_rate(card.trade)
    notes: list[str] = [bm.MARKET_CONTEXT]

    if band is None:
        return PriceOpinion(
            trade=card.trade,
            label=card.trade.title(),
            band_jmd=None,
            band_gbp=None,
            confidence="none",
            source="no benchmark on file",
            day_rate_jmd=rate,
            notes=notes + ["Log this quote. Every logged quote closes the data gap."],
        )

    if band.note:
        notes.append(band.note)
    if band.confidence in {"low", "none"}:
        notes.append("Treat this as a conversation starter with the client, not a quote.")

    return PriceOpinion(
        trade=card.trade,
        label=band.label,
        band_jmd=(band.low_jmd, band.high_jmd) if band.has_band else None,
        band_gbp=band.gbp(),
        confidence=band.confidence,
        source=band.source,
        day_rate_jmd=rate,
        notes=notes,
    )


def review_quote(card: JobCard, quoted_jmd: float) -> dict:
    """The Deposit Protection Check in miniature: is the shape of this quote sane?

    Deliberately a shape check, not a price estimate. Estimating is QS work.
    """
    opinion = run(card)
    result = {
        "quoted_jmd": quoted_jmd,
        "quoted_gbp": round(quoted_jmd / bm.JMD_PER_GBP),
        "benchmark": opinion.summary_line(),
        "verdict": "no benchmark, judged on structure only",
        "flags": [],
    }
    if not opinion.is_benchmarked:
        result["flags"].append(
            "No public benchmark exists for this trade in Jamaica. Ask for the quote split into "
            "materials and labour, plus expected days on site, and check each half separately."
        )
        return result

    low, high = opinion.band_jmd
    result["flags"].append(
        "Benchmark figures are labour and call-out unless stated. If the quote includes the item itself "
        "(a tank, sheets, a grill), compare the labour half only. Always ask for the split."
    )
    if quoted_jmd > high * 2:
        result["verdict"] = "red flag"
        result["flags"].append(
            f"Quoted J${quoted_jmd:,.0f} against a benchmark topping out near J${high:,.0f}. "
            "More than double the reference. Worth a direct conversation before any deposit moves."
        )
    elif quoted_jmd > high * 1.3:
        result["verdict"] = "high, ask questions"
        result["flags"].append(
            f"Quoted J${quoted_jmd:,.0f} sits above the J${low:,.0f} to J${high:,.0f} reference. "
            "Could be legitimate (access, spec, post-Melissa materials). Ask for the split."
        )
    elif quoted_jmd < low * 0.5:
        result["verdict"] = "suspiciously low"
        result["flags"].append(
            "Well under the reference. Underquoting usually reappears as a mid-job variation. "
            "Confirm what is excluded."
        )
    else:
        result["verdict"] = "within the expected range"
    return result
