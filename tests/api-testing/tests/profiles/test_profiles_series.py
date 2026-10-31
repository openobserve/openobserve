"""Profiles `series` API: buckets, per-instance rate, inuse averaging, group_by and step rules (feature §3.4)."""

from __future__ import annotations

import uuid

import pytest
import requests

from support.client import OpenObserveClient

from .profiles_helpers import (
    CHECKOUT_TOTAL,
    MIB,
    NS,
    SPAN_ID,
    TRACE_ID,
    US,
    ProfilesBuilder,
    RefData,
    cpu,
    ingest_ok,
    merge_ok,
    now_ns,
    now_us,
    query,
    recent_window,
    snapshot_model,
    wait_merge_total,
    wait_rows,
    window,
)

INUSE = {"profile_type": "inuse_space", "profile_unit": "bytes"}


def _series(client: OpenObserveClient, stream: str, body: dict) -> requests.Response:
    return query(client, stream, "series", body)


def _series_ok(client: OpenObserveClient, stream: str, body: dict) -> dict:
    resp = _series(client, stream, body)
    assert resp.status_code == 200, f"series {body} -> {resp.status_code} {resp.text[:500]}"
    return resp.json()


def _points(body: dict) -> list[tuple[int, float]]:
    return [(p["timestamp"], p["value"]) for p in body["series"]]


def _assert_400(resp: requests.Response, message: str) -> None:
    assert resp.status_code == 400, f"{resp.status_code} {resp.text}"
    assert resp.json()["message"] == message


def _checkout(ref: RefData, **extra) -> dict:
    return ref.win(**cpu(**{"service_name": "checkout", "step": "60", **extra}))


def _snapshot_stream(client: OpenObserveClient, stream: str, threads: tuple[str, str] | None = None) -> int:
    minute = (now_ns() - 3 * 60 * NS) // (60 * NS) * 60 * NS
    ingest_ok(client, stream, snapshot_model(minute, threads))
    return minute // 1000


def test_ser01_checkout_cpu_step_60(client: OpenObserveClient, ref: RefData):
    body = _series_ok(client, ref.stream, _checkout(ref))
    assert (body["unit"], body["profile_type"], body["step_secs"]) == ("nanoseconds", "cpu", 60)
    assert _points(body) == [(ref.bucket(0), 4.0e9), (ref.bucket(4), 7.85e9), (ref.bucket(6), 0.15e9)]
    assert "groups" not in body
    merged = merge_ok(client, ref.stream, ref.win(**cpu(service_name="checkout")))
    assert sum(v for _, v in _points(body)) == merged["total"] == CHECKOUT_TOTAL


def test_ser02_rate_per_second_of_profiled_time(client: OpenObserveClient, ref: RefData):
    rates = [p["rate"] for p in _series_ok(client, ref.stream, _checkout(ref))["series"]]
    assert rates == pytest.approx([4.0e8, 7.85e8, 1.5e7], rel=1e-9)


def test_ser03_get_equals_post(client: OpenObserveClient, ref: RefData):
    post = _series_ok(client, ref.stream, _checkout(ref))
    resp = query(client, ref.stream, "series", method="GET", params=_checkout(ref))
    assert resp.status_code == 200, resp.text
    assert resp.json()["series"] == post["series"]
    assert resp.json()["step_secs"] == 60


def test_ser04_query_params_fill_post_body(client: OpenObserveClient, ref: RefData):
    body = _checkout(ref)
    del body["profile_unit"]
    resp = query(client, ref.stream, "series", body, params={"profile_unit": "nanoseconds"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["unit"] == "nanoseconds"
    assert resp.json()["series"] == _series_ok(client, ref.stream, _checkout(ref))["series"]


def test_ser05_process_level_filter_keeps_rate(client: OpenObserveClient, ref: RefData):
    body = _series_ok(client, ref.stream, _checkout(ref, filters=[{"key": "service_version", "value": "v1.5.0"}]))
    assert _points(body) == [(ref.bucket(4), 7.85e9), (ref.bucket(6), 0.15e9)]
    assert [p["rate"] for p in body["series"]] == pytest.approx([7.85e8, 1.5e7], rel=1e-9)


def test_ser06_trace_filter_drops_rate(client: OpenObserveClient, ref: RefData):
    filters = [{"key": "trace_id", "value": TRACE_ID}, {"key": "span_id", "value": SPAN_ID}]
    body = _series_ok(client, ref.stream, _checkout(ref, filters=filters))
    assert _points(body) == [(ref.bucket(4), 2.5e8)]
    assert "rate" not in body["series"][0]


def test_ser07_inuse_per_bucket_no_rate(client: OpenObserveClient, ref: RefData):
    body = _series_ok(client, ref.stream, ref.win(service_name="payments", step="60", **INUSE))
    assert body["unit"] == "bytes"
    assert _points(body) == [(ref.bucket(2), 2 * MIB), (ref.bucket(5), 4 * MIB)]
    assert all("rate" not in p for p in body["series"])


def test_ser08_inuse_two_instances_in_one_bucket_summed(client: OpenObserveClient, ref: RefData):
    t2, t5 = ref.t0_us + 2 * 60 * US, ref.t0_us + 5 * 60 * US
    # Buckets are epoch-aligned, so pick a step with no bucket edge between the two profiles (e.g. at UTC midnight).
    steps = [s for s in range(600, 86_400) if t2 // (s * US) == t5 // (s * US)]
    assert steps, f"no step in 600..86399 s keeps {t2} and {t5} in one bucket"
    step = steps[0]
    body = _series_ok(client, ref.stream, ref.win(service_name="payments", step=str(step), **INUSE))
    assert [v for _, v in _points(body)] == [6 * MIB]


def test_ser09_inuse_snapshots_of_one_instance_averaged(client: OpenObserveClient, prof_stream: str):
    bucket = _snapshot_stream(client, prof_stream)
    wait_rows(client, prof_stream, 2)
    body = _series_ok(client, prof_stream, recent_window(step="60", **INUSE))
    assert _points(body) == [(bucket, 2 * MIB)]


def test_ser19_inuse_group_by_uses_ungrouped_snapshot_count(client: OpenObserveClient, prof_stream: str):
    bucket = _snapshot_stream(client, prof_stream, threads=("A", "B"))
    wait_rows(client, prof_stream, 2)
    body = _series_ok(client, prof_stream, recent_window(step="60", group_by="thread_name", **INUSE))
    assert _points(body) == [(bucket, 2 * MIB)]
    groups = {g["value"]: g for g in body["groups"]}
    assert set(groups) == {"A", "B"}
    assert groups["A"]["total"] == MIB / 2
    assert groups["B"]["total"] == 3 * MIB / 2


def test_ser10_group_by_service_version(client: OpenObserveClient, ref: RefData):
    body = _series_ok(client, ref.stream, _checkout(ref, group_by="service_version"))
    assert [(g["value"], g["total"], g["others"]) for g in body["groups"]] == [
        ("v1.5.0", 8.0e9, False),
        ("v1.4.0", 4.0e9, False),
    ]
    for g in body["groups"]:
        assert sum(p["value"] for p in g["series"]) == g["total"]
    assert sum(v for _, v in _points(body)) == CHECKOUT_TOTAL


def test_ser11_group_by_dotted_key(client: OpenObserveClient, ref: RefData):
    dotted = _series_ok(client, ref.stream, _checkout(ref, group_by="service.version"))
    plain = _series_ok(client, ref.stream, _checkout(ref, group_by="service_version"))
    assert dotted["groups"] == plain["groups"]


@pytest.mark.parametrize("limit", [1, 0], ids=["ser12-limit-1", "ser13-limit-0-clamps"])
def test_ser12_13_group_limit_folds_others(client: OpenObserveClient, ref: RefData, limit: int):
    body = _series_ok(client, ref.stream, ref.win(**cpu(step="60", group_by="service_name", group_limit=limit)))
    assert [(g["value"], g["total"], g["others"]) for g in body["groups"]] == [
        ("checkout", 12.0e9, False),
        ("", 9.015e9, True),
    ]


def test_ser14_group_limit_default_and_max(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    t = now_ns() - 60 * NS
    for i in range(52):
        b.resource(
            [b.profile([b.sample(["gl_leaf"], values=[(i + 1) * 10])], time_ns=t)],
            {"service.name": "svc-gl", "service.version": f"v{i:02d}", "service.instance.id": f"gl-{i}"},
        )
    ingest_ok(client, prof_stream, b.model())
    wait_merge_total(client, prof_stream, recent_window(**cpu()), 13_780)
    default = _series_ok(client, prof_stream, recent_window(**cpu(group_by="service_version")))
    assert [g["value"] for g in default["groups"]] == [f"v{i:02d}" for i in range(51, 41, -1)] + [""]
    assert (default["groups"][-1]["others"], default["groups"][-1]["total"]) == (True, 9030.0)
    capped = _series_ok(client, prof_stream, recent_window(**cpu(group_by="service_version", group_limit=51)))
    assert [g["value"] for g in capped["groups"]] == [f"v{i:02d}" for i in range(51, 1, -1)] + [""]
    assert [g["others"] for g in capped["groups"]] == [False] * 50 + [True]
    assert capped["groups"][-1]["total"] == 30.0


def test_ser15_rows_missing_label_form_empty_group(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    t = now_ns() - 60 * NS
    b.resource(
        [b.profile([b.sample(["pod_leaf"], values=[5])], time_ns=t)], {"service.name": "svc-p", "k8s.pod.name": "pod-1"}
    )
    b.resource([b.profile([b.sample(["nopod_leaf"], values=[7])], time_ns=t)], {"service.name": "svc-p"})
    ingest_ok(client, prof_stream, b.model())
    wait_merge_total(client, prof_stream, recent_window(**cpu()), 12)
    body = _series_ok(client, prof_stream, recent_window(**cpu(group_by="k8s_pod_name")))
    assert [(g["value"], g["total"], g["others"]) for g in body["groups"]] == [("", 7.0, False), ("pod-1", 5.0, False)]


def test_ser16_group_ties_ordered_by_value(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    t = now_ns() - 60 * NS
    for version in ("v-b", "v-a"):
        b.resource(
            [b.profile([b.sample(["tie_leaf"], values=[9])], time_ns=t)],
            {"service.name": "svc-t", "service.version": version, "service.instance.id": version},
        )
    ingest_ok(client, prof_stream, b.model())
    wait_merge_total(client, prof_stream, recent_window(**cpu()), 18)
    body = _series_ok(client, prof_stream, recent_window(**cpu(group_by="service_version")))
    assert [(g["value"], g["total"]) for g in body["groups"]] == [("v-a", 9.0), ("v-b", 9.0)]


def test_ser17_group_by_unknown_column(client: OpenObserveClient, ref: RefData):
    _assert_400(
        _series(client, ref.stream, _checkout(ref, group_by="nonexistent_col")),
        "unknown group_by column: nonexistent_col",
    )


@pytest.mark.parametrize("key", ["a;b", "stack"], ids=["ser18-unsafe", "ser18-reserved"])
def test_ser18_group_by_unsafe_or_reserved(client: OpenObserveClient, ref: RefData, key: str):
    _assert_400(_series(client, ref.stream, _checkout(ref, group_by=key)), f"invalid group_by: {key}")


@pytest.mark.parametrize(("step", "secs"), [("60", 60), ("1 minute", 60), ("10 seconds", 10)])
def test_ser20_explicit_step_forms(client: OpenObserveClient, ref: RefData, step: str, secs: int):
    body = _series_ok(client, ref.stream, _checkout(ref, step=step))
    assert body["step_secs"] == secs
    assert sum(v for _, v in _points(body)) == CHECKOUT_TOTAL


def test_ser20_auto_step_forms_agree(client: OpenObserveClient, ref: RefData):
    base = ref.win(**cpu(service_name="checkout"))
    auto = _series_ok(client, ref.stream, {**base, "step": "auto"})
    assert auto["step_secs"] > 0
    for variant in ({**base, "step": ""}, base):
        body = _series_ok(client, ref.stream, variant)
        assert (body["step_secs"], body["series"]) == (auto["step_secs"], auto["series"])


@pytest.mark.parametrize(
    ("step", "message"),
    [("bad", "Invalid step: bad"), ("0", "step must be positive"), ("-5", "Invalid step: -5")],
    ids=["ser21-bad", "ser22-zero", "ser23-negative"],
)
def test_ser21_23_invalid_step(client: OpenObserveClient, ref: RefData, step: str, message: str):
    _assert_400(_series(client, ref.stream, _checkout(ref, step=step)), message)


def _bucket_cap_message(n: int) -> str:
    return (
        f"step too fine for time range: estimated {n} histogram buckets exceeds max 99999; "
        "increase step or narrow the time range"
    )


def test_ser24_bucket_cap(client: OpenObserveClient, ref: RefData):
    end = now_us()
    resp = _series(client, ref.stream, window(end - 7 * 24 * 3600 * US, end, **cpu(step="1")))
    _assert_400(resp, _bucket_cap_message(604800))


def test_ser25_bucket_cap_boundary(client: OpenObserveClient, ref: RefData):
    end = now_us()
    ok = _series_ok(client, ref.stream, window(end - 99_999 * US, end, **cpu(step="1", service_name="checkout")))
    assert sum(v for _, v in _points(ok)) == CHECKOUT_TOTAL
    _assert_400(
        _series(client, ref.stream, window(end - 100_000 * US, end, **cpu(step="1"))), _bucket_cap_message(100000)
    )


@pytest.mark.parametrize(
    ("drop", "message"),
    [
        ("profile_type", "profile_type is required"),
        ("profile_unit", "profile_unit is required"),
        ("start_time", "start_time and end_time are required (microseconds)"),
    ],
    ids=["ser26-type", "ser27-unit", "ser28-start-time"],
)
def test_ser26_28_missing_fields(client: OpenObserveClient, ref: RefData, drop: str, message: str):
    body = _checkout(ref)
    del body[drop]
    _assert_400(_series(client, ref.stream, body), message)


def test_ser29_start_equals_end(client: OpenObserveClient, ref: RefData):
    _assert_400(
        _series(client, ref.stream, window(ref.t0_us, ref.t0_us, **cpu())), "start_time must be less than end_time"
    )


def test_ser30_filter_op_not_equal(client: OpenObserveClient, ref: RefData):
    resp = _series(client, ref.stream, _checkout(ref, filters=[{"key": "host_name", "op": "!=", "value": "x"}]))
    _assert_400(resp, "only filter op '=' is supported")


@pytest.mark.parametrize("key", ["stack", "a;b", "a" * 129], ids=["ser31-reserved", "ser31-unsafe", "ser31-129-chars"])
def test_ser31_invalid_filter_key(client: OpenObserveClient, ref: RefData, key: str):
    _assert_400(
        _series(client, ref.stream, _checkout(ref, filters=[{"key": key, "value": "x"}])), f"invalid filter key: {key}"
    )


def test_ser32_filter_unknown_column(client: OpenObserveClient, ref: RefData):
    resp = _series(client, ref.stream, _checkout(ref, filters=[{"key": "no_such_col", "value": "x"}]))
    assert resp.status_code == 400, resp.text
    assert resp.json()["code"] == 20004
    assert "unknown field 'no_such_col'" in resp.json()["message"]


@pytest.mark.parametrize("timeout", [0, -5])
def test_ser33_invalid_timeout(client: OpenObserveClient, ref: RefData, timeout: int):
    _assert_400(_series(client, ref.stream, _checkout(ref, timeout=timeout)), "Invalid timeout parameter")


def test_ser34_malformed_json_body(client: OpenObserveClient, ref: RefData):
    resp = client.post(
        f"{ref.stream}/profiles/series", data='{"start_time":', headers={"Content-Type": "application/json"}
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["message"].startswith("Failed to parse the request body as JSON"), resp.text


def test_ser35_unknown_stream(client: OpenObserveClient, ref: RefData):
    stream = f"no_such_{uuid.uuid4().hex[:8]}"
    resp = _series(client, stream, _checkout(ref))
    assert resp.status_code == 400, resp.text
    assert resp.json()["code"] == 20002
    assert resp.json()["message"] == f"Search stream not found: {stream}"


def test_ser36_empty_window(client: OpenObserveClient, ref: RefData, empty_window: dict):
    body = _series_ok(client, ref.stream, {**empty_window, **cpu(service_name="checkout", step="60")})
    assert body["series"] == []


def test_ser37_data_source_filter(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    t = now_ns() - 60 * NS
    b.resource(
        [b.profile([b.sample(["py_leaf"], values=[11])], time_ns=t)], {"service.name": "svc-ds"}, scope_name="pyroscope"
    )
    b.resource(
        [b.profile([b.sample(["eb_leaf"], values=[22])], time_ns=t)],
        {"service.name": "svc-ds"},
        scope_name="ebpf-profiler",
    )
    ingest_ok(client, prof_stream, b.model())
    wait_merge_total(client, prof_stream, recent_window(**cpu()), 33)
    body = _series_ok(client, prof_stream, recent_window(**cpu(data_source="pyroscope")))
    assert sum(v for _, v in _points(body)) == 11


def test_ser38_no_auth(client: OpenObserveClient, ref: RefData):
    resp = requests.post(client.url(f"{ref.stream}/profiles/series"), json=_checkout(ref), timeout=30)
    assert resp.status_code == 401, resp.text
