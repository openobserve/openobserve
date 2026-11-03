"""Profiles over OTLP/gRPC: raw-bytes unary call, since the Python proto package lacks the v1development schema."""

from __future__ import annotations

import uuid
from collections.abc import Generator

import grpc
import pytest

from support.client import OpenObserveClient
from support.otlp_grpc import grpc_target, metadata

from .profiles_helpers import (
    GRPC_EXPORT,
    NS,
    PARTIAL_MSG,
    ProfilesBuilder,
    cpu,
    decode_fields,
    now_ns,
    recent_window,
    simple_request,
    to_proto,
    wait_merge_total,
)

A_STACKS = [(["g_leaf", "g_work", "g_main"], 300), (["g_work", "g_main"], 100)]


@pytest.fixture(scope="module")
def export() -> Generator[grpc.UnaryUnaryMultiCallable, None, None]:
    channel = grpc.insecure_channel(grpc_target())
    try:
        yield channel.unary_unary(GRPC_EXPORT)
    finally:
        channel.close()


def _call(export: grpc.UnaryUnaryMultiCallable, body: bytes, md: list[tuple[str, str]]) -> bytes:
    return export(body, metadata=md, timeout=30)


def _rpc_error(export: grpc.UnaryUnaryMultiCallable, body: bytes, md: list[tuple[str, str]]) -> grpc.RpcError:
    with pytest.raises(grpc.RpcError) as info:
        _call(export, body, md)
    return info.value


def test_grpc01_export_happy_path(client: OpenObserveClient, export, prof_stream: str):
    resp = _call(export, to_proto(simple_request(A_STACKS)), metadata(prof_stream))
    assert resp == b"", "a fully accepted export answers an empty ExportProfilesServiceResponse"
    body = wait_merge_total(client, prof_stream, recent_window(**cpu()), 400)
    assert [t["name"] for t in body["top"]] == ["g_leaf", "g_work", "g_main"]


def test_grpc02_missing_organization(export, prof_stream: str):
    md = [kv for kv in metadata(prof_stream) if kv[0] != "organization"]
    err = _rpc_error(export, to_proto(simple_request(A_STACKS)), md)
    assert err.code() == grpc.StatusCode.INVALID_ARGUMENT, err
    assert err.details().startswith("Please specify organization id with header key 'organization'"), err.details()


def test_grpc03_validation_error_is_invalid_argument(export, prof_stream: str):
    model = simple_request(A_STACKS)
    model["dictionary"]["stack_table"][0] = {"location_indices": [1]}
    err = _rpc_error(export, to_proto(model), metadata(prof_stream))
    assert err.code() == grpc.StatusCode.INVALID_ARGUMENT, err
    assert err.details() == "dictionary.stack_table[0] must be the zero value"


def test_grpc04_partial_success(client: OpenObserveClient, export, prof_stream: str):
    b = ProfilesBuilder()
    t = now_ns() - 60 * NS
    bad = b.sample(["bad_leaf"], values=[1, 2], timestamps=[t])
    b.resource([b.profile([bad, b.sample(["good_leaf"], values=[50])], time_ns=t)], {"service.name": "svc-g"})
    resp = _call(export, to_proto(b.model()), metadata(prof_stream))
    partial = decode_fields(decode_fields(resp)[1][0])
    assert partial[1] == [1]
    assert partial[2] == [PARTIAL_MSG.encode()]
    wait_merge_total(client, prof_stream, recent_window(**cpu()), 50)


def test_grpc05_no_stream_name_writes_default(client: OpenObserveClient, export):
    service = f"svc-grpc-noheader-{uuid.uuid4().hex[:8]}"
    md = [kv for kv in metadata("unused") if kv[0] != "stream-name"]
    # `default` is shared and is not deleted: a deleted stream answers 503 "being deleted" to the next run's ingest.
    resp = _call(export, to_proto(simple_request([(["gd_leaf", "gd_main"], 33)], service=service)), md)
    assert resp == b""
    wait_merge_total(client, "default", recent_window(**cpu(service_name=service)), 33)


def test_grpc06_unauthenticated(export, prof_stream: str):
    md = [kv for kv in metadata(prof_stream) if kv[0] != "authorization"]
    err = _rpc_error(export, to_proto(simple_request(A_STACKS)), md)
    assert err.code() == grpc.StatusCode.UNAUTHENTICATED, err
