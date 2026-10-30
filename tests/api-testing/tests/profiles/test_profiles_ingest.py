"""Profiles ingestion: formats, auth, compression, stream naming and the stored row shape (feature §2.1-§2.4)."""

from __future__ import annotations

import gzip
import json
import uuid

import pytest
import requests

from support.client import OpenObserveClient

from .profiles_helpers import (
    NS,
    US,
    ProfilesBuilder,
    by_stack,
    child,
    cpu,
    ingest_json,
    ingest_ok,
    ingest_proto,
    merge_ok,
    native_model,
    now_ns,
    now_us,
    profiles_streams,
    query,
    recent_window,
    simple_request,
    snappy_raw,
    to_json,
    to_proto,
    wait_merge_total,
    wait_rows,
)

A_STACKS = [(["a_leaf", "a_work", "a_main"], 300), (["a_work", "a_main"], 100)]


def _one_profile(b: ProfilesBuilder, samples: list[dict], attrs: dict | None = None, **profile_kw) -> dict:
    b.resource(
        [b.profile(samples, time_ns=profile_kw.pop("time_ns", now_ns() - 60 * NS), **profile_kw)],
        {"service.name": "svc-a", **(attrs or {})},
    )
    return b.model()


def _deep(n: int) -> list[str]:
    return [f"deep_{i:04d}" for i in range(n)]


def _depth_rows(client: OpenObserveClient, stream: str, frames: int) -> dict:
    ingest_ok(client, stream, simple_request([(_deep(frames), 1)]))
    return wait_rows(client, stream, 1)[0]


def test_ing01_json_ingest(client: OpenObserveClient, prof_stream: str):
    resp = ingest_json(client, prof_stream, to_json(simple_request(A_STACKS)))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {}
    wait_merge_total(client, prof_stream, recent_window(**cpu()), 400)


def test_ing02_v1development_path(client: OpenObserveClient, prof_stream: str):
    resp = ingest_json(client, prof_stream, to_json(simple_request(A_STACKS)), path="v1development/profiles")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {}
    wait_merge_total(client, prof_stream, recent_window(**cpu()), 400)


def test_ing03_protobuf_ingest(client: OpenObserveClient, prof_stream: str):
    resp = ingest_proto(client, prof_stream, simple_request(A_STACKS))
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/x-protobuf")
    assert resp.content == b"", "a fully accepted proto export answers an empty ExportProfilesServiceResponse"
    wait_merge_total(client, prof_stream, recent_window(**cpu()), 400)


def test_ing04_json_with_charset(client: OpenObserveClient, prof_stream: str):
    resp = ingest_json(
        client, prof_stream, to_json(simple_request(A_STACKS)), content_type="application/json; charset=utf-8"
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {}
    wait_merge_total(client, prof_stream, recent_window(**cpu()), 400)


def test_ing05_gzip_body(client: OpenObserveClient, prof_stream: str):
    body = gzip.compress(json.dumps(to_json(simple_request(A_STACKS))).encode())
    resp = ingest_json(client, prof_stream, body, headers={"Content-Encoding": "gzip"})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {}
    wait_merge_total(client, prof_stream, recent_window(**cpu()), 400)


def test_ing06_snappy_body(client: OpenObserveClient, prof_stream: str):
    body = snappy_raw(to_proto(simple_request(A_STACKS)))
    resp = ingest_proto(client, prof_stream, body, headers={"Content-Encoding": "snappy"})
    assert resp.status_code == 200, resp.text
    assert resp.content == b""
    wait_merge_total(client, prof_stream, recent_window(**cpu()), 400)


def test_ing07_no_stream_header_writes_default(client: OpenObserveClient):
    service = f"svc-noheader-{uuid.uuid4().hex[:8]}"
    # `default` is shared and is not deleted: a deleted stream answers 503 "being deleted" to the next run's ingest.
    resp = ingest_json(client, None, to_json(simple_request([(["nh_leaf", "nh_main"], 77)], service=service)))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {}
    wait_merge_total(client, "default", recent_window(**cpu(service_name=service)), 77)


def test_ing08_upper_case_stream_name_lowered(client: OpenObserveClient, new_stream):
    lower = new_stream("prof_up")
    resp = ingest_json(client, lower.upper(), to_json(simple_request(A_STACKS)))
    assert resp.status_code == 200, resp.text
    wait_merge_total(client, lower, recent_window(**cpu()), 400)
    names = profiles_streams(client)
    assert lower in names
    assert lower.upper() not in names


def test_ing09_stored_row_shape(client: OpenObserveClient, prof_stream: str):
    ingest_ok(client, prof_stream, simple_request(A_STACKS))
    rows = by_stack(wait_rows(client, prof_stream, 2))
    row = rows["a_leaf;a_work;a_main"]
    assert row["value"] == 300
    assert row["frame_count"] == 3
    assert row["profile_type"] == "cpu"
    assert row["profile_unit"] == "nanoseconds"
    assert row["service_name"] == "svc-a"
    assert row["extractor_version"] == "v1"
    assert row["duration_nanos"] == 10 * NS
    assert rows["a_work;a_main"]["value"] == 100
    assert rows["a_work;a_main"]["frame_count"] == 2
    schema = client.get(f"streams/{prof_stream}/schema?type=profiles")
    assert schema.status_code == 200, schema.text
    fields = {f["name"] for f in schema.json()["schema"]}
    assert "event_id" not in fields
    assert {"stack", "value", "frame_count", "profile_type", "profile_unit", "service_name"} <= fields


def test_ing10_paired_values_and_timestamps(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    t = now_ns()
    stamps = [t - 3 * NS + 111_000, t - 2 * NS + 222_000, t - NS + 333_000]
    ingest_ok(client, prof_stream, _one_profile(b, [b.sample(["p_leaf"], values=[10, 20, 30], timestamps=stamps)]))
    rows = wait_rows(client, prof_stream, 3)
    assert [(r["_timestamp"], r["value"]) for r in rows] == [
        (s // 1000, v) for s, v in zip(stamps, [10, 20, 30], strict=True)
    ]


def test_ing11_timestamps_only_value_one(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    t = now_ns()
    stamps = [t - 2 * NS, t - NS]
    ingest_ok(client, prof_stream, _one_profile(b, [b.sample(["t_leaf"], timestamps=stamps)]))
    rows = wait_rows(client, prof_stream, 2)
    assert [(r["_timestamp"], r["value"]) for r in rows] == [(s // 1000, 1) for s in stamps]


def test_ing12_values_only_summed_at_profile_time(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    t = now_ns() - 30 * NS + 123_456
    ingest_ok(client, prof_stream, _one_profile(b, [b.sample(["v_leaf"], values=[5, 6, 7])], time_ns=t))
    rows = wait_rows(client, prof_stream, 1)
    assert rows[0]["value"] == 18
    assert rows[0]["_timestamp"] == t // 1000


def test_ing13_zero_profile_time_is_now(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    before = now_us()
    ingest_ok(client, prof_stream, _one_profile(b, [b.sample(["z_leaf"], values=[3])], time_ns=0))
    rows = wait_rows(client, prof_stream, 1)
    assert abs(rows[0]["_timestamp"] - before) <= 60 * US, rows[0]


def test_ing14_zero_sample_timestamp_uses_profile_time(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    t = now_ns() - 40 * NS + 7_000
    ingest_ok(client, prof_stream, _one_profile(b, [b.sample(["zt_leaf"], values=[7], timestamps=[0])], time_ns=t))
    rows = wait_rows(client, prof_stream, 1)
    assert rows[0]["value"] == 7
    assert rows[0]["_timestamp"] == t // 1000


def test_ing15_resource_attributes_to_columns(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    attrs = {
        "host.name": "host-15",
        "deployment.environment": "qa",
        "process.pid": 4242,
        "service.version": "v15",
        "service.instance.id": "inst-15",
        "k8s.pod.name": "pod-15",
        "team.owner": "team-a",
    }
    ingest_ok(client, prof_stream, _one_profile(b, [b.sample(["r_leaf"], values=[1])], attrs))
    row = wait_rows(client, prof_stream, 1)[0]
    assert row["host_name"] == "host-15"
    assert row["deployment_environment"] == "qa"
    assert str(row["process_pid"]) == "4242"
    assert row["service_version"] == "v15"
    assert row["service_instance_id"] == "inst-15"
    assert row["k8s_pod_name"] == "pod-15"
    assert row["team_owner"] == "team-a"


def test_ing16_empty_resource_attribute_skipped(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    ingest_ok(client, prof_stream, _one_profile(b, [b.sample(["e_leaf"], values=[1])], {"team.owner": ""}))
    row = wait_rows(client, prof_stream, 1)[0]
    assert "team_owner" not in row
    fields = {f["name"] for f in client.get(f"streams/{prof_stream}/schema?type=profiles").json()["schema"]}
    assert "team_owner" not in fields


def test_ing17_resource_attrs_cannot_overwrite_reserved(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    attrs = {"stack": "evil", "value": "evil", "profile.type": "x"}
    ingest_ok(client, prof_stream, _one_profile(b, [b.sample(["real_leaf", "real_root"], values=[9])], attrs))
    row = wait_rows(client, prof_stream, 1)[0]
    assert row["stack"] == "real_leaf;real_root"
    assert row["value"] == 9
    assert row["profile_type"] == "cpu"


def test_ing18_sample_attributes_to_thread_columns(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    attrs = {"thread.id": 42, "thread.name": "worker-1", "cpu.logical_number": 3, "custom.tag": "x"}
    ingest_ok(client, prof_stream, _one_profile(b, [b.sample(["th_leaf"], values=[1], attrs=attrs)]))
    row = wait_rows(client, prof_stream, 1)[0]
    assert row["thread_id"] == "42"
    assert row["thread_name"] == "worker-1"
    assert row["cpu_logical_number"] == "3"
    assert row["custom_tag"] == "x"


def test_ing19_thread_id_aliases(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    samples = [
        b.sample(["os_leaf"], values=[1], attrs={"os.thread.id": "101"}),
        b.sample(["us_leaf"], values=[1], attrs={"thread_id": "202"}),
    ]
    ingest_ok(client, prof_stream, _one_profile(b, samples))
    rows = by_stack(wait_rows(client, prof_stream, 2))
    assert rows["os_leaf"]["thread_id"] == "101"
    assert rows["us_leaf"]["thread_id"] == "202"


def test_ing20_trace_link_lowercased_only_on_linked_sample(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    link = b.link("0af7651916cd43dd8448eb211c80319c", "b7ad6b7169203331")
    body = to_json(_one_profile(b, [b.sample(["linked"], values=[5], link=link), b.sample(["plain"], values=[6])]))
    body["dictionary"]["linkTable"][link] = {
        "traceId": "0AF7651916CD43DD8448EB211C80319C",
        "spanId": "B7AD6B7169203331",
    }
    resp = ingest_json(client, prof_stream, body)
    assert resp.status_code == 200, resp.text
    rows = by_stack(wait_rows(client, prof_stream, 2))
    assert rows["linked"]["trace_id"] == "0af7651916cd43dd8448eb211c80319c"
    assert rows["linked"]["span_id"] == "b7ad6b7169203331"
    assert "trace_id" not in rows["plain"]
    assert "span_id" not in rows["plain"]


def test_ing21_profile_duration_once_per_instance(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    samples = [b.sample([f"d_leaf_{i}"], values=[i + 1]) for i in range(3)]
    ingest_ok(client, prof_stream, _one_profile(b, samples))
    rows = wait_rows(client, prof_stream, 3)
    assert [r.get("profile_duration_nanos") for r in rows].count(10 * NS) == 1
    assert sum("profile_duration_nanos" in r for r in rows) == 1


def test_ing22_profile_duration_per_instance_in_batch(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    t = now_ns() - 60 * NS
    for inst in ("a", "b"):
        samples = [b.sample([f"{inst}_leaf_{i}"], values=[1]) for i in range(2)]
        b.resource([b.profile(samples, time_ns=t)], {"service.name": "svc-a", "service.instance.id": f"inst-{inst}"})
    ingest_ok(client, prof_stream, b.model())
    rows = wait_rows(client, prof_stream, 4)
    timed = sorted(r["service_instance_id"] for r in rows if r.get("profile_duration_nanos") == 10 * NS)
    assert timed == ["inst-a", "inst-b"]


def test_ing23_profile_id_hex_and_zero_omitted(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    t = now_ns() - 60 * NS
    pid = bytes(range(1, 17))
    b.resource(
        [
            b.profile([b.sample(["pid_a"], values=[1])], time_ns=t, profile_id=pid),
            b.profile([b.sample(["pid_b"], values=[1])], time_ns=t, profile_id=bytes(16)),
        ],
        {"service.name": "svc-a"},
    )
    ingest_ok(client, prof_stream, b.model())
    rows = by_stack(wait_rows(client, prof_stream, 2))
    assert rows["pid_a"]["profile_id"] == pid.hex()
    assert "profile_id" not in rows["pid_b"]


def test_ing24_period_fields(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    t = now_ns() - 60 * NS
    b.resource(
        [
            b.profile(
                [b.sample(["per_ns"], values=[1])], time_ns=t, period_type=("cpu", "nanoseconds"), period=10_000_000
            ),
            b.profile([b.sample(["per_count"], values=[1])], time_ns=t, period_type=("samples", "count"), period=99),
        ],
        {"service.name": "svc-a"},
    )
    ingest_ok(client, prof_stream, b.model())
    rows = by_stack(wait_rows(client, prof_stream, 2))
    ns_row, count_row = rows["per_ns"], rows["per_count"]
    assert (ns_row["period_nanos"], ns_row["period_type"], ns_row["period_unit"]) == (10_000_000, "cpu", "nanoseconds")
    assert "period" not in ns_row
    assert (count_row["period"], count_row["period_type"], count_row["period_unit"]) == (99, "samples", "count")
    assert "period_nanos" not in count_row


def test_ing25_scope_name_and_version(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    b.resource(
        [b.profile([b.sample(["sc_leaf"], values=[1])], time_ns=now_ns() - 60 * NS)],
        {"service.name": "svc-a"},
        scope_name="pyroscope",
        scope_version="1.2",
    )
    ingest_ok(client, prof_stream, b.model())
    row = wait_rows(client, prof_stream, 1)[0]
    assert row["otel_scope_name"] == "pyroscope"
    assert row["otel_scope_version"] == "1.2"


def _service_fallback(client: OpenObserveClient, stream: str, attrs: dict) -> str:
    b = ProfilesBuilder()
    b.resource([b.profile([b.sample(["fb_leaf"], values=[1])], time_ns=now_ns() - 60 * NS)], attrs)
    ingest_ok(client, stream, b.model())
    return wait_rows(client, stream, 1)[0]["service_name"]


def test_ing26_missing_service_uses_executable(client: OpenObserveClient, prof_stream: str):
    assert _service_fallback(client, prof_stream, {"process.executable.name": "mybin"}) == "unknown_service:mybin"
    w = recent_window()
    meta = query(
        client, prof_stream, "meta", method="GET", params={"start_time": w["start_time"], "end_time": w["end_time"]}
    )
    assert meta.status_code == 200, meta.text
    assert meta.json()["services"] == ["unknown_service:mybin"]


def test_ing27_missing_service_no_executable(client: OpenObserveClient, prof_stream: str):
    assert _service_fallback(client, prof_stream, {}) == "unknown_service"


def test_ing28_empty_service_name_uses_executable(client: OpenObserveClient, prof_stream: str):
    attrs = {"service.name": "", "process.executable.name": "emptysvcbin"}
    assert _service_fallback(client, prof_stream, attrs) == "unknown_service:emptysvcbin"


def test_ing29_deep_stack_truncated(client: OpenObserveClient, prof_stream: str):
    row = _depth_rows(client, prof_stream, 1100)
    frames = row["stack"].split(";")
    assert row["frame_count"] == 1000
    assert len(frames) == 1000
    assert frames[0] == "deep_0000"
    assert frames[-2:] == ["deep_0998", "[truncated]"]


def test_ing30_exactly_1000_frames_kept(client: OpenObserveClient, prof_stream: str):
    row = _depth_rows(client, prof_stream, 1000)
    assert row["frame_count"] == 1000
    assert row["stack"] == ";".join(_deep(1000))


def test_ing31_1001_frames_truncated(client: OpenObserveClient, prof_stream: str):
    row = _depth_rows(client, prof_stream, 1001)
    assert row["frame_count"] == 1000
    assert row["stack"] == ";".join(_deep(999) + ["[truncated]"])


def test_ing32_inlined_lines_become_frames(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    stack = b.stack_locs([b.loc_fn("inner", "outer"), b.loc_fn("main32")])
    ingest_ok(client, prof_stream, _one_profile(b, [b.sample(stack=stack, values=[4])]))
    row = wait_rows(client, prof_stream, 1)[0]
    assert row["stack"] == "inner;outer;main32"
    assert row["frame_count"] == 3


def test_ing33_function_without_name_uses_system_name(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    loc = b.loc_raw(lines=[{"function_index": b.func(None, "sys_fn")}])
    stack = b.stack_locs([loc, b.loc_fn("main33")])
    ingest_ok(client, prof_stream, _one_profile(b, [b.sample(stack=stack, values=[4])]))
    assert wait_rows(client, prof_stream, 1)[0]["stack"] == "sys_fn;main33"


def test_ing34_unsymbolized_frames_file_and_build_id(client: OpenObserveClient, prof_stream: str):
    ingest_ok(client, prof_stream, native_model())
    row = wait_rows(client, prof_stream, 1)[0]
    assert row["stack"] == "libqa.so.1@deadbeefcafe+0x110;libqa.so.1@deadbeefcafe+0x120;a9_root"
    root = merge_ok(client, prof_stream, recent_window(**cpu()))["root"]
    native = child(child(root, "a9_root"), "[libqa.so.1]")
    assert (native["self"], native["total"]) == (9, 9)
    assert not native.get("children")


def test_ing35_unsymbolized_frames_with_frame_type(client: OpenObserveClient, prof_stream: str):
    ingest_ok(client, prof_stream, native_model("native"))
    row = wait_rows(client, prof_stream, 1)[0]
    assert row["stack"] == "libqa.so.1@deadbeefcafe+0x110/native;libqa.so.1@deadbeefcafe+0x120/native;a9_root"
    root = merge_ok(client, prof_stream, recent_window(**cpu()))["root"]
    assert child(child(root, "a9_root"), "[libqa.so.1]")["self"] == 9


def test_ing36_location_without_mapping_folds_to_unknown(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    stack = b.stack_locs([b.loc_raw(address=0xABC), b.loc_fn("root36")])
    ingest_ok(client, prof_stream, _one_profile(b, [b.sample(stack=stack, values=[6])]))
    assert wait_rows(client, prof_stream, 1)[0]["stack"] == "0xabc;root36"
    root = merge_ok(client, prof_stream, recent_window(**cpu()))["root"]
    assert child(child(root, "root36"), "[unknown]")["self"] == 6


def test_ing37_empty_stack_credits_root(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    ingest_ok(client, prof_stream, _one_profile(b, [b.sample(stack=0, values=[5]), b.sample(["es_leaf"], values=[10])]))
    rows = by_stack(wait_rows(client, prof_stream, 2))
    assert (rows[""]["value"], rows[""]["frame_count"]) == (5, 0)
    body = wait_merge_total(client, prof_stream, recent_window(**cpu()), 15)
    assert body["root"]["self"] == 5
    assert [t["name"] for t in body["top"]] == ["es_leaf"]


def test_ing38_profile_without_samples_not_rejected(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    b.resource([b.profile([], time_ns=now_ns())], {"service.name": "svc-a"})
    resp = ingest_json(client, prof_stream, to_json(b.model()))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {}
    assert prof_stream not in profiles_streams(client)


def test_ing39_empty_request_bodies(client: OpenObserveClient, prof_stream: str):
    for body in ({}, {"resourceProfiles": []}):
        resp = ingest_json(client, prof_stream, body)
        assert resp.status_code == 200, f"{body} -> {resp.text}"
        assert resp.json() == {}
    assert prof_stream not in profiles_streams(client)


def test_ing40_ingestion_passcode_auth(client: OpenObserveClient, prof_stream: str):
    resp = client.get("passcode")
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    body = json.dumps(to_json(simple_request(A_STACKS)))
    resp = requests.post(
        client.url("v1/profiles"),
        data=body,
        auth=(data["user"], data["passcode"]),
        headers={"Content-Type": "application/json", "stream-name": prof_stream},
        timeout=30,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {}
    wait_merge_total(client, prof_stream, recent_window(**cpu()), 400)


def test_ing41_no_auth(client: OpenObserveClient, prof_stream: str):
    resp = requests.post(
        client.url("v1/profiles"),
        data=json.dumps(to_json(simple_request(A_STACKS))),
        headers={"Content-Type": "application/json", "stream-name": prof_stream},
        timeout=30,
    )
    assert resp.status_code == 401, resp.text
    assert prof_stream not in profiles_streams(client)


def test_ing42_wrong_password(client: OpenObserveClient, prof_stream: str):
    resp = requests.post(
        client.url("v1/profiles"),
        data=json.dumps(to_json(simple_request(A_STACKS))),
        auth=(client.email, "wrong-password"),
        headers={"Content-Type": "application/json", "stream-name": prof_stream},
        timeout=30,
    )
    assert resp.status_code == 401, resp.text
    assert prof_stream not in profiles_streams(client)


def test_ing43_values_sum_saturates(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    ingest_ok(client, prof_stream, _one_profile(b, [b.sample(["sat_leaf"], values=[9223372036854775807, 1])]))
    assert wait_rows(client, prof_stream, 1)[0]["value"] == 9223372036854775807


def test_ing44_negative_value_kept(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    ingest_ok(client, prof_stream, _one_profile(b, [b.sample(["neg_leaf"], values=[-5])]))
    assert wait_rows(client, prof_stream, 1)[0]["value"] == -5


# Product bug: profiles never apply ZO_COLS_PER_RECORD_LIMIT; strict xfail turns red once o2-enterprise#3123 fixes it, then drop the marker.
@pytest.mark.xfail(strict=True, reason="Known product bug o2-enterprise#3123: profiles ignore ZO_COLS_PER_RECORD_LIMIT")
def test_ing45_too_many_columns_rejected(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    attrs = {f"extra.attr_{i:04d}": f"v{i}" for i in range(1010)}
    resp = ingest_json(client, prof_stream, to_json(_one_profile(b, [b.sample(["wide_leaf"], values=[1])], attrs)))
    assert resp.status_code == 400, resp.text[:500]
    assert resp.json()["code"] == 3
    assert "ZO_COLS_PER_RECORD_LIMIT" in resp.json()["message"]


def test_ing47_first_write_to_new_stream_succeeds(client: OpenObserveClient, prof_stream: str):
    assert prof_stream not in profiles_streams(client)
    resp = ingest_proto(client, prof_stream, simple_request(A_STACKS))
    assert resp.status_code == 200, f"first write to a new stream must not fail (#15956): {resp.text}"
    wait_merge_total(client, prof_stream, recent_window(**cpu()), 400)


def test_ing48_two_profile_types_in_one_resource(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    t = now_ns() - 60 * NS
    b.resource(
        [
            b.profile(b.stacks_samples([(["cpu_leaf", "m_root"], 700)]), time_ns=t),
            b.profile(
                b.stacks_samples([(["alloc_leaf", "m_root"], 4096)]), type_="alloc_space", unit="bytes", time_ns=t
            ),
        ],
        {"service.name": "svc-a"},
    )
    ingest_ok(client, prof_stream, b.model())
    w = recent_window()
    wait_merge_total(client, prof_stream, recent_window(**cpu()), 700)
    alloc = wait_merge_total(client, prof_stream, recent_window(profile_type="alloc_space", profile_unit="bytes"), 4096)
    assert alloc["unit"] == "bytes"
    assert [t["name"] for t in alloc["top"]] == ["alloc_leaf", "m_root"]
    meta = query(
        client, prof_stream, "meta", method="GET", params={"start_time": w["start_time"], "end_time": w["end_time"]}
    )
    assert meta.status_code == 200, meta.text
    assert meta.json()["profile_types"] == [
        {"type": "alloc_space", "unit": "bytes"},
        {"type": "cpu", "unit": "nanoseconds"},
    ]
