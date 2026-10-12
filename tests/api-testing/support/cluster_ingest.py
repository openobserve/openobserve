"""Client for the internal `cluster.Ingest` gRPC service.

The service is defined in `src/proto/proto/cluster/ingest.proto` and registered
on the *main* gRPC listener (`src/api/grpc/src/server.rs`) — the same port that
serves OTLP, so it is reachable by anything that can reach the collector
endpoint, not just by other cluster nodes.

Unlike the OTLP tests next door, there is no published Python package carrying
these stubs, and this repo's test venv has no `grpcio-tools`/protoc. Rather than
add a build dependency or commit generated code that can drift from the proto,
the two messages are declared through protobuf's runtime descriptor API below.
They are small and stable, and only the fields the tests exercise are declared:
unknown fields on the wire are ignored by both sides, so a partial declaration
is wire-compatible with the full message.

Deliberately omitted:

- `ingestion_type` (field 5). The handler reads it as
  `req.ingestion_type.unwrap_or_default()`, and proto3 does not put a default
  scalar on the wire, so leaving it out is exactly equivalent to sending `JSON`
  (0) — which is what these tests want.
- `metadata` (field 6). Read for the `is_derived` flag, and for `append_data`
  on the enrichment-table arm. Omitting it is safe for these tests because both
  default to what they want: `is_derived` false, `append_data` true.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass

import grpc
from google.protobuf import descriptor_pb2, descriptor_pool, message_factory

# cluster.Ingest shares the main gRPC listener with OTLP, so it resolves to the same target.
from support.otlp_grpc import grpc_target  # noqa: F401  (re-exported for this module's callers)

INGEST_METHOD = "/cluster.Ingest/Ingest"

_FILE = "openobserve_tests/cluster_ingest.proto"


def _build_messages():
    """Declare the subset of cluster/ingest.proto the tests need, and return the classes."""
    fdp = descriptor_pb2.FileDescriptorProto()
    fdp.name = _FILE
    fdp.package = "cluster"
    fdp.syntax = "proto3"

    data = fdp.message_type.add()
    data.name = "IngestionData"
    f = data.field.add()
    f.name, f.number = "data", 1
    f.type = descriptor_pb2.FieldDescriptorProto.TYPE_BYTES
    f.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL

    req = fdp.message_type.add()
    req.name = "IngestionRequest"
    for name, number in (("org_id", 1), ("stream_type", 2), ("stream_name", 3)):
        f = req.field.add()
        f.name, f.number = name, number
        f.type = descriptor_pb2.FieldDescriptorProto.TYPE_STRING
        f.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    f = req.field.add()
    f.name, f.number = "data", 4
    f.type = descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE
    f.type_name = ".cluster.IngestionData"
    f.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL

    resp = fdp.message_type.add()
    resp.name = "IngestionResponse"
    f = resp.field.add()
    f.name, f.number = "status_code", 1
    f.type = descriptor_pb2.FieldDescriptorProto.TYPE_INT32
    f.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    f = resp.field.add()
    f.name, f.number = "message", 2
    f.type = descriptor_pb2.FieldDescriptorProto.TYPE_STRING
    f.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL

    # A dedicated pool, so re-import cannot collide with anything else's `cluster` package.
    pool = descriptor_pool.DescriptorPool()
    pool.Add(fdp)
    return (
        message_factory.GetMessageClass(pool.FindMessageTypeByName("cluster.IngestionData")),
        message_factory.GetMessageClass(pool.FindMessageTypeByName("cluster.IngestionRequest")),
        message_factory.GetMessageClass(pool.FindMessageTypeByName("cluster.IngestionResponse")),
    )


IngestionData, IngestionRequest, IngestionResponse = _build_messages()


def basic_auth(email: str, password: str) -> str:
    return "Basic " + base64.b64encode(f"{email}:{password}".encode()).decode()


@dataclass
class IngestResult:
    """The outcome of one Ingest call: either a gRPC status, or the body's own status_code."""

    code: grpc.StatusCode
    details: str = ""
    status_code: int | None = None
    message: str = ""

    @property
    def ok(self) -> bool:
        return self.code == grpc.StatusCode.OK


def ingest(
    channel: grpc.Channel,
    *,
    body_org: str,
    stream_name: str,
    rows: bytes,
    authorization: str | None = None,
    header_org: str | None = None,
    stream_type: str = "logs",
    timeout: float = 30.0,
) -> IngestResult:
    """Call `cluster.Ingest/Ingest`, keeping the header org and the body org separate.

    `header_org` becomes the `organization` metadata the auth interceptor
    authenticates against; `body_org` is the `org_id` *inside* the request. The
    whole point of o2-enterprise#2821 is that these two were allowed to differ,
    so the caller must be able to set them independently — including omitting
    the header entirely.
    """
    metadata: list[tuple[str, str]] = []
    if authorization is not None:
        metadata.append(("authorization", authorization))
    if header_org is not None:
        metadata.append(("organization", header_org))

    call = channel.unary_unary(
        INGEST_METHOD,
        request_serializer=IngestionRequest.SerializeToString,
        response_deserializer=IngestionResponse.FromString,
    )
    request = IngestionRequest(
        org_id=body_org,
        stream_type=stream_type,
        stream_name=stream_name,
        data=IngestionData(data=rows),
    )
    try:
        resp = call(request, metadata=metadata, timeout=timeout)
    except grpc.RpcError as e:
        return IngestResult(code=e.code(), details=e.details() or "")
    return IngestResult(
        code=grpc.StatusCode.OK,
        status_code=resp.status_code,
        message=resp.message,
    )
