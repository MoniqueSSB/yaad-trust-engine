"""Runtime configuration for the Yaad Trust Engine.

Defaults target the Future Caribbean / Highrise Impala gateway, which is
OpenAI-compatible. Drop the team virtual key into YAAD_API_KEY and nothing
else needs to change. Any other OpenAI-compatible provider (Nebius, MiniMax,
a local vLLM) works by overriding base URL and model.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

IMPALA_BASE_URL = "https://ht.getimpala.ai/v1"
IMPALA_MODEL = "qwen3.6-27b"


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
        base_url=os.environ.get("YAAD_BASE_URL", IMPALA_BASE_URL),
        model=os.environ.get("YAAD_MODEL", IMPALA_MODEL),
        temperature=float(os.environ.get("YAAD_TEMPERATURE", "0.2")),
        request_timeout=float(os.environ.get("YAAD_TIMEOUT", "60")),
    )
