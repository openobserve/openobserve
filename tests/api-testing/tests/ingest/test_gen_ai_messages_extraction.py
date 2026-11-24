"""gen_ai message attributes survive a prompt reference and TraceLoop indexed keys on OTLP traces (o2-enterprise#3138)."""

from __future__ import annotations

import json
import uuid
from collections.abc import Generator

import pytest

from support.client import OpenObserveClient
from support.factories import search_payload, time_window, unique_name
from support.otlp_json import span, string_attr, traces_request
from support.wait import wait_until

GEN_AI_INPUT = '[{"role":"user","parts":[{"type":"text","content":"What is 2+2?"}]}]'
GEN_AI_OUTPUT = '[{"role":"assistant","parts":[{"type":"text","content":"4"}]}]'


@pytest.fixture
def temp_trace_stream(client: OpenObserveClient) -> Generator[str, None, None]:
    name = unique_name("pytest_genai")
    yield name
    client.streams.delete(name, type_="traces")


def _gen_ai_span(name: str, trace_id: str, *extra: dict) -> dict:
    attrs = [string_attr("gen_ai.operation.name", "chat"), string_attr("gen_ai.request.model", "gpt-4o"), *extra]
    return span(name, trace_id=trace_id, span_id=uuid.uuid4().hex[:16], attributes=attrs)


def _gen_ai_rows(client: OpenObserveClient, stream: str, want: int) -> dict[str, dict] | None:
    start, end = time_window(minutes=15)
    body = search_payload(f'SELECT * FROM "{stream}"', start_time=start, end_time=end)
    resp = client.post("_search", params={"type": "traces"}, json=body)
    rows = {h["operation_name"]: h for h in resp.json().get("hits", [])} if resp.status_code == 200 else {}
    return rows if len(rows) >= want else None


def test_gen_ai_messages_survive_a_prompt_reference_and_traceloop_keys(
    client: OpenObserveClient, temp_trace_stream: str
):
    """o2-enterprise#3138: `gen_ai.prompt.name` read as a TraceLoop message key and swallowed the span's real messages."""
    trace_id = uuid.uuid4().hex
    spans = [
        _gen_ai_span(
            "plain",
            trace_id,
            string_attr("gen_ai.input.messages", GEN_AI_INPUT),
            string_attr("gen_ai.output.messages", GEN_AI_OUTPUT),
        ),
        _gen_ai_span(
            "with-prompt-ref",
            trace_id,
            string_attr("gen_ai.input.messages", GEN_AI_INPUT),
            string_attr("gen_ai.output.messages", GEN_AI_OUTPUT),
            string_attr("gen_ai.prompt.name", "support-answer"),
            string_attr("gen_ai.prompt.version", "3"),
            string_attr("gen_ai.prompt.label", "production"),
        ),
        _gen_ai_span(
            "traceloop",
            trace_id,
            string_attr("gen_ai.prompt.0.role", "user"),
            string_attr("gen_ai.prompt.0.content", "Hello"),
            string_attr("gen_ai.completion.0.role", "assistant"),
            string_attr("gen_ai.completion.0.content", "Hi"),
        ),
    ]
    resp = client.post("v1/traces", json=traces_request(spans), headers={"stream-name": temp_trace_stream})
    assert resp.status_code == 200, resp.text

    rows = wait_until(
        lambda: _gen_ai_rows(client, temp_trace_stream, 3), timeout=30, msg="the three spans never became searchable"
    )
    for name in ("plain", "with-prompt-ref"):
        row = rows[name]
        assert {"gen_ai_input_messages", "gen_ai_output_messages"} <= row.keys(), f"{name} lost its messages: {row}"
        assert json.loads(row["gen_ai_input_messages"]) == json.loads(GEN_AI_INPUT), f"{name}: {row}"
        assert json.loads(row["gen_ai_output_messages"]) == json.loads(GEN_AI_OUTPUT), f"{name}: {row}"
    ref = rows["with-prompt-ref"]
    assert (ref.get("gen_ai_prompt_name"), ref.get("gen_ai_prompt_version"), ref.get("gen_ai_prompt_label")) == (
        "support-answer",
        "3",
        "production",
    ), ref

    traceloop = rows["traceloop"]
    assert json.loads(traceloop["gen_ai_input_messages"]) == [{"role": "user", "content": "Hello"}], traceloop
    assert json.loads(traceloop["gen_ai_output_messages"]) == [{"role": "assistant", "content": "Hi"}], traceloop
    assert "gen_ai_prompt_0_content" not in traceloop, f"a TraceLoop message key was stored as a column: {traceloop}"
