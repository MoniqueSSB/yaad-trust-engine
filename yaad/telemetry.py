"""OpenTelemetry instrumentation for the Yaad Trust Engine.

Design constraints, in order:

1. The engine must run identically with or without the OpenTelemetry SDK
   installed. Everything here degrades to a no-op when the packages are
   absent, so the test suite and mock demo need no extra dependencies.
2. Attribute cardinality is bounded: `agent` is a fixed set (intake,
   pricing, verification, reporting), `mode` is live|mock, and error types
   are exception class names. No free text, no user content, ever.
3. Naming follows the OpenTelemetry GenAI semantic conventions where they
   apply. On the live path, `opentelemetry-instrumentation-openai-v2` (if
   installed) supplies the standard client spans and token-usage metrics;
   this module only adds what that cannot know: the agent name, the mock
   path, and the engine-level view.

Enable an exporter the standard way, e.g.:

    pip install opentelemetry-sdk opentelemetry-exporter-otlp \
        opentelemetry-instrumentation-openai-v2
    export OTEL_SERVICE_NAME=yaad-trust-engine
    export OTEL_EXPORTER_OTLP_ENDPOINT=...   # OllyGarden or any collector
    opentelemetry-instrument python run_demo.py
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

try:  # pragma: no cover - exercised only when the SDK is installed
    from opentelemetry import metrics, trace
    from opentelemetry.trace import Status, StatusCode

    _OTEL = True
except ImportError:  # SDK not installed: everything below no-ops.
    _OTEL = False


if _OTEL:
    _tracer = trace.get_tracer("yaad-trust-engine")
    _meter = metrics.get_meter("yaad-trust-engine")
    _calls = _meter.create_counter(
        "yaad.llm.calls",
        unit="{call}",
        description="Model calls by agent, mode and outcome.",
    )
    _duration = _meter.create_histogram(
        "yaad.llm.call.duration",
        unit="s",
        description="Model call duration in seconds, by agent and mode.",
    )

    @contextmanager
    def llm_call_span(agent: str, mode: str, model: str) -> Iterator[object]:
        with _tracer.start_as_current_span(f"yaad.agent.{agent}") as span:
            span.set_attribute("yaad.agent", agent)
            span.set_attribute("yaad.mode", mode)
            span.set_attribute("gen_ai.request.model", model)
            try:
                yield span
            except Exception as exc:
                span.set_status(Status(StatusCode.ERROR))
                span.set_attribute("error.type", type(exc).__name__)
                span.record_exception(exc)
                raise

    def record_call(agent: str, mode: str, duration_s: float, ok: bool, error_type: str | None) -> None:
        attrs = {"yaad.agent": agent, "yaad.mode": mode, "yaad.outcome": "ok" if ok else "error"}
        if error_type:
            attrs["error.type"] = error_type
        _calls.add(1, attrs)
        _duration.record(duration_s, {"yaad.agent": agent, "yaad.mode": mode})

else:

    @contextmanager
    def llm_call_span(agent: str, mode: str, model: str) -> Iterator[object]:  # noqa: ARG001
        yield None

    def record_call(agent: str, mode: str, duration_s: float, ok: bool, error_type: str | None) -> None:  # noqa: ARG001
        return None


def enabled() -> bool:
    """True when the OpenTelemetry SDK is importable."""
    return _OTEL
