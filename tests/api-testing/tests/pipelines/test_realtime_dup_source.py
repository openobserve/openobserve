"""Realtime pipeline source-stream uniqueness guard (openobserve#6443).

A second realtime pipeline for a source stream already used by another realtime
pipeline must be rejected with 400 (PipelineError::StreamInUse). Scheduled
pipelines and realtime pipelines on a different source stream are unaffected.

Route: POST /api/{org}/pipelines (save_pipeline).
"""
from __future__ import annotations

import logging
import uuid
from collections.abc import Generator
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name

logger = logging.getLogger(__name__)

ORG_ID = "default"
DUP_SOURCE_ERROR = "A realtime pipeline with same source stream already exists"


def _realtime_pipeline_payload(name: str, stream_name: str) -> dict[str, Any]:
    """Realtime pipeline: input stream_name -> output stream_name_out."""
    input_id = str(uuid.uuid4())
    output_id = str(uuid.uuid4())
    return {
        "name": name,
        "description": "",
        "source": {"source_type": "realtime"},
        "nodes": [
            {
                "id": input_id,
                "type": "input",
                "data": {
                    "node_type": "stream",
                    "stream_name": stream_name,
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
                    "stream_name": f"{stream_name}_out",
                    "stream_type": "logs",
                    "org_id": ORG_ID,
                },
                "position": {"x": 300, "y": 100},
                "io_type": "output",
            },
        ],
        "edges": [
            {"id": f"e-{input_id}-{output_id}", "source": input_id, "target": output_id},
        ],
        "org": ORG_ID,
    }


def _scheduled_pipeline_payload(name: str, source_stream: str, out_stream: str) -> dict[str, Any]:
    """Scheduled pipeline: SQL query over source_stream -> output out_stream."""
    input_id = str(uuid.uuid4())
    output_id = str(uuid.uuid4())
    return {
        "name": name,
        "description": "",
        "source": {"source_type": "scheduled"},
        "nodes": [
            {
                "id": input_id,
                "type": "input",
                "data": {
                    "label": input_id,
                    "node_type": "query",
                    "stream_type": "logs",
                    "org_id": ORG_ID,
                    "query_condition": {
                        "type": "sql",
                        "conditions": None,
                        "sql": f"select * from {source_stream}",
                        "promql": None,
                        "promql_condition": None,
                        "aggregation": None,
                        "vrl_function": None,
                        "search_event_type": "DerivedStream",
                    },
                    "trigger_condition": {
                        "period": 15, "operator": "=", "threshold": 0,
                        "frequency": 15, "cron": "", "frequency_type": "minutes",
                        "silence": 0,
                    },
                },
                "position": {"x": 212, "y": 93},
                "io_type": "input",
            },
            {
                "id": output_id,
                "type": "output",
                "data": {
                    "label": output_id,
                    "node_type": "stream",
                    "stream_type": "logs",
                    "stream_name": out_stream,
                    "org_id": ORG_ID,
                },
                "position": {"x": 269, "y": 162},
                "io_type": "output",
            },
        ],
        "edges": [
            {"id": f"e-{input_id}-{output_id}", "source": input_id, "target": output_id},
        ],
        "org": ORG_ID,
        "schedule": {"enabled": False, "frequency": "daily", "time": "02:00"},
    }


def _delete_pipeline_by_name(client: OpenObserveClient, name: str) -> None:
    for p in client.get("pipelines").json().get("list", []):
        if p["name"] == name:
            client.delete(f"pipelines/{p['pipeline_id']}")
            return


@pytest.fixture
def realtime_source(client: OpenObserveClient) -> Generator[dict[str, str], None, None]:
    """Fresh source stream + one realtime pipeline on it; cleans up both."""
    source_stream = unique_name("rt_src")
    client.post(f"{source_stream}/_json", json=[{"a": "1", "b": "2"}])

    pipe_name = unique_name("pyt_rt_dup_first")
    resp = client.post("pipelines", json=_realtime_pipeline_payload(pipe_name, source_stream))
    assert resp.status_code == 200, f"first realtime pipeline create failed: {resp.status_code} {resp.text}"

    created = [pipe_name]
    yield {"source_stream": source_stream, "pipe_name": pipe_name, "created": created}

    for name in created:
        try:
            _delete_pipeline_by_name(client, name)
        except Exception as e:
            logger.warning("pipeline cleanup failed for %s: %s", name, e)
    try:
        client.delete(f"streams/{source_stream}?type=logs")
    except Exception as e:
        logger.warning("source stream cleanup failed for %s: %s", source_stream, e)


def test_second_realtime_pipeline_same_source_rejected_400(
    client: OpenObserveClient, realtime_source: dict[str, str]
):
    """A 2nd realtime pipeline on the same source stream returns 400 StreamInUse."""
    source_stream = realtime_source["source_stream"]
    dup_name = unique_name("pyt_rt_dup_second")
    realtime_source["created"].append(dup_name)

    resp = client.post("pipelines", json=_realtime_pipeline_payload(dup_name, source_stream))
    assert resp.status_code == 400, (
        f"Expected 400 for duplicate realtime source, got {resp.status_code}: {resp.text}"
    )
    assert DUP_SOURCE_ERROR in resp.text, f"Missing StreamInUse message: {resp.text}"


def test_scheduled_pipeline_same_source_allowed(
    client: OpenObserveClient, realtime_source: dict[str, str]
):
    """Control: a scheduled pipeline over the same source stream is allowed (200)."""
    source_stream = realtime_source["source_stream"]
    sch_name = unique_name("pyt_rt_dup_sched")
    realtime_source["created"].append(sch_name)

    payload = _scheduled_pipeline_payload(sch_name, source_stream, unique_name("rt_sched_out"))
    resp = client.post("pipelines", json=payload)
    assert resp.status_code == 200, (
        f"scheduled pipeline on same source should be allowed, got {resp.status_code}: {resp.text}"
    )


def test_realtime_pipeline_fresh_source_allowed(client: OpenObserveClient):
    """Control: a realtime pipeline on a fresh source stream is allowed (200)."""
    source_stream = unique_name("rt_src2")
    client.post(f"{source_stream}/_json", json=[{"a": "1", "b": "2"}])
    pipe_name = unique_name("pyt_rt_fresh")

    try:
        resp = client.post("pipelines", json=_realtime_pipeline_payload(pipe_name, source_stream))
        assert resp.status_code == 200, (
            f"realtime pipeline on fresh source should be allowed, got {resp.status_code}: {resp.text}"
        )
    finally:
        _delete_pipeline_by_name(client, pipe_name)
        try:
            client.delete(f"streams/{source_stream}?type=logs")
        except Exception as e:
            logger.warning("fresh source stream cleanup failed for %s: %s", source_stream, e)
