"""Pipeline condition nodes evaluate the list, prefix and regex operators the shared filter builder offers (#15871)."""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name
from support.wait import wait_until
from tests.pipelines.test_pipeline_regression import _delete_pipeline_by_name, _find_pipeline

logger = logging.getLogger(__name__)

RECORDS = [
    {"level": "error", "msg": "net down"},
    {"level": "WARN", "msg": "Disk full"},
    {"level": "info", "msg": "disk ok"},
    {"level": "debug", "msg": "network back"},
]


def _condition_payload(name: str, source: str, destination: str, condition: dict[str, Any]) -> dict[str, Any]:
    ids = [str(uuid.uuid4()) for _ in range(3)]
    stream = {"node_type": "stream", "stream_type": "logs", "org_id": "default"}
    return {
        "name": name,
        "description": "",
        "source": {"source_type": "realtime"},
        "nodes": [
            {
                "id": ids[0],
                "type": "input",
                "io_type": "input",
                "position": {"x": 0, "y": 0},
                "data": {**stream, "stream_name": source},
            },
            {
                "id": ids[1],
                "type": "condition",
                "io_type": "condition",
                "position": {"x": 200, "y": 0},
                "data": {"node_type": "condition", "conditions": condition},
            },
            {
                "id": ids[2],
                "type": "output",
                "io_type": "output",
                "position": {"x": 400, "y": 0},
                "data": {**stream, "stream_name": destination},
            },
        ],
        "edges": [
            {"id": f"e-{ids[0]}-{ids[1]}", "source": ids[0], "target": ids[1]},
            {"id": f"e-{ids[1]}-{ids[2]}", "source": ids[1], "target": ids[2]},
        ],
        "org": "default",
    }


def _messages(client: OpenObserveClient, stream: str) -> list[str]:
    now = int(time.time())
    resp = client.post(
        "_search?type=logs&use_cache=false",
        json={
            "query": {
                "sql": f'SELECT msg FROM "{stream}"',
                "start_time": (now - 600) * 1_000_000,
                "end_time": (now + 60) * 1_000_000,
                "size": 100,
            }
        },
    )
    if resp.status_code != 200:
        return []
    return sorted(hit["msg"] for hit in resp.json().get("hits", []))


@pytest.mark.parametrize(
    ("condition", "kept"),
    [
        pytest.param({"column": "level", "operator": "in", "value": ["error", "warn"]}, ["net down"], id="in"),
        pytest.param(
            {"column": "level", "operator": "in", "value": ["error", "warn"], "case_insensitive": True},
            ["Disk full", "net down"],
            id="in-case-insensitive",
        ),
        pytest.param(
            {"column": "level", "operator": "not_in", "value": ["error", "WARN"]},
            ["disk ok", "network back"],
            id="not_in",
        ),
        pytest.param(
            {"column": "msg", "operator": "starts_with", "value": "net"}, ["net down", "network back"], id="starts_with"
        ),
        pytest.param(
            {"column": "msg", "operator": "re_match", "value": "^[Dd]isk (full|ok)$"},
            ["Disk full", "disk ok"],
            id="re_match",
        ),
    ],
)
def test_condition_node_routes_only_matching_records(
    client: OpenObserveClient, condition: dict[str, Any], kept: list[str]
):
    """openobserve#15871: these operators did not exist, so a pipeline using them could not even be saved."""
    name = unique_name("pyt_15871")
    source = unique_name("pyt_15871_src").lower()
    destination = f"{source}_out"
    try:
        resp = client.post(f"{source}/_json", json=[{"level": "seed", "msg": "seed"}])
        assert resp.status_code == 200, f"seed ingest failed: {resp.status_code} {resp.text}"
        resp = client.post("pipelines", json=_condition_payload(name, source, destination, condition))
        assert resp.status_code == 200, f"create failed: {resp.status_code} {resp.text}"
        assert _find_pipeline(client, name), f"{name} is not listed after create"

        resp = client.post(f"{source}/_json", json=RECORDS)
        assert resp.status_code == 200, f"ingest failed: {resp.status_code} {resp.text}"
        # one ingest request is routed as one batch, so the first non-empty read is the whole result
        got = wait_until(lambda: _messages(client, destination) or None, timeout=45, msg=f"{destination} got nothing")
        assert got == kept, f"{condition}: routed {got}, expected {kept}"
    finally:
        _delete_pipeline_by_name(client, name)
        for stream in (source, destination):
            try:
                client.delete(f"streams/{stream}?type=logs")
            except Exception as e:
                logger.warning("stream cleanup failed for %s: %s", stream, e)


def test_save_refuses_a_regex_that_does_not_compile(client: OpenObserveClient):
    """openobserve#15871: an invalid pattern must fail at save, not drop every record at ingest."""
    name = unique_name("pyt_15871_bad")
    source = unique_name("pyt_15871_bad_src").lower()
    try:
        condition = {"column": "msg", "operator": "re_match", "value": "disk (full"}
        resp = client.post("pipelines", json=_condition_payload(name, source, f"{source}_out", condition))
        assert resp.status_code == 400, f"an invalid regex must be refused: {resp.status_code} {resp.text}"
        message = resp.json().get("message", "")
        assert "invalid regex" in message, f"the error must say the regex is invalid: {message}"
        assert "'msg'" in message, f"the error must name the condition's column: {message}"
    finally:
        _delete_pipeline_by_name(client, name)
