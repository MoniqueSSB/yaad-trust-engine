"""OpenTelemetry instrumentation for the Yaad Trust Engine.

Design constraints, in order:

1. The engine must run identically with or without the OpenTelemetry SDK
   installed. Everything here degrades to a no-op when the packages are
   absent, so the test suite and mock demo need no extra dependencies.
2. Attribute cardinality is bounded: `agent` is a fixed set (intake,
   pricing, verification, reporting), `mode` is live|mock, error types are
   exception class names, and guardrail events carry only fixed action
   names, banned-term guidance strings, job ids and amounts, never free
   text, never a client message, never a person's name.
3. Naming follows the OpenTelemetry GenAI semantic conventions where they
   apply. On the live path, `opentelemetry-instrumentation-openai-v2` (if
   installed and activated, see `init()` below) supplies the standard
   client spans and token-usage metrics; this module only adds what that
   cannot know: the agent name, the mock path, the engine-level view, and
   an audit event for every money or guardrail decision.

Enable an exporter the standard way, e.g.:

    pip install opentelemetry-sdk opentelemetry-exporter-otlp \
        opentelemetry-instrumentation-openai-v2
    export OTEL_SERVICE_NAME=yaad-trust-engine
    export OTEL_EXPORTER_OTLP_ENDPOINT=...   # OllyGarden or any collector
    opentelemetry-instrument python run_demo.py

Provider and exporter wiring, where spans, metrics and logs actually get
sent, is left to the standard `opentelemetry-instrument` wrapper above, or
to whatever the calling process has already configured. This module never
constructs a TracerProvider, MeterProvider or LoggerProvider itself, it
only asks the global ones for a tracer, meter and logger, which is a no-op
by default and a real exporter once one of the above has run.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator

try:  # pragma: no cover - exercised only when the SDK is installed
    from opentelemetry import metrics, trace
    from opentelemetry._logs import SeverityNumber, get_logger
    from opentelemetry.trace import Status, StatusCode

    _OTEL = True
except ImportError:  # SDK not installed: everything below no-ops.
    _OTEL = False


if _OTEL:
    _tracer = trace.get_tracer("yaad-trust-engine")
    _meter = metrics.get_meter("yaad-trust-engine")
    _logger = get_logger("yaad-trust-engine")
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

    def record_guardrail_event(name: str, attributes: dict[str, str | int | float]) -> None:
        """Emit a bounded-cardinality audit event for a money or guardrail
        decision, via the OpenTelemetry Logs API.

        `attributes` must only ever contain values from closed sets, or
        numeric fields such as a job id or an amount. Never pass free text
        here: not a client message, not a worker update, not a person's
        name. That boundary is what keeps this safe to turn on everywhere,
        including production, without a privacy review every time a new
        call site is added.
        """
        _logger.emit(
            body=name,
            attributes=attributes,
            severity_number=SeverityNumber.INFO,
            event_name=name,
        )

    def init() -> None:
        """Activate the openai-v2 auto-instrumentation, only when asked to.

        Gated on OTEL_EXPORTER_OTLP_ENDPOINT being set, the same way
        Config.live gates live mode: a default mock run, or any run where
        nobody has pointed this at a collector, stays completely silent.
        Call once, before the first LLMClient is constructed.
        """
        if not os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
            return
        os.environ.setdefault("OTEL_SERVICE_NAME", "yaad-trust-engine")
        try:
            from opentelemetry.instrumentation.openai_v2 import OpenAIInstrumentor

            OpenAIInstrumentor().instrument()
        except ImportError:
            pass

else:

    @contextmanager
    def llm_call_span(agent: str, mode: str, model: str) -> Iterator[object]:  # noqa: ARG001
        yield None

    def record_call(agent: str, mode: str, duration_s: float, ok: bool, error_type: str | None) -> None:  # noqa: ARG001
        return None

    def record_guardrail_event(name: str, attributes: dict[str, str | int | float]) -> None:  # noqa: ARG001
        return None

    def init() -> None:
        return None


def enabled() -> bool:
    """True when the OpenTelemetry SDK is importable."""
    return _OTEL
