import json
import time
import uuid
from collections.abc import Generator

import pytest

from support.client import OpenObserveClient
from support.factories import search_payload, time_window, unique_name
from support.otlp_json import span, string_attr, traces_request
from support.wait import wait_until


@pytest.fixture
def temp_trace_stream(client: OpenObserveClient) -> Generator[str, None, None]:
    name = unique_name("pytest_genai")
    yield name
    client.streams.delete(name, type_="traces")


def valid_trace():
    start_time = int(time.time()*1000000000)
    end_time = start_time+6*100000
    json_str =  """{"resourceSpans": [
    {"resource": {
        "attributes": [{
            "key": "service.name",
            "value": {"stringValue": "eternaltwin"}
          },
          {"key": "telemetry.sdk.language",
            "value": {"stringValue": "rust"}
          }]
      },
      "scopeSpans": [
        {"scope": {
            "name": "eternaltwin_rest",
            "version": "",
            "attributes": [],
            "droppedAttributesCount": 0
          },
          "spans": [{
              "traceId": "99fbb827d84246cfb5113f2fbd8bcede",
              "spanId": "51ce5088d24241d8",
              "traceState": "",
              "parentSpanId": "",
              "flags": 1,
              "name": "POST /oauth/token",
              "kind": 2,
              "startTimeUnixNano": <start_time>,
              "endTimeUnixNano": <end_time>,
              "attributes": [{
                  "key": "http.route",
                  "value": {"stringValue": "/oauth/token"}
                },
                {"key": "http.request.method",
                  "value": {"stringValue": "POST"}
                },
                {"key": "url.path",
                  "value": {"stringValue": "/oauth/token"}
                },
                {"key": "http.response.status_code",
                  "value": {"intValue": 200}
                }
              ],
              "droppedAttributesCount": 0,
              "events": [],
              "droppedEventsCount": 0,
              "links": [],
              "droppedLinksCount": 0,
              "status": {"message": "","code": 1}
            }]},
        {
          "scope": {
            "name": "eternaltwin_services::auth",
            "version": "",
            "attributes": [],
            "droppedAttributesCount": 0
          },
          "spans": [{
              "traceId": "99fbb827d84246cfb5113f2fbd8bcede",
              "spanId": "436436e4d9334747",
              "traceState": "",
              "parentSpanId": "68fa70dc0532497d",
              "flags": 1,
              "name": "AuthService::grant_oauth_authorization::claims",
              "kind": 1,
              "startTimeUnixNano": <start_time>,
              "endTimeUnixNano": <end_time>,
              "attributes": [],
              "droppedAttributesCount": 0,
              "events": [],
              "droppedEventsCount": 0,
              "links": [],
              "droppedLinksCount": 0,
              "status": {
                "message": "",
                "code": 0
              }}]}
    ]}]}"""

    json_str = json_str.replace("<start_time>","\"{:d}\"".format(start_time))
    json_str = json_str.replace("<end_time>","\"{:d}\"".format(end_time))
    return json.loads(json_str)


def test_e2e_valid_trace_ingestion(create_session, base_url):
    """Valid trace should get ingested."""

    session = create_session
    url = base_url
    org_id = "default"

    trace = valid_trace()
    
    resp_post_trace = session.post(f"{url}api/{org_id}/v1/traces",json=trace)

    assert (
        resp_post_trace.status_code == 200
    ), f"Post trace expected 200, but got {resp_post_trace.status_code} {resp_post_trace.content}"

def test_e2e_old_trace_ingestion(create_session, base_url):
    """Traces outside the time range should get be skipped."""

    session = create_session
    url = base_url
    org_id = "default"

    trace = valid_trace()
    trace["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["startTimeUnixNano"] = "1724898237575000000"
    trace["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["endTimeUnixNano"] = "1724898237576000000"
    resp_post_trace = session.post(f"{url}api/{org_id}/v1/traces",json=trace)

    # OTLP/HTTP reports partial success with 200, and ProtoJSON encodes int64 as a string.
    assert (
        resp_post_trace.status_code == 200
    ), f"Invalid trace span time expected 200, but got {resp_post_trace.status_code}"

    content = resp_post_trace.json()
    assert (
        content["partialSuccess"]["rejectedSpans"] == "1"
    ), f"Invalid trace span time expected 1 rejected span, but got {content}"

# This is specifically for https://github.com/openobserve/openobserve/issues/4371
def test_e2e_invalid_trace_ingestion(create_session, base_url):
    """Invalid structure JSON trace should return proper error"""
    session = create_session
    url = base_url
    org_id = "default"

    resp_post_trace = session.post(f"{url}api/{org_id}/v1/traces",json={})
    assert (
        resp_post_trace.status_code == 400
    ), f"Invalid trace json expected 400, but got {resp_post_trace.status_code}"

    content = resp_post_trace.json()
    assert (
        "missing field `resourceSpans`" in content["message"]
    ), f"Invalid trace json response expected to contain missing field, but got {content}"

    # the proto3 JSON mapping allows 64-bit integers to be encoded as either
    # JSON numbers or strings, so numeric timestamps must be accepted
    trace = valid_trace()
    span = trace["resourceSpans"][0]["scopeSpans"][0]["spans"][0]
    span["startTimeUnixNano"] = int(span["startTimeUnixNano"])
    span["endTimeUnixNano"] = int(span["endTimeUnixNano"])
    resp_post_trace = session.post(f"{url}api/{org_id}/v1/traces",json=trace)

    assert (
        resp_post_trace.status_code == 200
    ), f"Numeric span timestamps expected 200, but got {resp_post_trace.status_code} {resp_post_trace.content}"

    trace = valid_trace()
    trace["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["startTimeUnixNano"] = "not-a-number"
    resp_post_trace = session.post(f"{url}api/{org_id}/v1/traces",json=trace)

    assert (
        resp_post_trace.status_code == 400
    ), f"Invalid trace json expected 400, but got {resp_post_trace.status_code}"

    content = resp_post_trace.json()
    assert (
        "Invalid json: invalid digit found in string" in content["message"]
    ), f"Invalid trace json response expected to contain incorrect field, but got {content}"


# Compares trace counts on the shared default stream, which other files write to under xdist.
@pytest.mark.serial
def test_e2e_trace_invalid_ids(create_session, base_url):
    """Traces links with invalid ids should get be skipped."""

    session = create_session
    url = base_url
    org_id = "default"
    
    start_time = int(time.time()*1000000)
    start_time = start_time - 10000000
    end_time = start_time + 100000000
    start_time_str = "{:d}".format(start_time)
    end_time_str = "{:d}".format(end_time)
    get_query_url = f"{url}api/{org_id}/default/traces/latest?filter=duration >= 0 AND duration <= 100000000&start_time={start_time_str}&end_time={end_time_str}&from=0&size=25"

    resp_get_trace = session.get(get_query_url)
    original_count = len(resp_get_trace.json()["hits"])

    trace = valid_trace()
    trace["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["links"] = [
        {
        "traceId": [157,48,54,48,139,160,71,67,152,135,40,155], # correct trace id is 16 bytes
        "spanId": [233,128,29,199,119,206,74,251],
        "traceState": "",
        "attributes": [],
        "droppedAttributesCount": 0,
        "flags": 1
    }]
    resp_post_trace = session.post(f"{url}api/{org_id}/v1/traces",json=trace)

    assert (
        resp_post_trace.status_code == 400
    ), f"Invalid span id expected 400, but got {resp_post_trace.status_code}"

    trace = valid_trace()
    trace["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["links"] = [
        {
        "traceId": [157,48,54,48,139,160,71,67,152,135,40,155,0,0,0,0],
        "spanId": [233,128,29,199,119,206], # correct span id is 8 bytes
        "traceState": "",
        "attributes": [],
        "droppedAttributesCount": 0,
        "flags": 1
    }]
    resp_post_trace = session.post(f"{url}api/{org_id}/v1/traces",json=trace)

    assert (
        resp_post_trace.status_code == 400
    ), f"Invalid trace id expected 400, but got {resp_post_trace.status_code}"

    resp_get_trace = session.get(get_query_url)
    new_count = len(resp_get_trace.json()["hits"])

    assert (original_count == new_count), "Expected count of traces to increase by 1."


GEN_AI_INPUT = '[{"role":"user","parts":[{"type":"text","content":"What is 2+2?"}]}]'
GEN_AI_OUTPUT = '[{"role":"assistant","parts":[{"type":"text","content":"4"}]}]'


def _gen_ai_span(name: str, trace_id: str, *extra: dict) -> dict:
    attrs = [string_attr("gen_ai.operation.name", "chat"), string_attr("gen_ai.request.model", "gpt-4o"), *extra]
    return span(name, trace_id=trace_id, span_id=uuid.uuid4().hex[:16], attributes=attrs)


def _gen_ai_rows(client: OpenObserveClient, stream: str, want: int) -> dict[str, dict] | None:
    start, end = time_window(minutes=15)
    body = search_payload(f'SELECT * FROM "{stream}"', start_time=start, end_time=end)
    resp = client.post("_search", params={"type": "traces"}, json=body)
    rows = {h["operation_name"]: h for h in resp.json().get("hits", [])} if resp.status_code == 200 else {}
    return rows if len(rows) >= want else None


def test_gen_ai_messages_survive_a_prompt_reference_and_traceloop_keys(client: OpenObserveClient, temp_trace_stream: str):
    """o2-enterprise#3138: `gen_ai.prompt.name` read as a TraceLoop message key and swallowed the span's real messages."""
    trace_id = uuid.uuid4().hex
    spans = [
        _gen_ai_span("plain", trace_id, string_attr("gen_ai.input.messages", GEN_AI_INPUT),
                     string_attr("gen_ai.output.messages", GEN_AI_OUTPUT)),
        _gen_ai_span("with-prompt-ref", trace_id, string_attr("gen_ai.input.messages", GEN_AI_INPUT),
                     string_attr("gen_ai.output.messages", GEN_AI_OUTPUT),
                     string_attr("gen_ai.prompt.name", "support-answer"), string_attr("gen_ai.prompt.version", "3"),
                     string_attr("gen_ai.prompt.label", "production")),
        _gen_ai_span("traceloop", trace_id, string_attr("gen_ai.prompt.0.role", "user"),
                     string_attr("gen_ai.prompt.0.content", "Hello"), string_attr("gen_ai.completion.0.role", "assistant"),
                     string_attr("gen_ai.completion.0.content", "Hi")),
    ]
    resp = client.post("v1/traces", json=traces_request(spans), headers={"stream-name": temp_trace_stream})
    assert resp.status_code == 200, resp.text

    rows = wait_until(lambda: _gen_ai_rows(client, temp_trace_stream, 3), timeout=30, msg="the three spans never became searchable")
    for name in ("plain", "with-prompt-ref"):
        row = rows[name]
        assert {"gen_ai_input_messages", "gen_ai_output_messages"} <= row.keys(), f"{name} lost its messages: {row}"
        assert json.loads(row["gen_ai_input_messages"]) == json.loads(GEN_AI_INPUT), f"{name}: {row}"
        assert json.loads(row["gen_ai_output_messages"]) == json.loads(GEN_AI_OUTPUT), f"{name}: {row}"
    ref = rows["with-prompt-ref"]
    assert (ref.get("gen_ai_prompt_name"), ref.get("gen_ai_prompt_version"), ref.get("gen_ai_prompt_label")) == (
        "support-answer", "3", "production"), ref

    traceloop = rows["traceloop"]
    assert json.loads(traceloop["gen_ai_input_messages"]) == [{"role": "user", "content": "Hello"}], traceloop
    assert json.loads(traceloop["gen_ai_output_messages"]) == [{"role": "assistant", "content": "Hi"}], traceloop
    assert "gen_ai_prompt_0_content" not in traceloop, f"a TraceLoop message key was stored as a column: {traceloop}"
