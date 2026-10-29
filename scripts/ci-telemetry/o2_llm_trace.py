#!/usr/bin/env python3
# Copyright 2026 OpenObserve Inc.
# Source of truth: openobserve scripts/ci-telemetry/o2_llm_trace.py; o2-enterprise .github/scripts/o2_llm_trace.py is a byte-identical copy.
"""gen_ai traces for CI LLM calls, shaped like scripts/ai-review/run-review.mjs, exported to OpenObserve as OTLP/JSON."""

import atexit
import base64
import datetime
import hashlib
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request

DEFAULT_STREAM = "github_actions_ai_traces"
DEFAULT_TIMEOUT_MS = 10_000
DEFAULT_BATCH_SIZE = 1
EXPORT_INTERVAL_S = 1.0
SCOPE_NAME = "scripts/ci-telemetry/o2_llm_trace.py"
SERVICE_VERSION = "1.0.0"
MAX_SYSTEM_CHARS = 100_000
MAX_USER_CHARS = 150_000
MAX_ERROR_CHARS = 500

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

# Same redaction rules as scripts/ai-review/src/scrub.mjs.
SECRET_ENV_NAME_RE = re.compile(r"(KEY|TOKEN|SECRET|PASSWORD|AUTH)")
MIN_SECRET_LENGTH = 8
REDACTED = "[redacted]"
SECRET_PATTERNS = (
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)"),
    re.compile(r"sk-[A-Za-z0-9_-]{20,}"),
)
AUTH_HEADER_RE = re.compile(r"(Authorization:)[^\n]*", re.IGNORECASE)

GITHUB_RESOURCE_ENV = (
    ("github.repository", "GITHUB_REPOSITORY"),
    ("github.workflow", "GITHUB_WORKFLOW"),
    ("github.run_id", "GITHUB_RUN_ID"),
    ("github.run_number", "GITHUB_RUN_NUMBER"),
    ("github.run_attempt", "GITHUB_RUN_ATTEMPT"),
    ("github.job", "GITHUB_JOB"),
    ("github.actor", "GITHUB_ACTOR"),
    ("github.event_name", "GITHUB_EVENT_NAME"),
    ("github.ref", "GITHUB_REF"),
    ("github.sha", "GITHUB_SHA"),
)


class Span:
    """A started span; the Tracer serializes it when it ends."""

    def __init__(self, trace_id, parent_id, name, kind, attributes):
        self.trace_id = trace_id
        self.span_id = _random_hex(8)
        self.parent_id = parent_id
        self.name = name
        self.kind = kind
        self.start_ns = time.time_ns()
        self.attributes = dict(attributes or {})
        self.events = []
        self.status = {"code": STATUS_OK}
        self.ended = False

    def to_otlp(self, end_ns):
        span = {
            "traceId": self.trace_id,
            "spanId": self.span_id,
            "name": self.name,
            "kind": self.kind,
            "startTimeUnixNano": str(self.start_ns),
            "endTimeUnixNano": str(end_ns),
            "attributes": otlp_attributes(self.attributes),
            "status": self.status,
        }
        if self.parent_id:
            span["parentSpanId"] = self.parent_id
        if self.events:
            span["events"] = self.events
        return span


class Tracer:
    """One root span per script run; ended spans are exported in the background about every second."""

    def __init__(self, service_name, root_name, provider="deepseek", content_prefix="ai.llm", root_attributes=None, env=None):
        self.env = os.environ if env is None else env
        self.service_name = service_name
        self.provider = provider
        self.content_prefix = content_prefix
        self.endpoint = trace_endpoint(self.env)
        self.auth = auth_header(self.env)
        self.enabled = bool(self.endpoint and self.auth)
        self.trace_id = trace_id_from_env(self.env)
        self.timeout_s = export_timeout_s(self.env)
        self.batch_size = export_batch_size(self.env)
        self.secrets = secret_values(self.env)
        self.exported = 0
        self.failed = 0
        self._queue = []
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self._shut_down = False
        self.root = None
        self.root_error = None
        if not self.enabled:
            print(
                "::notice::LLM trace export disabled: O2_TRACE_INGEST_URL and "
                "O2_TRACE_AUTH (or O2_TRACE_USERNAME/O2_TRACE_PASSWORD) are not set."
            )
            return
        attrs = {"workflow.trace_id": self.trace_id, "github.pr.number": pr_number(self.env)}
        attrs.update(root_attributes or {})
        self.root = self.start_span(root_name, attrs, parent=None)
        atexit.register(self.shutdown)

    def start_span(self, name, attributes=None, parent=None, kind=SPAN_KIND_INTERNAL):
        """Start a span under `parent` (default: the root span); None when export is disabled."""
        if not self.enabled:
            return None
        parent = self.root if parent is None else parent
        return Span(self.trace_id, parent.span_id if parent else None, name, kind, _clean(attributes))

    def set_attributes(self, span, attributes):
        if span is not None:
            span.attributes.update(_clean(attributes))

    def set_root_attributes(self, attributes):
        self.set_attributes(self.root, attributes)

    def set_outcome(self, outcome, error=None, attributes=None):
        """Record the run's workflow.outcome; an error marks the root span ERROR when it ends."""
        self.set_root_attributes(dict(attributes or {}, **{"workflow.outcome": outcome}))
        self.root_error = error

    def end_span(self, span, attributes=None, error=None):
        if span is None or span.ended:
            return
        span.ended = True
        self.set_attributes(span, attributes)
        if error is not None:
            message = str(error)[:MAX_ERROR_CHARS]
            span.attributes["error.type"] = type(error).__name__
            span.attributes["error.message"] = message
            span.status = {"code": STATUS_ERROR, "message": message}
            span.events.append(
                {
                    "timeUnixNano": str(time.time_ns()),
                    "name": "exception",
                    "attributes": otlp_attributes({"exception.type": type(error).__name__, "exception.message": message}),
                }
            )
        with self._lock:
            self._queue.append(span.to_otlp(time.time_ns()))
            if self._thread is None and not self._shut_down:
                self._thread = threading.Thread(target=self._export_loop, name="o2_llm_trace", daemon=True)
                self._thread.start()

    def llm_call(self, model, messages, parent=None, agent_name=None, agent_key=None, reasoning_effort=None, timeout_ms=None, attributes=None):
        """A `gen_ai.chat` span for one logical call; retries go through the same LlmCall."""
        attrs = {
            "gen_ai.operation.name": "chat",
            "gen_ai.provider.name": self.provider,
            "gen_ai.request.model": model,
            "gen_ai.request.reasoning_effort": reasoning_effort or "default",
            f"{self.content_prefix}.operation.name": "chat",
            "gen_ai.agent.name": agent_name,
            "ai.agent.key": agent_key,
            "ai.agent.name": agent_name,
            "timeout.ms": timeout_ms,
        }
        span = self.start_span("gen_ai.chat", attrs, parent=parent, kind=SPAN_KIND_CLIENT)
        if span is not None:
            span.attributes.update(request_attributes(messages, self.content_prefix, self.secrets))
            self.set_attributes(span, attributes)
        return LlmCall(self, span, model)

    def chat(self, client, parent=None, agent_name=None, agent_key=None, timeout_ms=None, attributes=None, **kwargs):
        """`client.chat.completions.create(**kwargs)` traced as one gen_ai.chat span; returns or re-raises."""
        with self.llm_call(
            kwargs.get("model"),
            kwargs.get("messages") or [],
            parent=parent,
            agent_name=agent_name,
            agent_key=agent_key,
            reasoning_effort=kwargs.get("reasoning_effort"),
            timeout_ms=timeout_ms,
            attributes=attributes,
        ) as call:
            return call.create(client, **kwargs)

    def shutdown(self):
        """End the root span and export what is queued, bounded by O2_TRACE_EXPORT_TIMEOUT_MS."""
        if not self.enabled or self._shut_down:
            return
        self.end_span(self.root, error=self.root_error)
        with self._lock:
            self._shut_down = True
            thread = self._thread
        deadline = time.monotonic() + self.timeout_s
        self._stop.set()
        if thread is not None:
            thread.join(max(0.0, deadline - time.monotonic()))
        self._drain(deadline)
        with self._lock:
            dropped = len(self._queue)
        if dropped:
            print(f"::warning::LLM trace export: {dropped} span(s) not sent before the export deadline.")
        print(f"LLM trace export: {self.exported} span(s) sent, {self.failed} failed, trace_id={self.trace_id}")

    def _export_loop(self):
        while not self._stop.wait(EXPORT_INTERVAL_S):
            self._drain(None)

    def _drain(self, deadline):
        while True:
            if deadline is None and self._stop.is_set():
                return
            if deadline is not None and time.monotonic() >= deadline:
                return
            with self._lock:
                batch = self._queue[: self.batch_size]
                del self._queue[: self.batch_size]
            if not batch:
                return
            timeout = self.timeout_s if deadline is None else max(0.1, deadline - time.monotonic())
            sent = self._post(batch, timeout)
            with self._lock:
                if sent:
                    self.exported += len(batch)
                else:
                    self.failed += len(batch)

    def _post(self, spans, timeout):
        payload = build_payload(otlp_attributes(resource_attributes(self.service_name, self.env, self.trace_id)), spans)
        request = urllib.request.Request(
            self.endpoint,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json", "Authorization": self.auth, "stream-name": stream_name(self.env)},
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as resp:
                resp.read()
            return True
        except Exception as exc:
            if self.failed < 3:
                print(f"::warning::LLM trace export failed: {type(exc).__name__}: {scrub(str(exc), self.secrets)[:300]}")
            return False


class LlmCall:
    """Accumulates attempts, usage and cost for one gen_ai.chat span; use it as a context manager."""

    def __init__(self, tracer, span, model):
        self.tracer = tracer
        self.span = span
        self.model = model
        self.attempts = 0
        self.last_error = None
        self.usage = {}
        self.cost = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.end(exc)
        return False

    def create(self, client, **kwargs):
        self.attempts += 1
        self.tracer.set_attributes(self.span, request_params(kwargs))
        try:
            response = client.chat.completions.create(**kwargs)
        except Exception as exc:
            self.last_error = exc
            raise
        self.record_response(response, kwargs.get("model") or self.model)
        return response

    def record_response(self, response, model=None):
        self.last_error = None
        if self.span is None:
            return
        data = response_dict(response) or {}
        usage = usage_from_response(data)
        # Every attempt is billed, so token counts and cost sum over retries, unlike callOpencode.
        for key, value in usage.items():
            if value is not None:
                self.usage[key] = self.usage.get(key, 0) + value
        started = time.time()
        cost = estimate_cost(data.get("model") or model or self.model, usage, started)
        if cost is not None:
            self.cost = (self.cost or 0.0) + cost
        self.span.attributes.update(
            response_attributes(data, self.tracer.content_prefix, self.tracer.secrets, model or self.model)
        )
        self.span.attributes[f"{self.tracer.content_prefix}.pricing.peak"] = is_peak(started)

    def reject(self, error):
        """Mark the latest attempt failed for a caller-side reason, such as an unusable response."""
        self.last_error = error

    def end(self, error=None):
        prefix = self.tracer.content_prefix
        attrs = {f"{prefix}.attempts": self.attempts}
        attrs.update(usage_attributes(self.usage, prefix))
        attrs["gen_ai.usage.cost"] = None if self.cost is None else round(self.cost, 10)
        self.tracer.end_span(self.span, attrs, error if error is not None else self.last_error)


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


def export_batch_size(env):
    value = (env.get("O2_TRACE_EXPORT_BATCH_SIZE") or "").strip()
    return int(value) if value.isdigit() and int(value) > 0 else DEFAULT_BATCH_SIZE


def trace_id_from_env(env):
    value = (env.get("O2_TRACE_ID") or "").strip().lower()
    if re.fullmatch(r"[0-9a-f]{32}", value) and value.strip("0"):
        return value
    return _random_hex(16)


def pr_number(env):
    explicit = (env.get("PR_NUMBER") or "").strip()
    if explicit.isdigit():
        return int(explicit)
    match = re.match(r"refs/pull/(\d+)/", env.get("GITHUB_REF") or "")
    if match:
        return int(match.group(1))
    path = env.get("GITHUB_EVENT_PATH")
    if not path:
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            event = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(event, dict):
        return None
    number = (event.get("pull_request") or {}).get("number")
    if number is None and "pull_request" in (event.get("issue") or {}):
        number = event["issue"].get("number")
    return number if isinstance(number, int) else None


def workflow_run_url(env):
    repo = env.get("GITHUB_REPOSITORY")
    run_id = env.get("GITHUB_RUN_ID")
    if not repo or not run_id:
        return None
    return f"{env.get('GITHUB_SERVER_URL') or 'https://github.com'}/{repo}/actions/runs/{run_id}"


def resource_attributes(service_name, env, trace_id=None):
    """The traceResourceAttributes() set of run-review.mjs plus workflow.trace_id."""
    attrs = {
        "service.name": service_name,
        "service.version": SERVICE_VERSION,
        "telemetry.sdk.language": "python",
        "telemetry.sdk.name": "o2_llm_trace",
        "ci.provider.name": "github-actions",
    }
    for key, var in GITHUB_RESOURCE_ENV:
        attrs[key] = env.get(var)
    attrs["github.workflow.run_url"] = workflow_run_url(env)
    attrs["workflow.trace_id"] = trace_id
    return attrs


def secret_values(env):
    values = {
        value.strip()
        for name, value in env.items()
        if SECRET_ENV_NAME_RE.search(name) and isinstance(value, str) and len(value.strip()) >= MIN_SECRET_LENGTH
    }
    return sorted(values, key=len, reverse=True)


def scrub(text, secrets):
    for value in secrets:
        text = text.replace(value, REDACTED)
    for pattern in SECRET_PATTERNS:
        text = pattern.sub(REDACTED, text)
    return AUTH_HEADER_RE.sub(lambda m: f"{m.group(1)} {REDACTED}", text)


def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def message_parts(content, limit, secrets):
    """gen_ai message parts; only text is kept, so inline images never reach the trace."""
    if isinstance(content, str):
        return [{"type": "text", "content": scrub(content[:limit], secrets)}]
    parts = []
    for part in content or []:
        if isinstance(part, dict) and part.get("type") == "text":
            parts.append({"type": "text", "content": scrub(str(part.get("text") or "")[:limit], secrets)})
        elif isinstance(part, dict):
            parts.append({"type": str(part.get("type") or "unknown")})
    return parts


def _parts_text(parts):
    return "\n\n".join(p["content"] for p in parts if "content" in p)


def request_attributes(messages, prefix, secrets):
    """Request content in the genAiRequestAttributes() shape of scripts/ai-review/telemetry.mjs."""
    system_parts = []
    inputs = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        role = message.get("role") or "user"
        if role in ("system", "developer"):
            system_parts.extend(message_parts(message.get("content"), MAX_SYSTEM_CHARS, secrets))
        else:
            inputs.append({"role": role, "parts": message_parts(message.get("content"), MAX_USER_CHARS, secrets)})
    system_text = _parts_text(system_parts)
    user_text = "\n\n".join(_parts_text(m["parts"]) for m in inputs)
    return {
        "gen_ai.system_instructions": json.dumps(system_parts, ensure_ascii=False),
        "gen_ai.input.messages": json.dumps(inputs, ensure_ascii=False),
        f"{prefix}.system_instructions.chars": len(system_text),
        f"{prefix}.system_instructions.sha256": sha256(system_text),
        f"{prefix}.input.chars": len(user_text),
        f"{prefix}.input.sha256": sha256(user_text),
    }


def request_params(kwargs):
    return _clean(
        {
            "gen_ai.request.model": kwargs.get("model"),
            "gen_ai.request.max_tokens": kwargs.get("max_tokens") or kwargs.get("max_completion_tokens"),
            "gen_ai.request.temperature": kwargs.get("temperature"),
            "gen_ai.request.reasoning_effort": kwargs.get("reasoning_effort"),
        }
    )


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


def response_text(data):
    choices = data.get("choices") or []
    message = choices[0].get("message") if choices and isinstance(choices[0], dict) else None
    content = (message or {}).get("content")
    return content if isinstance(content, str) else ""


def response_attributes(data, prefix, secrets, requested_model):
    """Response content in the genAiResponseAttributes() shape; usage is added when the call ends."""
    text = scrub(response_text(data), secrets)
    return _clean(
        {
            "gen_ai.output.messages": json.dumps(
                [{"role": "assistant", "parts": [{"type": "text", "content": text}]}], ensure_ascii=False
            ),
            "gen_ai.response.id": data.get("id"),
            "gen_ai.response.model": data.get("model") or requested_model,
            "gen_ai.response.finish_reasons": finish_reasons(data),
            f"{prefix}.output.chars": len(text),
            f"{prefix}.output.sha256": sha256(text),
        }
    )


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


def usage_attributes(usage, prefix="ai.llm"):
    """OpenObserve's extractor treats input_tokens as including gen_ai.usage.cache_read.input_tokens."""
    total = usage.get("total")
    if total is None and usage.get("input") is not None and usage.get("output") is not None:
        total = usage["input"] + usage["output"]
    return {
        "gen_ai.usage.input_tokens": usage.get("input"),
        "gen_ai.usage.output_tokens": usage.get("output"),
        "gen_ai.usage.total_tokens": total,
        "gen_ai.usage.cache_read.input_tokens": usage.get("cache_read"),
        "gen_ai.usage.cache_creation.input_tokens": usage.get("cache_creation"),
        f"{prefix}.usage.reasoning_tokens": usage.get("reasoning"),
    }


def finish_reasons(data):
    reasons = [c.get("finish_reason") for c in data.get("choices") or [] if isinstance(c, dict)]
    return [r for r in reasons if isinstance(r, str)] or None


def normalize_model(model):
    name = (model or "").strip().lower().rsplit("/", 1)[-1]
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
    return [{"key": key, "value": otlp_value(value)} for key, value in attrs.items() if value is not None and value != ""]


def build_payload(resource_attrs, spans):
    return {
        "resourceSpans": [
            {
                "resource": {"attributes": resource_attrs},
                "scopeSpans": [{"scope": {"name": SCOPE_NAME, "version": SERVICE_VERSION}, "spans": spans}],
            }
        ]
    }


def _clean(attributes):
    return {k: v for k, v in (attributes or {}).items() if v is not None and v != ""}


def _random_hex(n_bytes):
    return os.urandom(n_bytes).hex()

