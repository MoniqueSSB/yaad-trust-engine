// GENERATED FILE, do not edit by hand.
//
// Source: yaad/benchmarks.py. Regenerate with
//   python3 scripts/gen_price_benchmarks.py
// tests/test_price_benchmarks.py fails if this drifts from the source.
//
// CLAUDE.md section 5: pricing is a LOOKUP, never a model. Nothing that
// imports this may interpolate, average or smooth a band, and where a band
// says no public price exists in Jamaica, that is a correct and complete
// answer rather than a gap to fill.

export type GeneratedBand = {
  label: string;
  low_jmd: number | null;
  high_jmd: number | null;
  low_gbp: number | null;
  high_gbp: number | null;
  confidence: string;
  source: string;
  note: string;
};

export type PriceBenchmarks = {
  generated_from: string;
  jmd_per_gbp: number;
  market_context: string;
  day_rates_jmd: Record<string, number[]>;
  materials_jmd: Record<string, number[]>;
  bands: Record<string, GeneratedBand>;
  taxonomy_to_benchmark: Record<string, string>;
};

export const PRICE_BENCHMARKS: PriceBenchmarks = {
  "generated_from": "yaad/benchmarks.py",
  "jmd_per_gbp": 210.0,
  "market_context": "Prices trend up through 2026 and 2027: Hurricane Melissa (Oct 2025) spiked demand for zinc, ply and lumber, mining output fell 37.5 percent per STATIN pushing materials up, and a Feb 2025 collective labour agreement adds 19 percent to construction wages over two years.",
  "day_rates_jmd": {
    "general labourer": [
      3000,
      3500
    ],
    "skilled mason": [
      7000,
      12000
    ],
    "roofing": [
      7000,
      12000
    ],
    "plumbing": [
      7000,
      12000
    ],
    "electrical": [
      7000,
      12000
    ],
    "masonry": [
      7000,
      12000
    ],
    "painting": [
      7000,
      12000
    ],
    "metalwork": [
      7000,
      12000
    ]
  },
  "materials_jmd": {
    "cement (42.5kg bag)": [
      1400,
      2000
    ],
    "6in concrete block": [
      140,
      280
    ],
    "plywood sheet": [
      3450,
      7190
    ],
    "zinc roof sheet": [
      5000,
      5000
    ],
    "emulsion paint (gallon)": [
      5000,
      6500
    ],
    "treated lumber 2x4 (per ft)": [
      120,
      120
    ]
  },
  "bands": {
    "roofing:minor": {
      "label": "Minor roof repair",
      "low_jmd": 75000,
      "high_jmd": 75000,
      "low_gbp": 357,
      "high_gbp": 357,
      "confidence": "high",
      "source": "Government ROOFS grant tier",
      "note": ""
    },
    "roofing:major": {
      "label": "Major roof damage repair",
      "low_jmd": 200000,
      "high_jmd": 200000,
      "low_gbp": 952,
      "high_gbp": 952,
      "confidence": "high",
      "source": "Government ROOFS grant tier",
      "note": ""
    },
    "roofing:severe": {
      "label": "Severe roof or structural reconstruction",
      "low_jmd": 200000,
      "high_jmd": 500000,
      "low_gbp": 952,
      "high_gbp": 2381,
      "confidence": "high",
      "source": "Government ROOFS grant tier",
      "note": ""
    },
    "roofing:*": {
      "label": "Roof repair, tier unconfirmed",
      "low_jmd": 75000,
      "high_jmd": 200000,
      "low_gbp": 357,
      "high_gbp": 952,
      "confidence": "high",
      "source": "Government ROOFS grant tiers",
      "note": "Spans the minor to major tiers. Confirm the tier before quoting."
    },
    "metalwork:grill": {
      "label": "Window or door grill, custom",
      "low_jmd": 25000,
      "high_jmd": 30000,
      "low_gbp": 119,
      "high_gbp": 143,
      "confidence": "low",
      "source": "Single seller, St Ann",
      "note": "One vendor only. Treat as indicative, not a benchmark."
    },
    "plumbing:unclog": {
      "label": "Unclog drain",
      "low_jmd": 1664,
      "high_jmd": 3750,
      "low_gbp": 8,
      "high_gbp": 18,
      "confidence": "medium",
      "source": "UWI card 2019-20, inflated 30 to 50 percent",
      "note": "Base figures are dated. Inflation applied."
    },
    "plumbing:tank": {
      "label": "Water tank install",
      "low_jmd": 18850,
      "high_jmd": 21750,
      "low_gbp": 90,
      "high_gbp": 104,
      "confidence": "medium",
      "source": "UWI card 2019-20, inflated 30 to 50 percent",
      "note": ""
    },
    "grounds:monthly": {
      "label": "Gardener, monthly",
      "low_jmd": 10000,
      "high_jmd": 25000,
      "low_gbp": 48,
      "high_gbp": 119,
      "confidence": "high",
      "source": "Three corroborating sources",
      "note": ""
    },
    "painting:*": {
      "label": "Painting",
      "low_jmd": null,
      "high_jmd": null,
      "low_gbp": null,
      "high_gbp": null,
      "confidence": "none",
      "source": "No public price exists in Jamaica",
      "note": "Price from materials plus day rate, and log the quote."
    },
    "masonry:*": {
      "label": "Block wall",
      "low_jmd": null,
      "high_jmd": null,
      "low_gbp": null,
      "high_gbp": null,
      "confidence": "none",
      "source": "No public price exists in Jamaica",
      "note": "Price from materials plus day rate, and log the quote."
    },
    "plumbing:septic": {
      "label": "Septic",
      "low_jmd": null,
      "high_jmd": null,
      "low_gbp": null,
      "high_gbp": null,
      "confidence": "none",
      "source": "No public price exists in Jamaica",
      "note": ""
    },
    "general repair:*": {
      "label": "General repair",
      "low_jmd": null,
      "high_jmd": null,
      "low_gbp": null,
      "high_gbp": null,
      "confidence": "none",
      "source": "No public price exists in Jamaica",
      "note": ""
    }
  },
  "taxonomy_to_benchmark": {
    "Roofing": "roofing",
    "Plumbing": "plumbing",
    "Drainage & Septic": "plumbing",
    "Water Tank & Pump": "plumbing",
    "Masonry & Concrete": "masonry",
    "Painting & Decorating": "painting",
    "Grille & Gate Welding": "metalwork",
    "Landscaping": "grounds",
    "General Handyman": "general repair"
  }
} as const;
