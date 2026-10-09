"""Regression tests for closed pipeline bugs that had no automated coverage.

Covers #7077 (caller-supplied pipeline id), #6755 (destination stream name
length), #6579 (a pipeline outliving its source stream), #7144 (a deleted
realtime pipeline that kept routing until the ingester restarted) and #14972
(a scheduled pipeline skipping records stamped on a window boundary).
"""
from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Generator
from typing import Any

import pytest
import requests

from support.client import OpenObserveClient
from support.factories import unique_name

logger = logging.getLogger(__name__)

ORG_ID = "default"

# The backend refused destination stream names past 83 characters (#6755).
LEGACY_STREAM_NAME_LIMIT = 83


def _realtime_payload(
    name: str,
    source_stream: str,
    destination_stream: str,
    pipeline_id: str | None = None,
) -> dict[str, Any]:
    """Realtime pipeline: source stream -> destination stream."""
    input_id = str(uuid.uuid4())
    output_id = str(uuid.uuid4())
    payload: dict[str, Any] = {
        "name": name,
        "description": "",
        "source": {"source_type": "realtime"},
        "nodes": [
            {
                "id": input_id,
                "type": "input",
                "data": {
                    "node_type": "stream",
                    "stream_name": source_stream,
                    "stream_type": "logs",
                    "org_id": ORG_ID,
                },
                "position": {"x": 100, "y": 100},
                "io_type": "input",
            },
            {
                "id": output_id,
                "type": "output",
                "data": {
                    "node_type": "stream",
                    "stream_name": destination_stream,
                    "stream_type": "logs",
                    "org_id": ORG_ID,
                },
                "position": {"x": 300, "y": 100},
                "io_type": "output",
            },
        ],
        "edges": [{"id": f"e-{input_id}-{output_id}", "source": input_id, "target": output_id}],
        "org": ORG_ID,
    }
    if pipeline_id is not None:
        payload["pipeline_id"] = pipeline_id
        payload["id"] = pipeline_id
    return payload


def _find_pipeline(client: OpenObserveClient, name: str) -> dict[str, Any] | None:
    """Look a pipeline up by name; the API lowercases names on save."""
    pipelines = client.get("pipelines").json().get("list", [])
    return next((p for p in pipelines if p["name"] == name.lower()), None)


def _delete_pipeline_by_name(client: OpenObserveClient, name: str) -> None:
    pipeline = _find_pipeline(client, name)
    if pipeline is not None:
        client.delete(f"pipelines/{pipeline['pipeline_id']}")


@pytest.fixture
def seeded_stream(client: OpenObserveClient) -> Generator[str, None, None]:
    """Ingest one record so the stream exists, and drop it afterwards."""
    stream = unique_name("pyt_pipe_src").lower()
    resp = client.post(f"{stream}/_json", json=[{"level": "info", "msg": "seed"}])
    assert resp.status_code == 200, f"seed ingest failed: {resp.status_code} {resp.text}"

    yield stream

    try:
        client.delete(f"streams/{stream}?type=logs")
    except Exception as e:
        logger.warning("seeded_stream cleanup failed: %s", e)


# ----- #7077: caller-supplied pipeline id -----


def test_create_ignores_caller_supplied_id_without_overwrite(client: OpenObserveClient):
    """Without ?overwrite, the server mints the id so a re-import cannot collide."""
    name = unique_name("pyt_7077_noovr")
    requested_id = uuid.uuid4().hex[:20]

    try:
        resp = client.post("pipelines", json=_realtime_payload(name, "stream_pytest_data", f"{name}_out", requested_id))
        assert resp.status_code == 200, f"create failed: {resp.status_code} {resp.text}"

        pipeline = _find_pipeline(client, name)
        assert pipeline is not None, f"created pipeline {name} not in list"
        assert pipeline["pipeline_id"] != requested_id, (
            f"server must mint its own id without overwrite, got the caller's {requested_id}"
        )
    finally:
        _delete_pipeline_by_name(client, name)


def test_create_honours_caller_supplied_id_with_overwrite(client: OpenObserveClient):
    """?overwrite=true keeps the caller's id, so an import stays addressable for delete."""
    name = unique_name("pyt_7077_ovr")
    requested_id = uuid.uuid4().hex[:20]

    try:
        resp = client.post(
            "pipelines?overwrite=true",
            json=_realtime_payload(name, "stream_pytest_data", f"{name}_out", requested_id),
        )
        assert resp.status_code == 200, f"create failed: {resp.status_code} {resp.text}"

        pipeline = _find_pipeline(client, name)
        assert pipeline is not None, f"created pipeline {name} not in list"
        assert pipeline["pipeline_id"] == requested_id, (
            f"overwrite must keep the caller's id {requested_id}, got {pipeline['pipeline_id']}"
        )

        delete = client.delete(f"pipelines/{requested_id}")
        assert delete.status_code == 200, f"delete by the supplied id failed: {delete.status_code} {delete.text}"
    finally:
        _delete_pipeline_by_name(client, name)


# ----- #6755: destination stream name length -----


@pytest.mark.parametrize("name_length", [LEGACY_STREAM_NAME_LIMIT, LEGACY_STREAM_NAME_LIMIT + 1, 200])
def test_destination_stream_name_has_no_length_limit(client: OpenObserveClient, name_length: int):
    """Destination names past the old 83-character ceiling must still save."""
    name = unique_name(f"pyt_6755_{name_length}")
    destination = "d" + ("x" * (name_length - 1))

    try:
        resp = client.post("pipelines", json=_realtime_payload(name, "stream_pytest_data", destination))
        assert resp.status_code == 200, (
            f"destination name of {name_length} chars was rejected: {resp.status_code} {resp.text}"
        )

        pipeline = _find_pipeline(client, name)
        assert pipeline is not None, f"pipeline with a {name_length}-char destination not in list"
    finally:
        _delete_pipeline_by_name(client, name)


# ----- #6579: a pipeline outlives its source stream -----


def test_pipeline_survives_deletion_of_its_source_stream(client: OpenObserveClient, seeded_stream: str):
    """Deleting a stream must not take its pipeline with it — that silently dropped retention."""
    name = unique_name("pyt_6579")

    try:
        resp = client.post("pipelines", json=_realtime_payload(name, seeded_stream, f"{seeded_stream}_out"))
        assert resp.status_code == 200, f"create failed: {resp.status_code} {resp.text}"
        assert _find_pipeline(client, name) is not None, "pipeline missing before the stream was deleted"

        deleted = client.delete(f"streams/{seeded_stream}?type=logs")
        assert deleted.status_code == 200, f"stream delete failed: {deleted.status_code} {deleted.text}"

        # The delete cascaded asynchronously, so a single immediate read could pass on a broken build.
        for _ in range(10):
            time.sleep(1)
            if _find_pipeline(client, name) is None:
                pytest.fail(f"pipeline {name} was removed when its source stream {seeded_stream} was deleted")
    finally:
        _delete_pipeline_by_name(client, name)


# ----- #7144: a deleted realtime pipeline stops routing -----


def _count_records(client: OpenObserveClient, stream: str) -> int:
    """Rows currently visible in a stream; a missing stream reads as empty."""
    now = int(time.time())
    resp = client.post(
        "_search?type=logs",
        json={
            "query": {
                "sql": f'SELECT count(*) as c FROM "{stream}"',
                "start_time": (now - 3600) * 1_000_000,
                "end_time": (now + 60) * 1_000_000,
                "size": 1,
            }
        },
    )
    if resp.status_code != 200:
        return 0
    hits = resp.json().get("hits", [])
    return int(hits[0].get("c", 0)) if hits else 0


def _ingest(client: OpenObserveClient, stream: str, marker: str, count: int = 5) -> None:
    """Ingest one record at a time, retrying the keep-alive drops this loop provokes."""
    for i in range(count):
        for attempt in range(3):
            try:
                client.post(f"{stream}/_json", json=[{"m": f"{marker}-{i}"}])
                break
            except requests.RequestException as e:
                if attempt == 2:
                    raise
                logger.warning("ingest retry %s for %s: %s", attempt + 1, stream, e)
                time.sleep(1)


def test_deleted_realtime_pipeline_stops_routing(client: OpenObserveClient, seeded_stream: str):
    """A deleted pipeline used to keep routing until the ingester was restarted."""
    name = unique_name("pyt_7144")
    destination = f"{seeded_stream}_out"

    try:
        resp = client.post("pipelines", json=_realtime_payload(name, seeded_stream, destination))
        assert resp.status_code == 200, f"create failed: {resp.status_code} {resp.text}"

        pipeline = _find_pipeline(client, name)
        assert pipeline is not None, f"created pipeline {name} not in list"
        if not pipeline.get("enabled"):
            client.put(f"pipelines/{pipeline['pipeline_id']}/enable?value=true")

        time.sleep(8)
        _ingest(client, seeded_stream, "routed")

        # Prove routing actually happens first, or the post-delete assertion proves nothing.
        routed = 0
        for _ in range(12):
            time.sleep(2)
            routed = _count_records(client, destination)
            if routed > 0:
                break
        assert routed > 0, f"pipeline never routed into {destination}; cannot test the delete"

        delete = client.delete(f"pipelines/{pipeline['pipeline_id']}")
        assert delete.status_code == 200, f"delete failed: {delete.status_code} {delete.text}"

        time.sleep(8)
        _ingest(client, seeded_stream, "after-delete")
        time.sleep(15)

        after = _count_records(client, destination)
        assert after == routed, (
            f"deleted pipeline still routed into {destination}: {routed} rows before, {after} after"
        )
    finally:
        _delete_pipeline_by_name(client, name)
        try:
            client.delete(f"streams/{destination}?type=logs")
        except Exception as e:
            logger.warning("destination stream cleanup failed: %s", e)


# ----- #14972: a scheduled pipeline reads records stamped on a window boundary -----


def _scheduled_payload(name: str, source_stream: str, destination_stream: str) -> dict[str, Any]:
    """Scheduled pipeline copying each 1-minute window of source_stream to destination_stream."""
    query_id = str(uuid.uuid4())
    output_id = str(uuid.uuid4())
    return {
        "name": name,
        "description": "",
        "source": {"source_type": "scheduled"},
        "nodes": [
            {
                "id": query_id,
                "type": "input",
                "data": {
                    "node_type": "query",
                    "stream_type": "logs",
                    "org_id": ORG_ID,
                    "query_condition": {
                        "type": "sql",
                        "conditions": None,
                        "sql": f'SELECT * FROM "{source_stream}"',
                        "promql": None,
                        "promql_condition": None,
                        "aggregation": None,
                        "vrl_function": None,
                        "search_event_type": "DerivedStream",
                    },
                    "trigger_condition": {
                        "period": 1,
                        "operator": "=",
                        "threshold": 0,
                        "frequency": 1,
                        "cron": "",
                        "frequency_type": "minutes",
                        "silence": 0,
                    },
                },
                "position": {"x": 100, "y": 100},
                "io_type": "input",
            },
            {
                "id": output_id,
                "type": "output",
                "data": {
                    "node_type": "stream",
                    "stream_name": destination_stream,
                    "stream_type": "logs",
                    "org_id": ORG_ID,
                },
                "position": {"x": 300, "y": 100},
                "io_type": "output",
            },
        ],
        "edges": [{"id": f"e-{query_id}-{output_id}", "source": query_id, "target": output_id}],
        "org": ORG_ID,
    }


def _rows(client: OpenObserveClient, stream: str, start: int, end: int) -> list[tuple[int, str]]:
    """(_timestamp, kind) of every row in [start, end), repeats kept; a missing stream reads as empty."""
    resp = client.post(
        "_search?type=logs&use_cache=false",
        json={
            "query": {
                "sql": f'SELECT _timestamp, kind FROM "{stream}"',
                "start_time": start,
                "end_time": end,
                "size": 100,
            }
        },
    )
    if resp.status_code != 200:
        return []
    return [(h["_timestamp"], h["kind"]) for h in resp.json().get("hits", [])]


def test_scheduled_pipeline_reads_a_record_on_a_window_boundary(client: OpenObserveClient):
    """A record stamped exactly where one run's window ends and the next begins used to be read by neither."""
    name = unique_name("pyt_14972")
    source = unique_name("pyt_14972_src").lower()
    destination = f"{source}_out"
    minute = 60_000_000

    try:
        # Saving a scheduled pipeline test-runs its query, which fails until the source stream exists.
        seed = {"_timestamp": (int(time.time()) - 600) * 1_000_000, "kind": "seed"}
        resp = client.post(f"{source}/_json", json=[seed])
        assert resp.status_code == 200, f"ingest failed: {resp.status_code} {resp.text}"
        resp = client.post("pipelines", json=_scheduled_payload(name, source, destination))
        assert resp.status_code == 200, f"create failed: {resp.status_code} {resp.text}"

        # Taken after the create returns, so the first run's window ends on this minute or earlier.
        boundary = int(time.time()) // 60 * minute
        mid = (boundary + 30_000_000, "mid")
        expected = [(boundary, "boundary"), mid]
        resp = client.post(f"{source}/_json", json=[{"_timestamp": ts, "kind": kind} for ts, kind in expected])
        assert resp.status_code == 200, f"ingest failed: {resp.status_code} {resp.text}"

        # Once the :30 record arrives, every run that could read the boundary record has run.
        got: list[tuple[int, str]] = []
        deadline = time.time() + 5 * 60
        while time.time() < deadline and mid not in got:
            time.sleep(5)
            got = _rows(client, destination, boundary - minute, boundary + 2 * minute)
        assert mid in got, f"the pipeline never delivered the :30 record into {destination}: {got}"

        missing = [row for row in expected if row not in got]
        assert not missing, f"records never reached {destination}: {missing}"
        assert len(got) == len(set(got)), f"records reached {destination} more than once: {sorted(got)}"
    finally:
        _delete_pipeline_by_name(client, name)
        for stream in (source, destination):
            try:
                client.delete(f"streams/{stream}?type=logs")
            except Exception as e:
                logger.warning("stream cleanup failed for %s: %s", stream, e)
