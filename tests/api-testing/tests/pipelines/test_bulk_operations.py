"""Bulk pipeline / function endpoints — delete, enable, and their org scope.

Three routes had no server-side test of any kind before this file:

    DELETE /api/{org}/pipelines/bulk
    POST   /api/{org}/pipelines/bulk/enable
    DELETE /api/{org}/functions/bulk

The UI side of all three is covered only by `PipelinesList.spec.ts`, which
mocks `pipelineService`, so nothing exercised the real handlers. The fourth
bulk route in the same crate, `DELETE /api/{org}/re_patterns/bulk`, is
enterprise-gated and is covered in the enterprise suite.

Why the org-scope cases are here and not folded into a happy path: #15361
fixed a cross-org bulk delete in the sibling `re_patterns` handler — it
took ids straight from the body and deleted by id with no org check, so any
org could delete another org's patterns by id. It shipped with no test. The
pipelines and functions handlers are correctly scoped today
(`delete_user_pipeline` -> `get_user_pipeline`, which rejects a pipeline
whose `org` differs; functions are keyed by (org, name)), and these tests
pin that so the same class of regression cannot land unseen here.

Response shape for all three is `{successful: [], unsuccessful: [], err}`
(`BulkDeleteResponse` / `PipelineBulkEnableResponse`), partial success and
all — an id that fails does not abort the ids after it.
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


def _realtime_pipeline_payload(name: str, stream_name: str, org: str = ORG_ID) -> dict[str, Any]:
    """A realtime pipeline: one input stream -> one output stream.

    `stream_name` must be unique per pipeline within an org: only one realtime
    pipeline may exist per source stream (openobserve#6443), so a shared source
    would make the second create 400 rather than give us a second id to batch.
    """
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
                    "org_id": org,
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
                    "org_id": org,
                },
                "position": {"x": 300, "y": 100},
                "io_type": "output",
            },
        ],
        "edges": [{"id": f"e-{input_id}-{output_id}", "source": input_id, "target": output_id}],
        "org": org,
    }


def _pipeline_with_function_payload(name: str, stream_name: str, function_name: str) -> dict[str, Any]:
    """A realtime pipeline whose middle node applies `function_name`.

    Used to make a function undeletable: the bulk handler maps
    `FunctionDeleteError::PipelineDependencies` to `unsuccessful`.
    """
    input_id = str(uuid.uuid4())
    fn_id = str(uuid.uuid4())
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
                "id": fn_id,
                "data": {"node_type": "function", "name": function_name, "after_flatten": True},
                "position": {"x": 300, "y": 200},
                "io_type": "default",
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
                "position": {"x": 500, "y": 300},
                "io_type": "output",
            },
        ],
        "edges": [
            {"id": f"e1-{input_id}-{fn_id}", "source": input_id, "target": fn_id},
            {"id": f"e2-{fn_id}-{output_id}", "source": fn_id, "target": output_id},
        ],
        "org": ORG_ID,
    }


def _function_payload(name: str, *, body: str = ".bulk_marker = 1") -> dict[str, Any]:
    return {"function": body, "name": name, "params": "row", "transType": 0}


# ----- helpers -----


def _create_pipeline(client: OpenObserveClient, payload: dict[str, Any], *, org: str = ORG_ID) -> str:
    """Create a pipeline and return its id, read back from the list.

    The create response does not carry the id, so the list is the only source.
    """
    resp = client.post("pipelines", json=payload, org=org)
    assert resp.status_code == 200, f"setup: create pipeline failed: {resp.status_code} {resp.text}"
    pipeline = _find_pipeline(client, payload["name"], org=org)
    assert pipeline is not None, f"setup: created pipeline {payload['name']} not in list"
    return pipeline["pipeline_id"]


def _list_pipelines(client: OpenObserveClient, *, org: str = ORG_ID) -> list[dict[str, Any]]:
    resp = client.get("pipelines", org=org)
    assert resp.status_code == 200, f"list pipelines failed: {resp.status_code} {resp.text}"
    return resp.json().get("list") or []


def _find_pipeline(
    client: OpenObserveClient, name: str, *, org: str = ORG_ID
) -> dict[str, Any] | None:
    return next((p for p in _list_pipelines(client, org=org) if p["name"] == name), None)


def _function_names(client: OpenObserveClient, *, org: str = ORG_ID) -> list[str]:
    resp = client.get("functions", org=org)
    assert resp.status_code == 200, f"list functions failed: {resp.status_code} {resp.text}"
    return [f["name"] for f in (resp.json().get("list") or [])]


def _bulk_body(resp) -> dict[str, Any]:
    """Assert the bulk envelope and return it."""
    assert resp.status_code == 200, f"bulk call failed: {resp.status_code} {resp.text}"
    body = resp.json()
    for key in ("successful", "unsuccessful"):
        assert isinstance(body.get(key), list), f"bulk response needs a {key} list, got {body}"
    return body


def _delete_pipelines_quietly(client: OpenObserveClient, ids: list[str], *, org: str = ORG_ID) -> None:
    for pipeline_id in ids:
        try:
            client.delete(f"pipelines/{pipeline_id}", org=org)
        except Exception as e:  # noqa: BLE001 - teardown must not mask the test result
            logger.warning("cleanup failed for pipeline %s: %s", pipeline_id, e)


def _delete_functions_quietly(client: OpenObserveClient, names: list[str], *, org: str = ORG_ID) -> None:
    for name in names:
        try:
            client.delete(f"functions/{name}", org=org)
        except Exception as e:  # noqa: BLE001
            logger.warning("cleanup failed for function %s: %s", name, e)


# ----- fixtures -----


@pytest.fixture(scope="module")
def other_org(client: OpenObserveClient) -> str:
    """Identifier of a second organization, for the cross-org cases.

    Module-scoped and never deleted: `DELETE /api/organizations/{id}` answers
    404 even for a just-created org on this build, which
    `tests/orgs/test_organisations.py::test_delete_organization_observed_broken`
    already documents as an xfail. One leftover org per module is the smallest
    footprint available until that endpoint works.

    Org names take alphanumerics, spaces and underscores only — no hyphens.
    """
    resp = client.post("api/organizations", json={"name": unique_name("pytbulkorg")}, prefix="")
    assert resp.status_code == 200, f"setup: create org failed: {resp.status_code} {resp.text}"
    identifier = resp.json().get("identifier")
    assert identifier, f"setup: created org has no identifier: {resp.json()}"
    return identifier


@pytest.fixture
def two_pipelines(client: OpenObserveClient) -> Generator[dict[str, str], None, None]:
    """Two realtime pipelines on distinct source streams; {name: pipeline_id}."""
    created: dict[str, str] = {}
    for _ in range(2):
        name = unique_name("pyt_bulk_pipe")
        created[name] = _create_pipeline(
            client, _realtime_pipeline_payload(name, f"stream_{name}")
        )
    yield created
    _delete_pipelines_quietly(client, list(created.values()))


# ----- DELETE /pipelines/bulk -----


def test_bulk_delete_removes_every_listed_pipeline(
    client: OpenObserveClient, two_pipelines: dict[str, str]
):
    """Both ids come back successful and neither pipeline is in the list after."""
    ids = list(two_pipelines.values())

    body = _bulk_body(client.delete("pipelines/bulk", json={"ids": ids}))

    assert sorted(body["successful"]) == sorted(ids), \
        f"every id should be deleted, got {body}"
    assert body["unsuccessful"] == [], f"nothing should fail, got {body}"

    remaining = [p["name"] for p in _list_pipelines(client)]
    for name in two_pipelines:
        assert name not in remaining, f"{name} should be gone after bulk delete"


def test_bulk_delete_reports_an_unknown_id_per_id_not_for_the_batch(
    client: OpenObserveClient, two_pipelines: dict[str, str]
):
    """A bogus id fails alone — the real ids in the same batch still delete.

    This is the contract that makes the envelope worth having: the handler
    loops and records per id rather than aborting on the first error.
    """
    real_ids = list(two_pipelines.values())
    bogus = f"does_not_exist_{uuid.uuid4().hex[:8]}"

    body = _bulk_body(client.delete("pipelines/bulk", json={"ids": [*real_ids, bogus]}))

    assert sorted(body["successful"]) == sorted(real_ids), \
        f"the real ids should still delete, got {body}"
    assert body["unsuccessful"] == [bogus], f"only the bogus id should fail, got {body}"
    assert body.get("err"), f"a failed id should carry an error message, got {body}"


def test_bulk_delete_cannot_reach_a_pipeline_in_another_org(
    client: OpenObserveClient, other_org: str
):
    """A pipeline belonging to `default` survives a bulk delete sent as another org.

    The #15361 regression, in the pipelines handler: delete by id with the org
    ignored. `delete_user_pipeline` rejects a pipeline whose `org` differs, so
    the id must land in `unsuccessful` AND the pipeline must still be there.
    """
    name = unique_name("pyt_bulk_xorg")
    pipeline_id = _create_pipeline(client, _realtime_pipeline_payload(name, f"stream_{name}"))

    try:
        body = _bulk_body(
            client.delete("pipelines/bulk", json={"ids": [pipeline_id]}, org=other_org)
        )

        assert body["successful"] == [], \
            f"another org must not report success deleting {pipeline_id}, got {body}"
        assert body["unsuccessful"] == [pipeline_id], \
            f"the cross-org id should be rejected, got {body}"
        assert _find_pipeline(client, name) is not None, \
            f"{name} was deleted from org {ORG_ID} by a request scoped to {other_org}"
    finally:
        _delete_pipelines_quietly(client, [pipeline_id])


# ----- POST /pipelines/bulk/enable -----


def test_bulk_enable_disables_and_re_enables_every_listed_pipeline(
    client: OpenObserveClient, two_pipelines: dict[str, str]
):
    """`?value=false` then `?value=true` moves the stored `enabled` flag both ways."""
    ids = list(two_pipelines.values())

    body = _bulk_body(
        client.post("pipelines/bulk/enable", params={"value": "false"}, json={"ids": ids})
    )
    assert sorted(body["successful"]) == sorted(ids), f"disable should succeed for all, got {body}"
    assert body["unsuccessful"] == [], f"nothing should fail, got {body}"

    states = {p["name"]: p["enabled"] for p in _list_pipelines(client) if p["name"] in two_pipelines}
    assert states and not any(states.values()), f"all should read disabled, got {states}"

    body = _bulk_body(
        client.post("pipelines/bulk/enable", params={"value": "true"}, json={"ids": ids})
    )
    assert sorted(body["successful"]) == sorted(ids), f"enable should succeed for all, got {body}"

    states = {p["name"]: p["enabled"] for p in _list_pipelines(client) if p["name"] in two_pipelines}
    assert states and all(states.values()), f"all should read enabled again, got {states}"


def test_bulk_enable_cannot_reach_a_pipeline_in_another_org(
    client: OpenObserveClient, other_org: str
):
    """Another org cannot flip `default`'s pipeline off.

    Same shape as the bulk-delete cross-org case: `enable_user_pipeline` takes
    the org, so a mismatched org must be a per-id failure and the pipeline must
    keep the state it had.
    """
    name = unique_name("pyt_bulk_en_xorg")
    pipeline_id = _create_pipeline(client, _realtime_pipeline_payload(name, f"stream_{name}"))

    try:
        before = _find_pipeline(client, name)
        assert before is not None, "setup: pipeline should exist before the cross-org call"

        body = _bulk_body(
            client.post(
                "pipelines/bulk/enable",
                params={"value": "false"},
                json={"ids": [pipeline_id]},
                org=other_org,
            )
        )

        assert body["successful"] == [], \
            f"another org must not report success toggling {pipeline_id}, got {body}"
        assert body["unsuccessful"] == [pipeline_id], \
            f"the cross-org id should be rejected, got {body}"

        after = _find_pipeline(client, name)
        assert after is not None, f"{name} disappeared after a cross-org enable call"
        assert after["enabled"] == before["enabled"], \
            f"{name} changed state from a request scoped to {other_org}"
    finally:
        _delete_pipelines_quietly(client, [pipeline_id])


# ----- DELETE /functions/bulk -----


def test_function_bulk_delete_removes_every_listed_function(client: OpenObserveClient):
    """Both names come back successful and neither function is in the list after."""
    names = [unique_name("pyt_bulk_fn") for _ in range(2)]
    for name in names:
        resp = client.post("functions", json=_function_payload(name))
        assert resp.status_code == 200, f"setup: create function failed: {resp.status_code} {resp.text}"

    try:
        body = _bulk_body(client.delete("functions/bulk", json={"ids": names}))

        assert sorted(body["successful"]) == sorted(names), f"both should delete, got {body}"
        assert body["unsuccessful"] == [], f"nothing should fail, got {body}"

        remaining = _function_names(client)
        for name in names:
            assert name not in remaining, f"{name} should be gone after bulk delete"
    finally:
        _delete_functions_quietly(client, names)


def test_function_bulk_delete_keeps_a_function_a_pipeline_depends_on(client: OpenObserveClient):
    """A function used by a pipeline node is refused, and the rest of the batch still deletes."""
    used = unique_name("pyt_bulk_fn_used")
    free = unique_name("pyt_bulk_fn_free")
    pipeline_name = unique_name("pyt_bulk_fn_pipe")
    pipeline_id = None

    for name in (used, free):
        resp = client.post("functions", json=_function_payload(name))
        assert resp.status_code == 200, f"setup: create function failed: {resp.status_code} {resp.text}"

    try:
        pipeline_id = _create_pipeline(
            client,
            _pipeline_with_function_payload(pipeline_name, f"stream_{pipeline_name}", used),
        )

        body = _bulk_body(client.delete("functions/bulk", json={"ids": [used, free]}))

        assert body["unsuccessful"] == [used], \
            f"a function a pipeline uses must be refused, got {body}"
        assert body["successful"] == [free], \
            f"the unused function in the same batch should still delete, got {body}"
        assert body.get("err"), f"the refusal should carry a message, got {body}"
        assert used in _function_names(client), f"{used} should survive the refusal"
    finally:
        if pipeline_id:
            _delete_pipelines_quietly(client, [pipeline_id])
        _delete_functions_quietly(client, [used, free])


def test_function_bulk_delete_cannot_reach_a_function_in_another_org(
    client: OpenObserveClient, other_org: str
):
    """A function in `default` survives a bulk delete sent as another org.

    Functions are keyed by (org, name), so the other org's request finds
    nothing. Note what is asserted and what is not: the handler folds
    `FunctionDeleteError::NotFound` into `successful`, so the response says
    "deleted" either way — deliberately, since an idempotent delete gives a
    caller no oracle for whether a name exists in an org it cannot see. The
    assertion that matters is therefore that the function is still there.
    """
    name = unique_name("pyt_bulk_fn_xorg")
    resp = client.post("functions", json=_function_payload(name))
    assert resp.status_code == 200, f"setup: create function failed: {resp.status_code} {resp.text}"

    try:
        _bulk_body(client.delete("functions/bulk", json={"ids": [name]}, org=other_org))

        assert name in _function_names(client), \
            f"{name} was deleted from org {ORG_ID} by a request scoped to {other_org}"
        assert name not in _function_names(client, org=other_org), \
            f"{name} should never have existed in {other_org}"
    finally:
        _delete_functions_quietly(client, [name])
