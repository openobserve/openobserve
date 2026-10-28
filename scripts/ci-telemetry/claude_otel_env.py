# Copyright 2026 OpenObserve Inc.
"""Writes Claude Code's OpenTelemetry export settings for OpenObserve into $GITHUB_ENV."""

import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from o2_llm_trace import (  # noqa: E402
    auth_header,
    resource_attributes,
    stream_name,
    trace_endpoint,
)

SIGNALS = ("traces", "logs", "metrics")


def otel_env(service_name, env):
    """The env vars to export, or {} when the O2_TRACE_* config is incomplete."""
    traces_url = trace_endpoint(env)
    auth = auth_header(env)
    if not traces_url or not auth:
        return {}
    base = traces_url[: -len("/v1/traces")]
    headers = ",".join(
        f"{key}={urllib.parse.quote(value, safe='')}"
        for key, value in (("Authorization", auth), ("stream-name", stream_name(env)))
    )
    resource = ",".join(
        f"{key}={urllib.parse.quote(str(value), safe='-_.~/:')}"
        for key, value in resource_attributes(service_name, env).items()
        if value not in (None, "") and not key.startswith("telemetry.sdk.")
    )
    out = {
        "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
        # Spans are only emitted behind this beta flag; OTEL_TRACES_EXPORTER alone does nothing.
        "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA": "1",
        "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
        "OTEL_EXPORTER_OTLP_ENDPOINT": base,
        "OTEL_EXPORTER_OTLP_HEADERS": headers,
        "OTEL_RESOURCE_ATTRIBUTES": resource,
        "OTEL_TRACES_EXPORT_INTERVAL": "1000",
        "OTEL_LOGS_EXPORT_INTERVAL": "5000",
        "OTEL_METRIC_EXPORT_INTERVAL": "10000",
    }
    for signal in SIGNALS:
        out[f"OTEL_{signal.upper()}_EXPORTER"] = "otlp"
        out[f"OTEL_EXPORTER_OTLP_{signal.upper()}_ENDPOINT"] = f"{base}/v1/{signal}"
    return out


def main():
    service_name = sys.argv[1] if len(sys.argv) > 1 else "github-actions.claude-code-action"
    values = otel_env(service_name, os.environ)
    target = os.environ.get("GITHUB_ENV")
    if not values or not target:
        print("::notice::Claude Code telemetry disabled: O2_TRACE_* secrets are not configured.")
        return
    auth = auth_header(os.environ)
    secret_parts = [auth, auth.split(" ", 1)[-1], urllib.parse.quote(auth, safe=""), values["OTEL_EXPORTER_OTLP_HEADERS"]]
    for part in secret_parts:
        print(f"::add-mask::{part}")
    if any("\n" in v for v in values.values()):
        print("::warning::Claude Code telemetry disabled: a trace setting contains a newline.")
        return
    with open(target, "a", encoding="utf-8") as fh:
        for key, value in values.items():
            fh.write(f"{key}={value}\n")
    print(f"Claude Code telemetry enabled for {service_name}.")


if __name__ == "__main__":
    main()
