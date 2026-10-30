"""Profiles ingest validation: Content-Type, decode errors, dictionary rules, partial success, time window (feature §2.1-§2.3)."""

from __future__ import annotations

import base64

import pytest

from support.client import OpenObserveClient

from .profiles_helpers import (
    BAD_CT_BODY,
    NS,
    PARTIAL_MSG,
    STALE_NS,
    ProfilesBuilder,
    cpu,
    decode_fields,
    ingest_json,
    ingest_proto,
    now_ns,
    profiles_streams,
    recent_window,
    simple_request,
    to_json,
    to_proto,
    wait_merge_total,
    wait_rows,
)

A_STACKS = [(["a_leaf", "a_work", "a_main"], 300), (["a_work", "a_main"], 100)]
SAMPLE0 = "resource_profiles[0].scope_profiles[0].profiles[0].samples[0]"
PROFILE0 = "resource_profiles[0].scope_profiles[0].profiles[0]"
PARTIAL_1 = {"partialSuccess": {"rejectedProfiles": "1", "errorMessage": PARTIAL_MSG}}


def _assert_invalid(resp, message: str) -> None:
    assert resp.status_code == 400, f"{resp.status_code} {resp.text[:500]}"
    assert resp.json() == {"code": 3, "message": message}


def _json_error(resp) -> str:
    assert resp.status_code == 400, f"{resp.status_code} {resp.text[:500]}"
    body = resp.json()
    assert body["code"] == 3, body
    return body["message"]


def _proto_status(resp) -> tuple[int, str]:
    assert resp.status_code == 400, f"{resp.status_code} {resp.content[:300]!r}"
    assert resp.headers["content-type"].startswith("application/x-protobuf")
    fields = decode_fields(resp.content)
    return fields[1][0], fields[2][0].decode()


def _base() -> dict:
    return to_json(simple_request(A_STACKS))


def _compacted() -> dict:
    """Collector 0.153 shape: no zero sentinels, index 0 holds real entries."""
    return {
        "resourceProfiles": [
            {
                "resource": {"attributes": [{"key": "service.name", "value": {"stringValue": "svc-c"}}]},
                "scopeProfiles": [
                    {
                        "profiles": [
                            {
                                "sampleType": {"typeStrindex": 0, "unitStrindex": 1},
                                "timeUnixNano": str(now_ns() - 60 * NS),
                                "durationNano": str(10 * NS),
                                "samples": [{"stackIndex": 0, "values": ["300"]}, {"stackIndex": 1, "values": ["100"]}],
                            }
                        ]
                    }
                ],
            }
        ],
        "dictionary": {
            "stringTable": ["cpu", "nanoseconds", "c_leaf", "c_work", "c_main"],
            "functionTable": [{"nameStrindex": 2}, {"nameStrindex": 3}, {"nameStrindex": 4}],
            "locationTable": [{"lines": [{"functionIndex": i}]} for i in range(3)],
            "stackTable": [{"locationIndices": [0, 1, 2]}, {"locationIndices": [1, 2]}],
        },
    }


def _samples(body: dict) -> list[dict]:
    return body["resourceProfiles"][0]["scopeProfiles"][0]["profiles"][0]["samples"]


@pytest.mark.parametrize(
    "content_type",
    ["text/plain", "application/protobuf", None],
    ids=["val01-text-plain", "val02-protobuf-without-x", "val03-missing"],
)
def test_val01_03_bad_content_type(client: OpenObserveClient, prof_stream: str, content_type: str | None):
    headers = {"stream-name": prof_stream}
    if content_type:
        headers["Content-Type"] = content_type
    resp = client.post("v1/profiles", data=to_proto(simple_request(A_STACKS)), headers=headers)
    assert resp.status_code == 400, resp.text
    assert resp.json() == BAD_CT_BODY
    assert prof_stream not in profiles_streams(client)


def test_val04_garbage_protobuf(client: OpenObserveClient, prof_stream: str):
    code, message = _proto_status(ingest_proto(client, prof_stream, b"\xff\xff\x07"))
    assert code == 3
    assert message.startswith("Invalid proto: "), message


def test_val05_truncated_protobuf(client: OpenObserveClient, prof_stream: str):
    code, message = _proto_status(ingest_proto(client, prof_stream, to_proto(simple_request(A_STACKS))[:-3]))
    assert code == 3
    assert message.startswith("Invalid proto: "), message
    assert prof_stream not in profiles_streams(client)


@pytest.mark.parametrize(
    "raw",
    ['{"resourceProfiles":[', '{"resourceProfiles":"x"}', "[]"],
    ids=["val06-malformed", "val07-wrong-type", "val08-array"],
)
def test_val06_08_invalid_json(client: OpenObserveClient, prof_stream: str, raw: str):
    message = _json_error(ingest_json(client, prof_stream, raw))
    assert message.startswith("Invalid json: "), message


SENTINELS = {
    "mapping_table": ("mappingTable", {"memoryStart": "4096"}),
    "location_table": ("locationTable", {"address": "1"}),
    "function_table": ("functionTable", {"nameStrindex": 1}),
    "link_table": ("linkTable", {"traceId": "01" * 16, "spanId": "02" * 8}),
    "string_table": ("stringTable", "not-empty"),
    "attribute_table": ("attributeTable", {"keyStrindex": 1, "value": {"stringValue": "x"}}),
    "stack_table": ("stackTable", {"locationIndices": [1]}),
}


@pytest.mark.parametrize("table", list(SENTINELS), ids=[f"val09-{t}" for t in SENTINELS])
def test_val09_canonical_sentinel_per_table(client: OpenObserveClient, prof_stream: str, table: str):
    body = _base()
    key, entry = SENTINELS[table]
    body["dictionary"][key][0] = entry
    _assert_invalid(ingest_json(client, prof_stream, body), f"dictionary.{table}[0] must be the zero value")


def test_val10_sentinel_order_function_before_stack(client: OpenObserveClient, prof_stream: str):
    body = _base()
    body["dictionary"]["functionTable"][0] = {"nameStrindex": 1}
    body["dictionary"]["stackTable"][0] = {"locationIndices": [1]}
    _assert_invalid(ingest_json(client, prof_stream, body), "dictionary.function_table[0] must be the zero value")


def test_val11_fully_compacted_dictionary_accepted(client: OpenObserveClient, prof_stream: str):
    resp = ingest_json(client, prof_stream, _compacted())
    assert resp.status_code == 200, resp.text
    assert resp.json() == {}
    rows = wait_rows(client, prof_stream, 2)
    assert sorted((r["stack"], r["value"]) for r in rows) == [("c_leaf;c_work;c_main", 300), ("c_work;c_main", 100)]
    assert {(r["profile_type"], r["profile_unit"]) for r in rows} == {("cpu", "nanoseconds")}


def test_val12_only_string_zero_set_is_not_compacted(client: OpenObserveClient, prof_stream: str):
    body = _base()
    body["dictionary"]["stringTable"][0] = "cpu"
    _assert_invalid(ingest_json(client, prof_stream, body), "dictionary.string_table[0] must be the zero value")


def test_val13_string_and_stack_without_location_not_compacted(client: OpenObserveClient, prof_stream: str):
    body = _base()
    body["dictionary"]["stringTable"][0] = "cpu"
    body["dictionary"]["stackTable"][0] = {"locationIndices": [1]}
    body["dictionary"]["functionTable"][0] = {"nameStrindex": 1}
    _assert_invalid(ingest_json(client, prof_stream, body), "dictionary.function_table[0] must be the zero value")


def test_val14_stack_and_location_without_string_not_compacted(client: OpenObserveClient, prof_stream: str):
    body = _base()
    body["dictionary"]["stackTable"][0] = {"locationIndices": [1]}
    body["dictionary"]["locationTable"][0] = {"lines": [{"functionIndex": 1}]}
    _assert_invalid(ingest_json(client, prof_stream, body), "dictionary.location_table[0] must be the zero value")


def test_val15_compacted_index_checked_before_rebase(client: OpenObserveClient, prof_stream: str):
    body = _compacted()
    _samples(body)[0]["stackIndex"] = 2
    _assert_invalid(
        ingest_json(client, prof_stream, body), f"{SAMPLE0}.stack_index: index 2 is outside dictionary table length 2"
    )


@pytest.mark.parametrize("index", [99, -1, 3], ids=["val16-99", "val17-negative", "val18-equal-len"])
def test_val16_18_stack_index_out_of_range(client: OpenObserveClient, prof_stream: str, index: int):
    body = _base()
    assert len(body["dictionary"]["stackTable"]) == 3
    _samples(body)[0]["stackIndex"] = index
    _assert_invalid(
        ingest_json(client, prof_stream, body),
        f"{SAMPLE0}.stack_index: index {index} is outside dictionary table length 3",
    )


def test_val19_stack_index_last_entry_ok(client: OpenObserveClient, prof_stream: str):
    body = _base()
    _samples(body)[0]["stackIndex"] = 2
    resp = ingest_json(client, prof_stream, body)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {}
    wait_merge_total(client, prof_stream, recent_window(**cpu()), 400)


def test_val20_index_zero_with_empty_table(client: OpenObserveClient, prof_stream: str):
    body = _base()
    body["dictionary"]["linkTable"] = []
    _samples(body)[0]["linkIndex"] = 0
    resp = ingest_json(client, prof_stream, body)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {}
    wait_merge_total(client, prof_stream, recent_window(**cpu()), 400)


def test_val21_function_index_out_of_range(client: OpenObserveClient, prof_stream: str):
    body = _base()
    assert len(body["dictionary"]["functionTable"]) == 4
    body["dictionary"]["locationTable"][1]["lines"][0]["functionIndex"] = 77
    _assert_invalid(
        ingest_json(client, prof_stream, body),
        "dictionary.location_table[1].lines[0].function_index: index 77 is outside dictionary table length 4",
    )


def test_val22_link_index_out_of_range(client: OpenObserveClient, prof_stream: str):
    body = _base()
    body["dictionary"]["linkTable"].append({"traceId": "01" * 16, "spanId": "02" * 8})
    _samples(body)[1]["linkIndex"] = 5
    _assert_invalid(
        ingest_json(client, prof_stream, body),
        f"{PROFILE0}.samples[1].link_index: index 5 is outside dictionary table length 2",
    )


def test_val23_location_indices_out_of_range(client: OpenObserveClient, prof_stream: str):
    body = _base()
    assert len(body["dictionary"]["locationTable"]) == 4
    body["dictionary"]["stackTable"][1]["locationIndices"][0] = 50
    _assert_invalid(
        ingest_json(client, prof_stream, body),
        "dictionary.stack_table[1].location_indices[0]: index 50 is outside dictionary table length 4",
    )


def test_val24_type_strindex_out_of_range(client: OpenObserveClient, prof_stream: str):
    body = _base()
    assert len(body["dictionary"]["stringTable"]) == 6
    body["resourceProfiles"][0]["scopeProfiles"][0]["profiles"][0]["sampleType"]["typeStrindex"] = 99
    _assert_invalid(
        ingest_json(client, prof_stream, body),
        f"{PROFILE0}.sample_type.type_strindex: index 99 is outside dictionary table length 6",
    )


def test_val25_period_type_unit_strindex_out_of_range(client: OpenObserveClient, prof_stream: str):
    body = _base()
    body["resourceProfiles"][0]["scopeProfiles"][0]["profiles"][0]["periodType"] = {
        "typeStrindex": 4,
        "unitStrindex": 99,
    }
    _assert_invalid(
        ingest_json(client, prof_stream, body),
        f"{PROFILE0}.period_type.unit_strindex: index 99 is outside dictionary table length 6",
    )


def test_val26_mapping_index_out_of_range(client: OpenObserveClient, prof_stream: str):
    body = _base()
    body["dictionary"]["locationTable"][1]["mappingIndex"] = 7
    _assert_invalid(
        ingest_json(client, prof_stream, body),
        "dictionary.location_table[1].mapping_index: index 7 is outside dictionary table length 1",
    )


def test_val27_mapping_filename_out_of_range(client: OpenObserveClient, prof_stream: str):
    body = _base()
    body["dictionary"]["mappingTable"].append({"memoryStart": "4096", "filenameStrindex": 999})
    _assert_invalid(
        ingest_json(client, prof_stream, body),
        "dictionary.mapping_table[1].filename_strindex: index 999 is outside dictionary table length 6",
    )


def test_val28_sample_attribute_index_out_of_range(client: OpenObserveClient, prof_stream: str):
    body = _base()
    _samples(body)[0]["attributeIndices"] = [5]
    _assert_invalid(
        ingest_json(client, prof_stream, body),
        f"{SAMPLE0}.attribute_indices[0]: index 5 is outside dictionary table length 1",
    )


def test_val29_nested_array_string_strindex_out_of_range(client: OpenObserveClient, prof_stream: str):
    body = _base()
    body["dictionary"]["attributeTable"].append(
        {"keyStrindex": 1, "value": {"arrayValue": {"values": [{"stringValueStrindex": 999}]}}}
    )
    _assert_invalid(
        ingest_json(client, prof_stream, body),
        "dictionary.attribute_table[1].value.array_value.values[0].string_value_strindex: "
        "index 999 is outside dictionary table length 6",
    )


def test_val30_resource_key_strindex_out_of_range(client: OpenObserveClient, prof_stream: str):
    body = _base()
    body["resourceProfiles"][0]["resource"]["attributes"].insert(0, {"keyStrindex": 999, "value": {"stringValue": "x"}})
    _assert_invalid(
        ingest_json(client, prof_stream, body),
        "resource_profiles[0].resource.attributes[0].key_strindex: index 999 is outside dictionary table length 6",
    )


def _partial(client: OpenObserveClient, stream: str, model: dict, rejected: str) -> None:
    resp = ingest_json(client, stream, to_json(model))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"partialSuccess": {"rejectedProfiles": rejected, "errorMessage": PARTIAL_MSG}}


def test_val31_length_mismatch_rejects_sample_keeps_good(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    t = now_ns() - 60 * NS
    bad = b.sample(["bad_leaf"], values=[1, 2], timestamps=[t, t + 1, t + 2])
    b.resource([b.profile([bad, b.sample(["good_leaf"], values=[50])], time_ns=t)], {"service.name": "svc-a"})
    _partial(client, prof_stream, b.model(), "1")
    rows = wait_rows(client, prof_stream, 1)
    assert (rows[0]["stack"], rows[0]["value"]) == ("good_leaf", 50)
    wait_merge_total(client, prof_stream, recent_window(**cpu()), 50)


def test_val32_sample_with_no_values_or_timestamps(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    b.resource(
        [b.profile([b.sample(["empty_leaf"]), b.sample(["good_leaf"], values=[50])], time_ns=now_ns() - 60 * NS)],
        {"service.name": "svc-a"},
    )
    _partial(client, prof_stream, b.model(), "1")
    rows = wait_rows(client, prof_stream, 1)
    assert (rows[0]["stack"], rows[0]["value"]) == ("good_leaf", 50)


def test_val33_rejected_counts_profiles_not_samples(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    t = now_ns() - 60 * NS
    x = b.profile([b.sample(["x1"], values=[1], timestamps=[t, t]), b.sample(["x2"])], time_ns=t)
    y = b.profile([b.sample(["y_leaf"], values=[8])], time_ns=t)
    b.resource([x, y], {"service.name": "svc-a"})
    _partial(client, prof_stream, b.model(), "1")
    rows = wait_rows(client, prof_stream, 1)
    assert (rows[0]["stack"], rows[0]["value"]) == ("y_leaf", 8)


def test_val34_two_bad_profiles(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    t = now_ns() - 60 * NS
    profiles = [b.profile([b.sample([f"bad_{i}"]), b.sample([f"ok_{i}"], values=[i + 1])], time_ns=t) for i in range(2)]
    b.resource(profiles, {"service.name": "svc-a"})
    _partial(client, prof_stream, b.model(), "2")
    rows = wait_rows(client, prof_stream, 2)
    assert sorted((r["stack"], r["value"]) for r in rows) == [("ok_0", 1), ("ok_1", 2)]


def _paired(ts: list[int], values: list[int]) -> dict:
    b = ProfilesBuilder()
    b.resource(
        [b.profile([b.sample(["win_leaf"], values=values, timestamps=ts)], time_ns=now_ns())], {"service.name": "svc-a"}
    )
    return b.model()


def test_val35_all_samples_far_future(client: OpenObserveClient, prof_stream: str):
    _partial(client, prof_stream, _paired([now_ns() + 48 * 3600 * NS], [5]), "1")
    assert prof_stream not in profiles_streams(client)


def test_val36_future_inside_window(client: OpenObserveClient, prof_stream: str):
    ts = now_ns() + 23 * 3600 * NS
    resp = ingest_json(client, prof_stream, to_json(_paired([ts], [5])))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {}
    rows = wait_rows(client, prof_stream, 1)
    assert (rows[0]["_timestamp"], rows[0]["value"]) == (ts // 1000, 5)


def test_val37_past_out_of_window(client: OpenObserveClient, prof_stream: str):
    _partial(client, prof_stream, _paired([now_ns() - STALE_NS], [5]), "1")
    assert prof_stream not in profiles_streams(client)


def test_val38_past_inside_window(client: OpenObserveClient, prof_stream: str):
    ts = now_ns() - 4 * 3600 * NS
    resp = ingest_json(client, prof_stream, to_json(_paired([ts], [5])))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {}
    rows = wait_rows(client, prof_stream, 1)
    assert (rows[0]["_timestamp"], rows[0]["value"]) == (ts // 1000, 5)


def test_val39_mixed_observations_keep_in_window(client: OpenObserveClient, prof_stream: str):
    now = now_ns()
    _partial(client, prof_stream, _paired([now, now + 48 * 3600 * NS], [1, 2]), "1")
    rows = wait_rows(client, prof_stream, 1)
    assert (rows[0]["_timestamp"], rows[0]["value"]) == (now // 1000, 1)
    assert rows[0]["profile_duration_nanos"] == 10 * NS


def test_val40_proto_partial_success_shape(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    t = now_ns() - 60 * NS
    bad = b.sample(["bad_leaf"], values=[1, 2], timestamps=[t])
    b.resource([b.profile([bad, b.sample(["good_leaf"], values=[50])], time_ns=t)], {"service.name": "svc-a"})
    resp = ingest_proto(client, prof_stream, b.model())
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/x-protobuf")
    partial = decode_fields(decode_fields(resp.content)[1][0])
    assert partial[1] == [1]
    assert partial[2] == [PARTIAL_MSG.encode()]
    wait_merge_total(client, prof_stream, recent_window(**cpu()), 50)


def _linked_body(trace_id: str) -> dict:
    b = ProfilesBuilder()
    link = b.link("01" * 16, "02" * 8)
    b.resource(
        [b.profile([b.sample(["link_leaf"], values=[3], link=link)], time_ns=now_ns() - 60 * NS)],
        {"service.name": "svc-a"},
    )
    body = to_json(b.model())
    body["dictionary"]["linkTable"][link]["traceId"] = trace_id
    return body


@pytest.mark.parametrize(
    "trace_id", ["0af7651916cd43dd8448eb211c80319", "zz" * 16], ids=["val41-odd-length", "val42-non-hex"]
)
def test_val41_42_bad_trace_id(client: OpenObserveClient, prof_stream: str, trace_id: str):
    message = _json_error(ingest_json(client, prof_stream, _linked_body(trace_id)))
    assert message.startswith("Invalid json: "), message
    assert prof_stream not in profiles_streams(client)


def test_val43_short_trace_id_stored_as_is(client: OpenObserveClient, prof_stream: str):
    resp = ingest_json(client, prof_stream, _linked_body("abcd1234"))
    assert resp.status_code == 200, resp.text
    assert wait_rows(client, prof_stream, 1)[0]["trace_id"] == "abcd1234"


def test_val44_stringified_integers_coerced(client: OpenObserveClient, prof_stream: str):
    body = _base()
    for sample in _samples(body):
        sample["stackIndex"] = str(sample["stackIndex"])
    profile = body["resourceProfiles"][0]["scopeProfiles"][0]["profiles"][0]
    assert isinstance(profile["timeUnixNano"], str)
    _samples(body)[0]["values"] = ["5"]
    resp = ingest_json(client, prof_stream, body)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {}
    wait_merge_total(client, prof_stream, recent_window(**cpu()), 105)


def test_val45_omitted_defaults(client: OpenObserveClient, prof_stream: str):
    body = _base()
    del body["resourceProfiles"][0]["scopeProfiles"][0]["profiles"][0]["durationNano"]
    assert all("mappingIndex" not in loc for loc in body["dictionary"]["locationTable"])
    resp = ingest_json(client, prof_stream, body)
    assert resp.status_code == 200, resp.text
    rows = wait_rows(client, prof_stream, 2)
    assert {r["duration_nanos"] for r in rows} == {0}
    assert all("profile_duration_nanos" not in r for r in rows)


def test_val46_original_payload_ignored(client: OpenObserveClient, prof_stream: str):
    body = _base()
    profile = body["resourceProfiles"][0]["scopeProfiles"][0]["profiles"][0]
    profile["originalPayloadFormat"] = "pprofext"
    profile["originalPayload"] = base64.b64encode(b"\x1f\x8b raw pprof bytes").decode()
    resp = ingest_json(client, prof_stream, body)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {}
    wait_merge_total(client, prof_stream, recent_window(**cpu()), 400)
