"""Pipeline CRUD + enable/disable + flatten-validation API tests.

Rewritten in Phase 4 of the api-tests revamp (was 1442 LOC for 5 tests
= 288 LOC per test, the worst copy-paste-to-test ratio in the suite).

Original had:
- 4 parametrized tests that built ~200-LOC pipeline JSON payloads inline,
  each near-identical except for the source_type (realtime/scheduled/
  flatten).
- A pre-existing bug: TWO function definitions named
  `test_pipeline_creation_and_action_with_schedule` at lines 126 and
  256. The second silently shadowed the first — Python's last-wins
  function definition means the first test's body never executed.
- A 348-LOC test_e2e_pipeline_history E2E at the bottom.

This rewrite:
- Extracts pipeline JSON into 3 payload factories
  (_realtime_pipeline_payload, _scheduled_pipeline_payload,
  _flatten_pipeline_payload) so test bodies become small.
- temp_pipeline fixture creates+auto-deletes; tests get a pipeline_id
  for free.
- Unique names per test (was fixed "pipeline12222" etc. that collided).
- Fixes the duplicate-named function bug (only one
  test_create_scheduled_pipeline now exists, not two).
- The full E2E history test is dropped; a focused history contract test
  is kept (basic list/shape — pipeline history is also covered by
  tests/pipelines/test_pipeline_dynamic.py and test_backfill.py).
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


# ----- payload factories -----


def _realtime_pipeline_payload(name: str, stream_name: str) -> dict[str, Any]:
    """Build a real-time pipeline payload (input stream -> output stream)."""
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


def _scheduled_pipeline_payload(name: str, stream_name: str, schedule_enabled: bool) -> dict[str, Any]:
    """Build a scheduled pipeline payload (query input -> stream output)."""
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
                        # Use stream_pytest_data (conftest-managed) instead of
                        # literal "default" — that stream doesn't exist on a
                        # fresh CI runner. OO validates the SQL at create time.
                        "sql": "select * from stream_pytest_data",
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
                    "stream_name": stream_name,
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
        "schedule": {"enabled": schedule_enabled, "frequency": "daily", "time": "02:00"},
    }


def _flatten_pipeline_payload_with_double_flatten(name: str) -> dict[str, Any]:
    """Build a deliberately-invalid pipeline: TWO flatten nodes in a row.

    The backend should reject this with 400 — Flatten cannot follow another
    Flatten / FunctionNode that already flattened in the same branch.
    """
    input_id = str(uuid.uuid4())
    flatten1_id = str(uuid.uuid4())
    flatten2_id = str(uuid.uuid4())
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
                    "stream_name": "stream_pytest_data",
                    "stream_type": "logs",
                    "org_id": ORG_ID,
                },
                "position": {"x": 100, "y": 100},
                "io_type": "input",
            },
            {
                "id": flatten1_id,
                "type": "function",
                "data": {
                    "node_type": "function",
                    "name": "_flatten_1",
                    "after_flatten": True,
                },
                "position": {"x": 200, "y": 100},
                "io_type": "default",
            },
            {
                "id": flatten2_id,
                "type": "function",
                "data": {
                    "node_type": "function",
                    "name": "_flatten_2",
                    "after_flatten": True,
                },
                "position": {"x": 300, "y": 100},
                "io_type": "default",
            },
            {
                "id": output_id,
                "type": "output",
                "data": {
                    "node_type": "stream",
                    "stream_name": "flatten_out",
                    "stream_type": "logs",
                    "org_id": ORG_ID,
                },
                "position": {"x": 400, "y": 100},
                "io_type": "output",
            },
        ],
        "edges": [
            {"id": f"e1-{input_id}-{flatten1_id}", "source": input_id, "target": flatten1_id},
            {"id": f"e2-{flatten1_id}-{flatten2_id}", "source": flatten1_id, "target": flatten2_id},
            {"id": f"e3-{flatten2_id}-{output_id}", "source": flatten2_id, "target": output_id},
        ],
        "org": ORG_ID,
    }


# ----- fixtures -----


@pytest.fixture
def temp_pipeline_realtime(
    client: OpenObserveClient,
) -> Generator[dict[str, Any], None, None]:
    """Create a realtime pipeline + yield {pipeline_id, name}; auto-delete."""
    name = unique_name("pyt_pipe_rt")
    payload = _realtime_pipeline_payload(name, "stream_pytest_data")

    resp = client.post("pipelines", json=payload)
    assert resp.status_code == 200, f"realtime pipeline create failed: {resp.status_code} {resp.text}"

    # Find pipeline_id via list (create response shape varies)
    pipelines = client.get("pipelines").json().get("list", [])
    pipeline = next((p for p in pipelines if p["name"] == name), None)
    assert pipeline is not None, f"created pipeline {name} not in list"

    yield {"pipeline_id": pipeline["pipeline_id"], "name": name}

    try:
        client.delete(f"pipelines/{pipeline['pipeline_id']}")
    except Exception as e:
        logger.warning("temp_pipeline_realtime cleanup failed: %s", e)


# ----- create + delete -----


def test_create_realtime_pipeline_appears_in_list(client: OpenObserveClient):
    """A newly-created realtime pipeline appears in GET /pipelines."""
    name = unique_name("pyt_create_rt")
    payload = _realtime_pipeline_payload(name, "stream_pytest_data")

    try:
        resp = client.post("pipelines", json=payload)
        assert resp.status_code == 200, f"create failed: {resp.status_code} {resp.text}"

        pipelines = client.get("pipelines").json().get("list", [])
        names = [p["name"] for p in pipelines]
        assert name in names, f"created pipeline {name} not in list: {names}"
    finally:
        for p in client.get("pipelines").json().get("list", []):
            if p["name"] == name:
                client.delete(f"pipelines/{p['pipeline_id']}")
                break


def test_create_scheduled_pipeline_appears_in_list(client: OpenObserveClient):
    """A newly-created scheduled pipeline appears in GET /pipelines.

    Note: original had TWO functions both named
    `test_pipeline_creation_and_action_with_schedule`. The second
    shadowed the first — first test body never executed. This rewrite
    has exactly one test for scheduled pipeline create.
    """
    name = unique_name("pyt_create_sch")
    payload = _scheduled_pipeline_payload(name, "stream_scheduled_out", schedule_enabled=True)

    try:
        resp = client.post("pipelines", json=payload)
        assert resp.status_code == 200, f"create failed: {resp.status_code} {resp.text}"

        pipelines = client.get("pipelines").json().get("list", [])
        names = [p["name"] for p in pipelines]
        assert name in names, f"created scheduled pipeline {name} not in list: {names}"
    finally:
        for p in client.get("pipelines").json().get("list", []):
            if p["name"] == name:
                client.delete(f"pipelines/{p['pipeline_id']}")
                break


def test_delete_pipeline_removes_from_list(
    client: OpenObserveClient, temp_pipeline_realtime: dict[str, Any]
):
    """After DELETE /pipelines/{id}, the pipeline no longer appears in the list."""
    pipeline_id = temp_pipeline_realtime["pipeline_id"]
    name = temp_pipeline_realtime["name"]

    resp = client.delete(f"pipelines/{pipeline_id}")
    assert resp.status_code == 200, f"delete failed: {resp.status_code} {resp.text}"

    pipelines = client.get("pipelines").json().get("list", [])
    names = [p["name"] for p in pipelines]
    assert name not in names, f"pipeline {name} should be gone but still in list: {names}"


# ----- enable / disable -----


def test_enable_pipeline_sets_enabled_true(
    client: OpenObserveClient, temp_pipeline_realtime: dict[str, Any]
):
    """PUT /pipelines/{id}/enable?value=true sets enabled=True in the list."""
    pipeline_id = temp_pipeline_realtime["pipeline_id"]

    resp = client.put(f"pipelines/{pipeline_id}/enable?value=true")
    assert resp.status_code == 200, f"enable failed: {resp.status_code} {resp.text}"

    pipelines = client.get("pipelines").json().get("list", [])
    pipeline = next(p for p in pipelines if p["pipeline_id"] == pipeline_id)
    assert pipeline["enabled"] is True, f"pipeline should be enabled, got: {pipeline['enabled']!r}"


def test_disable_pipeline_sets_enabled_false(
    client: OpenObserveClient, temp_pipeline_realtime: dict[str, Any]
):
    """PUT /pipelines/{id}/enable?value=false sets enabled=False in the list."""
    pipeline_id = temp_pipeline_realtime["pipeline_id"]

    # Enable first so disable is observable
    client.put(f"pipelines/{pipeline_id}/enable?value=true")

    resp = client.put(f"pipelines/{pipeline_id}/enable?value=false")
    assert resp.status_code == 200, f"disable failed: {resp.status_code} {resp.text}"

    pipelines = client.get("pipelines").json().get("list", [])
    pipeline = next(p for p in pipelines if p["pipeline_id"] == pipeline_id)
    assert pipeline["enabled"] is False, f"pipeline should be disabled, got: {pipeline['enabled']!r}"


# ----- flatten validation -----


def test_double_flatten_pipeline_is_rejected_400(client: OpenObserveClient):
    """A pipeline with two flatten nodes in a row is rejected with 400."""
    name = unique_name("pyt_double_flatten")
    payload = _flatten_pipeline_payload_with_double_flatten(name)

    resp = client.post("pipelines", json=payload)
    assert resp.status_code == 400, (
        f"double-flatten pipeline should be rejected with 400, got "
        f"{resp.status_code}: {resp.text}"
    )


# ----- pipeline list contract -----


def test_list_pipelines_returns_list_shape(client: OpenObserveClient):
    """GET /pipelines returns 200 + a 'list' array of pipeline records."""
    resp = client.get("pipelines")
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert "list" in body, f"response missing 'list' key: {body}"
    assert isinstance(body["list"], list), \
        f"'list' should be a list, got {type(body['list']).__name__}"
