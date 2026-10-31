"""Profiles `meta` and `tag_values` query APIs on the reference dataset (feature §3.2, §3.3)."""

from __future__ import annotations

import uuid

import pytest
import requests

from support.client import OpenObserveClient

from .profiles_helpers import (
    MIN_US,
    TRACE_ID,
    US,
    ProfilesBuilder,
    RefData,
    ingest_ok,
    now_ns,
    query,
    recent_window,
    wait_rows,
)

SERVICES = ["catalog", "checkout", "payments"]
ALL_TYPES = [
    {"type": "alloc_space", "unit": "bytes"},
    {"type": "cpu", "unit": "nanoseconds"},
    {"type": "inuse_space", "unit": "bytes"},
]
CPU_ONLY = [{"type": "cpu", "unit": "nanoseconds"}]
EXPECTED_LABELS = {
    "deployment_environment",
    "host_name",
    "service_instance_id",
    "service_version",
    "span_id",
    "trace_id",
}
NOT_LABELS = {
    "stack",
    "value",
    "service_name",
    "profile_type",
    "profile_unit",
    "frame_count",
    "extractor_version",
    "profile_duration_nanos",
    "duration_nanos",
    "_timestamp",
}


def _params(w: dict, **extra) -> dict:
    return {"start_time": w["start_time"], "end_time": w["end_time"], **extra}


def _meta(client: OpenObserveClient, stream: str, params: dict) -> requests.Response:
    return query(client, stream, "meta", method="GET", params=params)


def _meta_ok(client: OpenObserveClient, stream: str, params: dict) -> dict:
    resp = _meta(client, stream, params)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _tags(client: OpenObserveClient, stream: str, params: dict) -> requests.Response:
    return query(client, stream, "tag_values", method="GET", params=params)


def _tag_values(client: OpenObserveClient, ref: RefData, **params) -> dict:
    resp = _tags(client, ref.stream, _params(ref.win(), **params))
    assert resp.status_code == 200, resp.text
    return resp.json()


def _assert_400(resp: requests.Response, message: str) -> None:
    assert resp.status_code == 400, f"{resp.status_code} {resp.text}"
    assert resp.json()["message"] == message


def test_meta01_lists_services_types_labels(client: OpenObserveClient, ref: RefData):
    body = _meta_ok(client, ref.stream, _params(ref.win()))
    assert body["services"] == SERVICES
    assert body["profile_types"] == ALL_TYPES
    assert body["data_sources"] == []
    labels = set(body["label_names"])
    assert EXPECTED_LABELS <= labels, labels
    assert not labels & NOT_LABELS, labels & NOT_LABELS
    assert body["label_names"] == sorted(body["label_names"])


@pytest.mark.parametrize(("service", "types"), [("checkout", CPU_ONLY), ("payments", ALL_TYPES), ("catalog", CPU_ONLY)])
def test_meta02_types_scoped_to_service(client: OpenObserveClient, ref: RefData, service: str, types: list):
    body = _meta_ok(client, ref.stream, _params(ref.win(), service_name=service))
    assert body["profile_types"] == types
    assert body["services"] == SERVICES


def test_meta03_unknown_service(client: OpenObserveClient, ref: RefData):
    body = _meta_ok(client, ref.stream, _params(ref.win(), service_name="nope"))
    assert body["profile_types"] == []
    assert body["services"] == SERVICES


def test_meta04_empty_window_keeps_schema_labels(client: OpenObserveClient, ref: RefData, empty_window: dict):
    full = _meta_ok(client, ref.stream, _params(ref.win()))
    body = _meta_ok(client, ref.stream, _params(empty_window))
    assert body["services"] == []
    assert body["profile_types"] == []
    assert body["label_names"] == full["label_names"]


def test_meta05_narrow_window(client: OpenObserveClient, ref: RefData):
    c2 = ref.t0_us + 4 * MIN_US
    body = _meta_ok(client, ref.stream, {"start_time": c2 - US, "end_time": c2 + 30 * US})
    assert body["services"] == ["checkout"]
    assert body["profile_types"] == CPU_ONLY


@pytest.mark.parametrize(
    ("params", "message"),
    [
        ({"end_time": 2_000_000}, "start_time is required"),
        ({"start_time": 1_000_000}, "end_time is required"),
        ({"start_time": "abc", "end_time": 2_000_000}, "Invalid start_time parameter"),
        ({"start_time": 2_000_000, "end_time": 2_000_000}, "start_time must be less than end_time"),
        ({"start_time": 3_000_000, "end_time": 2_000_000}, "start_time must be less than end_time"),
        ({"start_time": 0, "end_time": 2_000_000}, "start_time and end_time are required (microseconds)"),
    ],
    ids=["meta06-no-start", "meta07-no-end", "meta08-bad-start", "meta09-equal", "meta10-reversed", "meta11-zero"],
)
def test_meta06_11_time_errors(client: OpenObserveClient, ref: RefData, params: dict, message: str):
    _assert_400(_meta(client, ref.stream, params), message)


def test_meta12_timeout_zero(client: OpenObserveClient, ref: RefData):
    _assert_400(_meta(client, ref.stream, _params(ref.win(), timeout=0)), "Invalid timeout parameter")


def test_meta13_unknown_stream_is_empty(client: OpenObserveClient, ref: RefData):
    body = _meta_ok(client, f"no_such_{uuid.uuid4().hex[:8]}", _params(ref.win()))
    assert (body["services"], body["profile_types"], body["label_names"], body["data_sources"]) == ([], [], [], [])


def test_meta15_no_auth(client: OpenObserveClient, ref: RefData):
    resp = requests.get(client.url(f"{ref.stream}/profiles/meta"), params=_params(ref.win()), timeout=30)
    assert resp.status_code == 401, resp.text


def test_tag01_values_of_service_version(client: OpenObserveClient, ref: RefData):
    body = _tag_values(client, ref, tag="service_version")
    assert body["tag"] == "service_version"
    assert body["values"] == ["v1.4.0", "v1.5.0"]


def test_tag02_narrowed_by_other_filter(client: OpenObserveClient, ref: RefData):
    body = _tag_values(client, ref, tag="deployment_environment", filters="service_version=v1.4.0")
    assert body["values"] == ["prod"]


def test_tag03_own_tag_filter_ignored(client: OpenObserveClient, ref: RefData):
    assert _tag_values(client, ref, tag="service_version", filters="service_version=v1.4.0")["values"] == [
        "v1.4.0",
        "v1.5.0",
    ]


def test_tag04_dotted_tag_normalised(client: OpenObserveClient, ref: RefData):
    body = _tag_values(client, ref, tag="service.version")
    assert body["tag"] == "service_version"
    assert body["values"] == ["v1.4.0", "v1.5.0"]


def test_tag05_field_alias(client: OpenObserveClient, ref: RefData):
    body = _tag_values(client, ref, field="host_name")
    assert body["tag"] == "host_name"
    assert body["values"] == [f"host-{c}" for c in "abcdef"]


def test_tag06_narrowed_by_service_and_type(client: OpenObserveClient, ref: RefData):
    body = _tag_values(
        client, ref, tag="host_name", service_name="payments", profile_type="inuse_space", profile_unit="bytes"
    )
    assert body["values"] == ["host-d", "host-e"]


@pytest.mark.parametrize(
    "tag",
    ["service_name", "profile_type", "otel_scope_name"],
    ids=["tag07-service_name", "tag08-profile_type", "tag08-otel_scope_name"],
)
def test_tag07_08_meta_dimensions_rejected(client: OpenObserveClient, ref: RefData, tag: str):
    _assert_400(
        _tags(client, ref.stream, _params(ref.win(), tag=tag)),
        f"tag {tag} is provided by /profiles/meta; use tag_values only for Tags Filter keys",
    )


def test_tag09_missing_tag(client: OpenObserveClient, ref: RefData):
    _assert_400(_tags(client, ref.stream, _params(ref.win())), "tag is required")


@pytest.mark.parametrize(
    "tag",
    ["stack", "value", "_timestamp", "a;b", "a" * 129],
    ids=["tag10-stack", "tag10-value", "tag10-_timestamp", "tag11-semicolon", "tag11-129-chars"],
)
def test_tag10_11_reserved_or_unsafe_tag(client: OpenObserveClient, ref: RefData, tag: str):
    _assert_400(
        _tags(client, ref.stream, _params(ref.win(), tag=tag)),
        f"tag must be a filterable profile tag column, got: {tag}",
    )


def test_tag12_unknown_column(client: OpenObserveClient, ref: RefData):
    resp = _tags(client, ref.stream, _params(ref.win(), tag="no_such_col"))
    assert resp.status_code == 400, resp.text
    body = resp.json()
    assert body["code"] == 20004, body
    assert "unknown field 'no_such_col'" in body["message"], body


def test_tag13_missing_start_time(client: OpenObserveClient, ref: RefData):
    _assert_400(
        _tags(client, ref.stream, {"tag": "host_name", "end_time": ref.win()["end_time"]}), "start_time is required"
    )


def test_tag14_bad_filter_key(client: OpenObserveClient, ref: RefData):
    _assert_400(
        _tags(client, ref.stream, _params(ref.win(), tag="host_name", filters="stack=x")), "invalid filter key: stack"
    )


def test_tag15_unknown_stream(client: OpenObserveClient, ref: RefData):
    stream = f"no_such_{uuid.uuid4().hex[:8]}"
    resp = _tags(client, stream, _params(ref.win(), tag="host_name"))
    assert resp.status_code == 400, resp.text
    assert resp.json()["code"] == 20002
    assert resp.json()["message"] == f"Search stream not found: {stream}"


def test_tag16_trace_id_values(client: OpenObserveClient, ref: RefData):
    assert _tag_values(client, ref, tag="trace_id")["values"] == [TRACE_ID]


def test_tag17_percent_encoded_filter_value(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    t = now_ns() - 60_000_000_000
    for owner, host in (("a,b=c%d", "host-enc"), ("plain", "host-plain")):
        b.resource(
            [b.profile([b.sample([f"{host}_leaf"], values=[1])], time_ns=t)],
            {"service.name": "svc-enc", "team.owner": owner, "host.name": host},
        )
    ingest_ok(client, prof_stream, b.model())
    wait_rows(client, prof_stream, 2)
    resp = _tags(client, prof_stream, _params(recent_window(), tag="host_name", filters="team_owner=a%2Cb%3Dc%25d"))
    assert resp.status_code == 200, resp.text
    assert resp.json()["values"] == ["host-enc"]
