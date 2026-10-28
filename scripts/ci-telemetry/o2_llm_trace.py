# Copyright 2026 OpenObserve Inc.
"""OTLP/JSON gen_ai spans for CI LLM calls, using the O2_TRACE_* env contract of scripts/ai-review/run-review.mjs."""

import atexit
import base64
import datetime
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request

DEFAULT_STREAM = "github_actions_ai_traces"
DEFAULT_TIMEOUT_MS = 10_000
SPANS_PER_REQUEST = 500
SCOPE_NAME = "scripts/ci-telemetry/o2_llm_trace.py"

SPAN_KIND_INTERNAL = 1
SPAN_KIND_CLIENT = 3
STATUS_OK = 1
STATUS_ERROR = 2

# USD per 1M tokens at peak; off-peak is half. Mirrors openobserve/sdr_patterns llm_pricing.json.
PEAK_PRICES = {
    "deepseek-flash": {"cache_hit": 0.006, "cache_miss": 0.30, "output": 1.20},
    "deepseek-v4-pro": {"cache_hit": 0.044, "cache_miss": 1.32, "output": 3.96},
}
MODEL_ALIASES = {
    "deepseek-v4-flash": "deepseek-flash",
    "deepseek-v4.1-flash": "deepseek-flash",
}
PEAK_HOURS_UTC = ((1, 4), (6, 10))

GITHUB_RESOURCE_ENV = {
    "github.repository": "GITHUB_REPOSITORY",
    "github.workflow": "GITHUB_WORKFLOW",
    "github.run_id": "GITHUB_RUN_ID",
    "github.run_number": "GITHUB_RUN_NUMBER",
    "github.run_attempt": "GITHUB_RUN_ATTEMPT",
    "github.job": "GITHUB_JOB",
    "github.actor": "GITHUB_ACTOR",
    "github.event_name": "GITHUB_EVENT_NAME",
    "github.ref": "GITHUB_REF",
    "github.sha": "GITHUB_SHA",
}


class Tracer:
    """Collects one root span plus a `gen_ai.chat` child per API call and exports them once."""

    def __init__(self, service_name, root_name=None, env=None, provider="deepseek"):
        self.env = os.environ if env is None else env
        self.service_name = service_name
        self.provider = provider
        self.endpoint = trace_endpoint(self.env)
        self.auth = auth_header(self.env)
        self.enabled = bool(self.endpoint and self.auth)
        self.trace_id = trace_id_from_env(self.env)
        self.root_span_id = _random_hex(8)
        self.root_name = root_name or service_name
        self.root_start_ns = time.time_ns()
        self.root_attributes = {}
        self._spans = []
        self._lock = threading.Lock()
        self._flushed = False
        self.call_count = 0
        self.error_count = 0
        if self.enabled:
            atexit.register(self.flush)
        else:
            print(
                "::notice::LLM trace export disabled: O2_TRACE_INGEST_URL and "
                "O2_TRACE_AUTH (or O2_TRACE_USERNAME/O2_TRACE_PASSWORD) are not set."
            )

    def chat_completion(self, client, attributes=None, **kwargs):
        """Call `client.chat.completions.create(**kwargs)`, record a span, return or re-raise."""
        started = time.time_ns()
        try:
            response = client.chat.completions.create(**kwargs)
        except Exception as exc:
            self.record_call(kwargs.get("model"), started, time.time_ns(), error=exc, attributes=attributes)
            raise
        self.record_call(kwargs.get("model"), started, time.time_ns(), response=response, attributes=attributes)
        return response

    def record_call(self, model, started_ns, ended_ns, response=None, error=None, attributes=None):
        with self._lock:
            self.call_count += 1
            if error is not None:
                self.error_count += 1
        if not self.enabled:
            return
        data = response_dict(response)
        if data is None and error is not None:
            data = response_dict(getattr(error, "body", None))
        usage = usage_from_response(data or {})
        attrs = {
            "gen_ai.operation.name": "chat",
            "gen_ai.provider.name": self.provider,
            "gen_ai.request.model": model,
            "gen_ai.response.model": (data or {}).get("model"),
            "gen_ai.response.id": (data or {}).get("id"),
            "gen_ai.response.finish_reasons": finish_reasons(data or {}),
        }
        attrs.update(usage_attributes(usage))
        cost = estimate_cost((data or {}).get("model") or model, usage, started_ns / 1e9)
        # Client-side so cache hits are billed at the cache rate even where the ingester ignores them.
        if cost is not None:
            attrs["gen_ai.usage.cost"] = cost
        if attributes:
            attrs.update(attributes)
        status = {"code": STATUS_OK}
        if error is not None:
            message = str(error)[:500]
            attrs["error.type"] = type(error).__name__
            attrs["error.message"] = message
            status = {"code": STATUS_ERROR, "message": message}
        span = {
            "traceId": self.trace_id,
            "spanId": _random_hex(8),
            "parentSpanId": self.root_span_id,
            "name": "gen_ai.chat",
            "kind": SPAN_KIND_CLIENT,
            "startTimeUnixNano": str(started_ns),
            "endTimeUnixNano": str(ended_ns),
            "attributes": otlp_attributes(attrs),
            "status": status,
        }
        with self._lock:
            self._spans.append(span)

    def flush(self):
        """Close the root span and export everything once; later calls are no-ops."""
        with self._lock:
            if self._flushed or not self.enabled:
                return
            self._flushed = True
            spans = list(self._spans)
            self._spans.clear()
            root_attrs = dict(self.root_attributes)
            root_attrs["ai.llm.calls"] = self.call_count
            root_attrs["ai.llm.errors"] = self.error_count
        spans.insert(
            0,
            {
                "traceId": self.trace_id,
                "spanId": self.root_span_id,
                "name": self.root_name,
                "kind": SPAN_KIND_INTERNAL,
                "startTimeUnixNano": str(self.root_start_ns),
                "endTimeUnixNano": str(time.time_ns()),
                "attributes": otlp_attributes(root_attrs),
                "status": {"code": STATUS_ERROR if self.error_count else STATUS_OK},
            },
        )
        resource = otlp_attributes(resource_attributes(self.service_name, self.env))
        exported = 0
        for i in range(0, len(spans), SPANS_PER_REQUEST):
            payload = build_payload(resource, spans[i : i + SPANS_PER_REQUEST])
            if not self._post(payload):
                break
            exported += len(spans[i : i + SPANS_PER_REQUEST])
        print(f"LLM trace export: {exported}/{len(spans)} span(s), trace_id={self.trace_id}")

    def _post(self, payload):
        request = urllib.request.Request(
            self.endpoint,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": self.auth,
                "stream-name": stream_name(self.env),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=export_timeout_s(self.env)) as resp:
                resp.read()
            return True
        except Exception as exc:
            print(f"::warning::LLM trace export failed: {type(exc).__name__}: {str(exc)[:300]}")
            return False


def trace_endpoint(env):
    raw = (env.get("O2_TRACE_INGEST_URL") or "").strip().rstrip("/")
    if not raw:
        return ""
    if re.search(r"/api/[^/]+/v1/traces$", raw):
        return raw
    if re.search(r"/api/[^/]+$", raw):
        return f"{raw}/v1/traces"
    org = urllib.parse.quote(env.get("O2_TRACE_ORG") or "default", safe="")
    return f"{raw}/api/{org}/v1/traces"


def auth_header(env):
    auth = (env.get("O2_TRACE_AUTH") or "").strip()
    if auth:
        return auth if auth.startswith("Basic ") else f"Basic {auth}"
    user = env.get("O2_TRACE_USERNAME")
    password = env.get("O2_TRACE_PASSWORD")
    if not user or not password:
        return ""
    return "Basic " + base64.b64encode(f"{user}:{password}".encode("utf-8")).decode("ascii")


def stream_name(env):
    return env.get("O2_TRACE_STREAM") or DEFAULT_STREAM


def export_timeout_s(env):
    try:
        value = float(env.get("O2_TRACE_EXPORT_TIMEOUT_MS") or DEFAULT_TIMEOUT_MS)
    except ValueError:
        value = DEFAULT_TIMEOUT_MS
    return (value if value > 0 else DEFAULT_TIMEOUT_MS) / 1000.0


def trace_id_from_env(env):
    value = (env.get("O2_TRACE_ID") or "").strip().lower()
    if re.fullmatch(r"[0-9a-f]{32}", value) and value.strip("0"):
        return value
    return _random_hex(16)


def pr_number(env):
    explicit = (env.get("PR_NUMBER") or "").strip()
    if explicit.isdigit():
        return int(explicit)
    path = env.get("GITHUB_EVENT_PATH")
    if not path:
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            event = json.load(fh)
    except (OSError, ValueError):
        return None
    number = (event.get("pull_request") or {}).get("number")
    if number is None and (event.get("issue") or {}).get("pull_request"):
        number = event["issue"].get("number")
    return number if isinstance(number, int) else None


def resource_attributes(service_name, env):
    attrs = {
        "service.name": service_name,
        "telemetry.sdk.language": "python",
        "telemetry.sdk.name": "o2_llm_trace",
        "ci.provider.name": "github-actions",
    }
    for key, var in GITHUB_RESOURCE_ENV.items():
        attrs[key] = env.get(var)
    repo = env.get("GITHUB_REPOSITORY")
    run_id = env.get("GITHUB_RUN_ID")
    if repo and run_id:
        server = env.get("GITHUB_SERVER_URL") or "https://github.com"
        attrs["github.workflow.run_url"] = f"{server}/{repo}/actions/runs/{run_id}"
    attrs["github.pr.number"] = pr_number(env)
    return attrs


def response_dict(response):
    if response is None:
        return None
    if isinstance(response, dict):
        return response
    for method in ("model_dump", "to_dict", "dict"):
        fn = getattr(response, method, None)
        if callable(fn):
            try:
                value = fn()
            except Exception:
                continue
            if isinstance(value, dict):
                return value
    return None


def _count(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        return None
    return int(value)


def usage_from_response(data):
    """Token counts from an OpenAI-compatible (DeepSeek) chat completion dict; absent fields stay None."""
    usage = data.get("usage") or {}
    prompt_details = usage.get("prompt_tokens_details") or {}
    completion_details = usage.get("completion_tokens_details") or {}
    cache_hit = _count(usage.get("prompt_cache_hit_tokens"))
    if cache_hit is None:
        cache_hit = _count(prompt_details.get("cached_tokens"))
    return {
        "input": _count(usage.get("prompt_tokens")),
        "cache_read": cache_hit,
        "output": _count(usage.get("completion_tokens")),
        "reasoning": _count(completion_details.get("reasoning_tokens")),
        "total": _count(usage.get("total_tokens")),
    }


def usage_attributes(usage):
    """OpenObserve's extractor treats input_tokens as including cache_read_input_tokens."""
    return {
        "gen_ai.usage.input_tokens": usage.get("input"),
        "gen_ai.usage.cache_read_input_tokens": usage.get("cache_read"),
        "gen_ai.usage.output_tokens": usage.get("output"),
        "gen_ai.usage.total_tokens": usage.get("total"),
        "ai.usage.reasoning_tokens": usage.get("reasoning"),
    }


def finish_reasons(data):
    reasons = [c.get("finish_reason") for c in data.get("choices") or [] if isinstance(c, dict)]
    return [r for r in reasons if isinstance(r, str)] or None


def normalize_model(model):
    name = (model or "").strip().lower()
    return MODEL_ALIASES.get(name, name)


def is_peak(unix_seconds):
    moment = datetime.datetime.fromtimestamp(unix_seconds, tz=datetime.timezone.utc)
    if moment.weekday() >= 5:
        return False
    return any(start <= moment.hour < end for start, end in PEAK_HOURS_UTC)


def estimate_cost(model, usage, unix_seconds):
    """USD for one call, or None for an unknown model or a call with no usage."""
    prices = PEAK_PRICES.get(normalize_model(model))
    if prices is None or (usage.get("input") is None and usage.get("output") is None):
        return None
    total_input = usage.get("input") or 0
    cache_hit = min(usage.get("cache_read") or 0, total_input)
    output = usage.get("output") or 0
    cost = (
        cache_hit * prices["cache_hit"]
        + (total_input - cache_hit) * prices["cache_miss"]
        + output * prices["output"]
    ) / 1_000_000
    if not is_peak(unix_seconds):
        cost /= 2
    return round(cost, 10)


def otlp_value(value):
    if isinstance(value, bool):
        return {"boolValue": value}
    if isinstance(value, int):
        return {"intValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, (list, tuple)):
        return {"arrayValue": {"values": [otlp_value(v) for v in value]}}
    return {"stringValue": str(value)}


def otlp_attributes(attrs):
    return [
        {"key": key, "value": otlp_value(value)}
        for key, value in attrs.items()
        if value is not None and value != ""
    ]


def build_payload(resource_attrs, spans):
    return {
        "resourceSpans": [
            {
                "resource": {"attributes": resource_attrs},
                "scopeSpans": [{"scope": {"name": SCOPE_NAME, "version": "1.0.0"}, "spans": spans}],
            }
        ]
    }


def _random_hex(n_bytes):
    return os.urandom(n_bytes).hex()

