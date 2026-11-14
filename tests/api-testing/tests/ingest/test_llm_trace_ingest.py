"""LLM spans from instrumentation libraries are counted once and priced honestly  [ENT#3240, ENT#3153].

ENT#3240: a Vercel AI SDK wrapper span (`ai.generateText`) repeats its provider call's usage
(`ai.generateText.doGenerate`), and both were counted as LLM calls, so the trace was billed twice;
OpenInference `llm.*` attributes were not mapped onto the gen_ai fields at all.
ENT#3153: a span whose model has no price got cost 0 and looked free instead of being flagged.
"""
from __future__ import annotations

import os
import time
import uuid

import pytest

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
UNKNOWN_MODEL = "ovn-b-unknown-model-zz9"


def _attr(key: str, value) -> dict:
    if isinstance(value, int):
        return {"key": key, "value": {"intValue": str(value)}}
    return {"key": key, "value": {"stringValue": value}}


def _span(trace_id: str, span_id: str, parent: str | None, name: str, start: int, attrs: list[dict]) -> dict:
    sp = {
        "traceId": trace_id,
        "spanId": span_id,
        "name": name,
        "kind": 1,
        "startTimeUnixNano": str(start),
        "endTimeUnixNano": str(start + 5_000_000),
        "attributes": attrs,
    }
    if parent:
        sp["parentSpanId"] = parent
    return sp


@pytest.fixture(scope="module")
def llm_trace(create_session, base_url):
    """One trace: Vercel wrapper + provider call (1000/500 tokens each), an OpenInference LLM span, an unpriced span."""
    stream = f"ovn_b_llm_{uuid.uuid4().hex[:10]}"
    trace_id = uuid.uuid4().hex
    now = time.time_ns()
    root, call, oi, unpriced = "a1" * 8, "b2" * 8, "c3" * 8, "d4" * 8
    vercel_usage = [
        _attr("ai.model.id", "gpt-4o-mini"),
        _attr("ai.model.provider", "openai.chat"),
        _attr("ai.usage.promptTokens", 1000),
        _attr("ai.usage.completionTokens", 500),
    ]
    spans = [
        _span(trace_id, root, None, "ai.generateText", now, [_attr("ai.operationId", "ai.generateText")] + vercel_usage),
        _span(trace_id, call, root, "ai.generateText.doGenerate", now + 1_000_000,
              [_attr("ai.operationId", "ai.generateText.doGenerate")] + vercel_usage),
        _span(trace_id, oi, root, "ChatCompletion", now + 2_000_000, [
            _attr("openinference.span.kind", "LLM"),
            _attr("llm.model_name", "gpt-4o"),
            _attr("llm.token_count.prompt", 200),
            _attr("llm.token_count.completion", 100),
        ]),
        _span(trace_id, unpriced, root, f"chat {UNKNOWN_MODEL}", now + 3_000_000, [
            _attr("gen_ai.operation.name", "chat"),
            _attr("gen_ai.request.model", UNKNOWN_MODEL),
            _attr("gen_ai.usage.input_tokens", 70),
            _attr("gen_ai.usage.output_tokens", 30),
        ]),
    ]
    payload = {
        "resourceSpans": [{
            "resource": {"attributes": [_attr("service.name", "ovn-b-llm")]},
            "scopeSpans": [{"scope": {"name": "ai"}, "spans": spans}],
        }]
    }
    resp = create_session.post(f"{base_url}api/{ORG_ID}/v1/traces", json=payload, headers={"stream-name": stream})
    assert resp.status_code == 200, f"OTLP ingest failed: {resp.status_code} {resp.text}"

    start_us, end_us = now // 1000 - 600_000_000, now // 1000 + 600_000_000
    rows = {}
    for _ in range(30):
        r = create_session.post(
            f"{base_url}api/{ORG_ID}/_search?type=traces&use_cache=false",
            json={"query": {"sql": f'SELECT * FROM "{stream}"', "start_time": start_us, "end_time": end_us, "size": 20}},
        )
        if r.status_code == 200 and len(r.json().get("hits", [])) >= len(spans):
            rows = {h["span_id"]: h for h in r.json()["hits"]}
            break
        time.sleep(1)
    else:
        pytest.fail(f"{stream} never returned {len(spans)} spans")

    yield {"stream": stream, "rows": rows, "ids": (root, call, oi, unpriced), "window": (start_us, end_us)}
    create_session.delete(f"{base_url}api/{ORG_ID}/streams/{stream}?type=traces")


def _trace_summary(session, base_url, llm_trace) -> dict:
    start_us, end_us = llm_trace["window"]
    resp = session.get(
        f"{base_url}api/{ORG_ID}/{llm_trace['stream']}/traces/latest",
        params={"start_time": start_us, "end_time": end_us, "from": 0, "size": 10},
    )
    assert resp.status_code == 200, f"traces/latest failed: {resp.status_code} {resp.text[:300]}"
    hits = resp.json()["hits"]
    assert len(hits) == 1, f"expected one trace, got {hits}"
    return hits[0]


def test_vercel_wrapper_span_is_not_an_llm_call(llm_trace):
    """The wrapper is a workflow with no cost; only the provider call is priced (ENT#3240)."""
    root, call, _, _ = llm_trace["ids"]
    wrapper, provider = llm_trace["rows"][root], llm_trace["rows"][call]
    assert wrapper["gen_ai_operation_name"] == "invoke_workflow", wrapper.get("gen_ai_operation_name")
    assert not wrapper.get("gen_ai_usage_cost"), f"wrapper span was priced: {wrapper.get('gen_ai_usage_cost')}"
    assert provider["gen_ai_operation_name"] == "chat", provider.get("gen_ai_operation_name")
    assert provider["gen_ai_usage_cost"] > 0, f"provider call was not priced: {provider}"


def test_openinference_llm_attributes_map_to_gen_ai_fields(llm_trace):
    """`llm.model_name` / `llm.token_count.*` land in the gen_ai columns and get priced (ENT#3240)."""
    row = llm_trace["rows"][llm_trace["ids"][2]]
    assert row["gen_ai_operation_name"] == "chat", row.get("gen_ai_operation_name")
    assert row["gen_ai_response_model"] == "gpt-4o", row.get("gen_ai_response_model")
    assert (row["gen_ai_usage_input_tokens"], row["gen_ai_usage_output_tokens"]) == (200, 100), row
    assert row["gen_ai_usage_cost"] > 0, f"OpenInference span was not priced: {row}"


def test_unpriced_model_keeps_tokens_and_is_flagged(llm_trace):
    """An unknown model keeps its tokens and is marked unpriced, not given cost 0 (ENT#3153)."""
    row = llm_trace["rows"][llm_trace["ids"][3]]
    assert (row["gen_ai_usage_input_tokens"], row["gen_ai_usage_output_tokens"]) == (70, 30), row
    assert row.get("gen_ai_usage_cost_status") == "unpriced", row
    assert row.get("gen_ai_usage_cost") is None, f"unpriced span carries a cost: {row.get('gen_ai_usage_cost')}"


def test_trace_totals_count_each_llm_call_once(create_session, base_url, llm_trace):
    """Trace list totals: wrapper usage is not added on top of its provider call (ENT#3240, ENT#3153)."""
    root, call, oi, _ = llm_trace["ids"]
    rows = llm_trace["rows"]
    summary = _trace_summary(create_session, base_url, llm_trace)

    assert summary["gen_ai_usage_input_tokens"] == 1000 + 200 + 70, summary
    assert summary["gen_ai_usage_output_tokens"] == 500 + 100 + 30, summary
    expected_cost = rows[call]["gen_ai_usage_cost"] + rows[oi]["gen_ai_usage_cost"]
    assert summary["gen_ai_usage_cost"] == pytest.approx(expected_cost), summary
    assert summary.get("gen_ai_unpriced_tokens") == 100, summary
    assert summary.get("gen_ai_unpriced_models") == [UNKNOWN_MODEL], summary
