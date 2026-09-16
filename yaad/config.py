"""Runtime configuration for the Yaad Trust Engine.

Defaults target Mistral, hosted in the European Union, which is the provider
the live Edge Functions use (founder instruction, 15 September 2026: Mistral
is what Yaadly uses first). Mistral speaks the OpenAI chat completions shape,
so a Mistral key in YAAD_API_KEY is all that is needed. Any other
OpenAI-compatible provider works by overriding base URL and model.

Until 15 September 2026 the default was the Future Caribbean / Highrise
Impala gateway (https://ht.getimpala.ai/v1, qwen3.6-27b), from the buildathon.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

MISTRAL_BASE_URL = "https://api.mistral.ai/v1"
MISTRAL_MODEL = "mistral-small-latest"


@dataclass(frozen=True)
class Config:
    api_key: str | None
    base_url: str
    model: str
    temperature: float
    request_timeout: float

    @property
    def live(self) -> bool:
        """True when a real key is present, so calls hit the gateway."""
        return bool(self.api_key)

    @property
    def provider_label(self) -> str:
        if not self.live:
            return "MOCK (no API key set)"
        return f"{self.base_url} :: {self.model}"


def load_config() -> Config:
    return Config(
        api_key=os.environ.get("YAAD_API_KEY") or None,
        base_url=os.environ.get("YAAD_BASE_URL", MISTRAL_BASE_URL),
        model=os.environ.get("YAAD_MODEL", MISTRAL_MODEL),
        temperature=float(os.environ.get("YAAD_TEMPERATURE", "0.2")),
        request_timeout=float(os.environ.get("YAAD_TIMEOUT", "60")),
    )
