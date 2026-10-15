"""OTLP/gRPC exports report rejected records through partial_success instead of a bare OK (#14640)."""
from __future__ import annotations

import time
import uuid

import grpc
import pytest

from support.otlp_grpc import STALE_OFFSET_NANOS, export_logs, export_spans, grpc_target, now_nanos
from support.wait import wait_until


@pytest.fixture(scope="module")
def channel():
    ch = grpc.insecure_channel(grpc_target())
    grpc.channel_ready_future(ch).result(timeout=30)
    yield ch
    ch.close()


def _stored_rows(client, stream: str, stream_type: str) -> int:
    end = int(time.time() * 1_000_000)
    resp = client.post(
        f"_search?type={stream_type}",
        json={"query": {"sql": f'SELECT count(*) AS c FROM "{stream}"', "start_time": end - 3_600_000_000, "end_time": end + 60_000_000}},
    )
    if resp.status_code != 200:
        return 0
    hits = resp.json().get("hits", [])
    return hits[0]["c"] if hits else 0


@pytest.mark.parametrize(
    ("export", "stream_type"),
    [(export_logs, "logs"), (export_spans, "traces")],
    ids=["logs", "traces"],
)
def test_stale_record_is_reported_as_partial_success(client, channel, export, stream_type):
    """One current and one 60-day-old record: OK, the stale one reported rejected, the current one stored."""
    stream = f"grpc_ps_{uuid.uuid4().hex[:10]}"
    now = now_nanos()

    result = export(channel, stream, [now, now - STALE_OFFSET_NANOS])

    assert result.code == grpc.StatusCode.OK, result
    assert result.has_partial_success, "Bug #14640: gRPC reply dropped partial_success for a rejected record"
    assert result.rejected == 1, result
    assert result.error_message, result
    wait_until(lambda: _stored_rows(client, stream, stream_type) == 1, timeout=60, interval=2, msg=f"current record in {stream}")


@pytest.mark.parametrize("export", [export_logs, export_spans], ids=["logs", "traces"])
def test_fully_accepted_batch_has_no_rejections(channel, export):
    """A batch of current records must not report any rejection."""
    result = export(channel, f"grpc_ok_{uuid.uuid4().hex[:10]}", [now_nanos()])

    assert result.code == grpc.StatusCode.OK, result
    assert result.rejected == 0, result
